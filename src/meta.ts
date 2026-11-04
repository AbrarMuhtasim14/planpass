import OpenAI from "openai";
import { decodeMaskToSVGPath } from "@meta-sam/parser";
import { env } from "./env.js";
import { MCP_TOOLS, runMcpTool, resolveCitation } from "./statutes.js";
import type {
  AuditInput,
  ElementRow,
  InspectionReport,
  McpTraceEntry,
  SamOverlay,
  StepTrace,
  Violation,
} from "./types.js";

// Meta Model API client (PRD §8.2) — OpenAI SDK against https://api.meta.ai/v1
export const meta = new OpenAI({
  baseURL: env.metaApiBaseUrl,
  apiKey: env.metaApiKey,
});

export interface TranscribeResult {
  text: string;
  error?: string;
}

// Node 1: muse-voice-transcribe-1.0 via POST /v1/asr/transcribe (PRD §8.6)
export async function transcribeInspectorAudio(wavBytes: Uint8Array): Promise<TranscribeResult> {
  try {
    const form = new FormData();
    form.append(
      "request",
      new Blob(
        [JSON.stringify({ model: env.voiceModel, audioEncoding: "WAV", mode: "PUSH_TO_TALK" })],
        { type: "application/json" },
      ),
    );
    form.append("audio", new Blob([wavBytes.buffer as ArrayBuffer], { type: "audio/wav" }), "note.wav");
    const res = await fetch(`${env.metaApiBaseUrl}/asr/transcribe`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.metaApiKey}`, Accept: "application/json" },
      body: form,
    });
    if (!res.ok) return { text: "", error: `transcribe HTTP ${res.status}` };
    const data = (await res.json()) as { text?: string; transcript?: string };
    return { text: data.text ?? data.transcript ?? "" };
  } catch (e) {
    return { text: "", error: String(e) };
  }
}

export function normalizeConcepts(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  return [...new Set(list.map((c) => String(c).trim().toLowerCase()).filter((c) => c.length > 0 && c.length <= 40 && !c.includes(",")))].slice(0, 16);
}

const CONCEPTS_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "segmentation_concepts",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["concepts"],
      properties: { concepts: { type: "array", items: { type: "string" } } },
    },
  },
} as const;

// No fixed concept list: the agent proposes what to segment from the actual
// image + scope, unless the caller supplied concepts explicitly.
async function proposeConcepts(input: AuditInput): Promise<string[]> {
  try {
    const completion = await meta.chat.completions.create({
      model: env.sparkModel,
      messages: [
        {
          role: "system",
          content:
            "List the concrete architectural elements visible in this floorplan that should be segmented for a building-code audit. " +
            "Return strict JSON {concepts:[string]} with short singular noun phrases only (one element type per entry), at most 12.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Occupancy: ${input.occupancy || "not specified"}. Scope: ${input.instruction || "general building-code compliance audit"}.` },
            { type: "image_url", image_url: { url: `data:${input.inputMime};base64,${input.inputImageB64}` } },
          ],
        },
      ],
      response_format: CONCEPTS_RESPONSE_FORMAT,
    });
    const raw = completion.choices[0]?.message?.content ?? "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return [];
    return normalizeConcepts((JSON.parse(match[0]) as { concepts?: unknown }).concepts);
  } catch {
    return [];
  }
}

// Node 2: sam-3.1 — ONE noun per request, concurrent, /v1/responses streaming (PRD §8.3)
// Prefers a presigned image URL (no base64 re-upload per concept).
async function segmentSingleConcept(concept: string, b64: string, mime = "image/png", imageUrl?: string): Promise<string> {
  const chunks: string[] = [];
  const stream = await meta.responses.create({
    model: env.samModel,
    stream: true,
    input: [
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: concept },
          { type: "input_image", image_url: imageUrl ?? `data:${mime};base64,${b64}`, detail: "auto" },
        ],
      },
    ],
  });
  for await (const event of stream as AsyncIterable<{ type?: string; delta?: string; text?: string }>) {
    if (event.type === "response.output_text.delta" && event.delta) chunks.push(event.delta);
    // Some deployments emit only the terminal done event (no deltas).
    if (event.type === "response.output_text.done" && event.text && !chunks.length) chunks.push(event.text);
  }
  return chunks.join("");
}

export function norm1000ToPixels(
  box: [number, number, number, number],
  w: number,
  h: number,
): [number, number, number, number] {
  const [x0, y0, x1, y1] = box;
  return [Math.round((x0 * w) / 1000), Math.round((y0 * h) / 1000), Math.round((x1 * w) / 1000), Math.round((y1 * h) / 1000)];
}

// SAM 3.1 wire grammar (https://dev.meta.ai/docs/sam/reading-segmentation):
// `<Nf>id<|box;x1=..;y1=..;x2=..;y2=..;w=..;h=..|><|mask;x=0;y=0;data=H,W,<enc>payload|>,...`
// Boxes are source pixels; masks decode via @meta-sam/parser decodeMaskToSVGPath.
const SAM_RECORD_RE =
  /(\d+)<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)(?:;c=[\d.]+)?\|><\|mask;x=0;y=0(?:;c=[\d.]+)?;data=(\d+),(\d+),([~!])([\s\S]*?)\|>/g;

export function parseSamStream(raw: string, concept: string): SamOverlay[] {
  const out: SamOverlay[] = [];
  if (!raw) return out;
  SAM_RECORD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SAM_RECORD_RE.exec(raw)) !== null) {
    const objectId = Number(m[1]);
    const [x1, y1, x2, y2, w, h] = [m[2], m[3], m[4], m[5], m[6], m[7]].map(Number);
    const maskH = Number(m[8]);
    const maskW = Number(m[9]);
    let svg_path: string | undefined;
    try {
      svg_path =
        decodeMaskToSVGPath({
          encoding: m[10] === "~" ? "lossless" : "one_bit",
          payload: m[11],
          width: maskW,
          height: maskH,
        }) || undefined;
    } catch {
      svg_path = undefined;
    }
    out.push({
      concept,
      objectId,
      box_px: [
        Math.round((x1 * 1000) / w),
        Math.round((y1 * 800) / h),
        Math.round((x2 * 1000) / w),
        Math.round((y2 * 800) / h),
      ],
      compliant: true,
      svg_path,
      mask_w: maskW,
      mask_h: maskH,
    });
  }
  return out.length ? out : parseSamBoxes(raw, concept);
}

// Legacy tolerant extractor (fallback only; SAM grammar above is primary).
export function parseSamBoxes(raw: string, concept: string): SamOverlay[] {
  const out: SamOverlay[] = [];
  const patterns = [
    /\[(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)\]/g,
    /\((\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)\)/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
      const box: [number, number, number, number] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
      if (box.every((n) => Number.isFinite(n))) {
        out.push({ concept, objectId: out.length + 1, box_px: box, compliant: true });
      }
    }
    if (out.length) break;
  }
  return out;
}

interface SamStepResult {
  overlays: SamOverlay[];
  status: StepTrace["status"];
  latencyMs: number;
}

async function runSamStep(input: AuditInput): Promise<SamStepResult & { concepts: string[] }> {
  const t0 = Date.now();
  const supplied = normalizeConcepts(input.concepts);
  // Default to primary compliance concepts to avoid expensive 20s LLM proposeConcepts step
  const concepts = supplied.length ? supplied : ["door", "corridor", "restroom"];
  if (!concepts.length) return { overlays: [], concepts, status: "ok", latencyMs: Date.now() - t0 };
  try {
    const raws = await Promise.all(concepts.map((c) => segmentSingleConcept(c, input.inputImageB64, input.inputMime, input.inputImageUrl)));
    const overlays = raws.flatMap((raw, i) => parseSamStream(raw, concepts[i]));
    return { overlays, concepts, status: "ok", latencyMs: Date.now() - t0 };
  } catch {
    return { overlays: [], concepts, status: "error", latencyMs: Date.now() - t0 };
  }
}

interface SparkAudit {
  readiness_score: number;
  elements: ElementRow[];
  violations: Violation[];
}

// Strict audit schema (PRD §8.4 rule 5): response_format json_schema, strict: true.
const AUDIT_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "blueprint_audit",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["readiness_score", "elements", "violations"],
      properties: {
        readiness_score: { type: "number" },
        elements: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["concept", "objectId", "compliant"],
            properties: {
              concept: { type: "string" },
              objectId: { type: "number" },
              compliant: { type: "boolean" },
            },
          },
        },
        violations: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "title", "codeSection", "severity", "measuredValue", "requiredValue", "normBox1000", "remediationInstruction"],
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              codeSection: { type: "string" },
              severity: { type: "string", enum: ["CRITICAL", "HIGH", "MEDIUM"] },
              measuredValue: { type: "string" },
              requiredValue: { type: "string" },
              normBox1000: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
              remediationInstruction: { type: "string" },
            },
          },
        },
      },
    },
  },
} as const;

// Node 3: muse-spark-1.3 + deterministic FastMCP tools, strict JSON audit (PRD §8.4)
async function runSparkAudit(
  input: AuditInput,
  overlays: SamOverlay[],
): Promise<{ audit: SparkAudit; mcpTrace: McpTraceEntry[]; status: StepTrace["status"]; latencyMs: number }> {
  const t0 = Date.now();
  const mcpTrace: McpTraceEntry[] = [];
  const segSummary = overlays.length
    ? overlays.map((o) => `${o.concept}#${o.objectId} box_px=[${o.box_px.join(",")}]`).join("; ")
    : "no SAM boxes parsed — localize architectural elements from the image directly";

  const system =
    "You are PlanPass, a certified-grade municipal building-code examiner. Analyze the architectural floorplan image with rigorous scrutiny. " +
    "Use the provided SAM segmentation summary to localize doors, corridors, restrooms. " +
    "Before citing any building code you MUST call lookup_ibc_ada_statute (code_id or keyword query), and call evaluate_corridor_width / evaluate_ada_turning_circle for dimensional checks. " +
    "You may also call lookup_ecfr_federal_rule for live federal ADA text (eCFR Titles 36/28) and lookup_jurisdiction to resolve a stated plan address to its city/county/state. " +
    "CRITICAL LATENCY REQUIREMENT: Emit ALL necessary tool calls (all statute lookups and geometrical evaluations) simultaneously in PARALLEL in your FIRST turn. Do NOT call tools sequentially one at a time. " +
    "AUDIT SCRUTINY RULES:\n" +
    "1. Restroom Door Swings (ADA §604.3.2 & §304.3): Inspect the door swing arc on every restroom. If the door swings inward into the room, verify whether it encroaches on the required 60\" turning circle or water closet fixture clearance. If an inward swing obstructs the fixture or turning space, call evaluate_ada_turning_circle with clear_diameter_in=60 and obstruction='inward door swing overlap', and record a violation under ADA-604.3.2.\n" +
    "2. Corridors & Egress (IBC §1020.2): Verify minimum clear egress widths (Group I-2 hospitals require 96\" for bed movement; Group F factories and Group A assembly require 44\"; Group R requires 36\"). If corridors or doors are narrower or unverified, invoke evaluate_corridor_width and record a violation.\n" +
    "3. Never assume compliance without physical evidence on the drawing. If an element fails or cannot be verified as meeting code, return the violation and dock the readiness score accordingly.\n" +
    "Return ONLY strict JSON matching this schema: {readiness_score:number(0-100), elements:[{concept:string, objectId:number, compliant:boolean}], " +
    "violations:[{id:string, title:string, codeSection:string, severity:'CRITICAL'|'HIGH'|'MEDIUM', measuredValue:string, requiredValue:string, normBox1000:[number,number,number,number], remediationInstruction:string}]}. " +
    "Coordinates normBox1000 are on a 0-1000 grid (0,0 top-left). Derive every measured value from the image geometry and the stated scale; never invent a measurement. " +
    "Status is derived by the server from the verified violations you return, not from the score.";

  const userText =
    `Occupancy: ${input.occupancy || "not specified — infer from the plan"}. Inspection scope: ${input.instruction || "general building-code compliance audit"}. ` +
    `Image size: ${input.imageWidthPx}x${input.imageHeightPx} px.${input.pixelsPerFoot ? ` Scale calibration: ${input.pixelsPerFoot} px = 1 ft.` : " No scale calibration supplied — report measurements only when the plan itself states a scale."} ` +
    `SAM segmentation summary: ${segSummary}.`;

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    {
      role: "user",
      content: [
        { type: "text", text: userText },
        { type: "image_url", image_url: { url: input.inputImageUrl ?? `data:${input.inputMime};base64,${input.inputImageB64}` } },
      ],
    },
  ];

  try {
    let completion = await meta.chat.completions.create({
      model: env.sparkModel,
      messages,
      tools: MCP_TOOLS,
      tool_choice: "auto",
      response_format: AUDIT_RESPONSE_FORMAT,
      temperature: 0,
    });

    // MCP tool loop: max 2 rounds (round 0 handles parallel tools, round 1 completes audit)
    for (let round = 0; round < 2; round++) {
      const msg = completion.choices[0]?.message;
      if (!msg) break;
      messages.push(msg);
      const calls = msg.tool_calls ?? [];
      if (!calls.length) break;
      // Execute this round's tool calls concurrently (order preserved for
      // trace + tool messages); round time = slowest tool, not the sum.
      const fnCalls = calls.filter((call) => call.type === "function");
      const settled = await Promise.all(
        fnCalls.map(async (call) => {
          if (call.type !== "function") return null;
          const tt = Date.now();
          const result = await runMcpTool(call.function.name, call.function.arguments);
          const content = typeof result === "string" ? result : JSON.stringify(result);
          return {
            trace: {
              tool: call.function.name,
              input: JSON.parse(call.function.arguments || "{}") as Record<string, unknown>,
              output: content,
              latencyMs: Date.now() - tt,
            },
            message: { role: "tool" as const, tool_call_id: call.id, content },
          };
        }),
      );
      for (const s of settled) {
        if (!s) continue;
        mcpTrace.push(s.trace);
        messages.push(s.message);
      }
      completion = await meta.chat.completions.create({
        model: env.sparkModel,
        messages,
        tools: MCP_TOOLS,
        tool_choice: "auto",
        response_format: AUDIT_RESPONSE_FORMAT,
        temperature: 0,
      });
    }

    const raw = completion.choices[0]?.message?.content ?? "";
    const audit = extractAudit(raw);
    return { audit, mcpTrace, status: "ok", latencyMs: Date.now() - t0 };
  } catch {
    return {
      audit: { readiness_score: 0, elements: [], violations: [] },
      mcpTrace,
      status: "error",
      latencyMs: Date.now() - t0,
    };
  }
}

function extractAudit(raw: string): SparkAudit {
  const match = raw.match(/\{[\s\S]*\}/);
  const fallback: SparkAudit = { readiness_score: 0, elements: [], violations: [] };
  if (!match) return fallback;
  try {
    const parsed = JSON.parse(match[0]) as SparkAudit;
    return {
      readiness_score: Math.max(0, Math.min(100, Number(parsed.readiness_score) || 0)),
      elements: Array.isArray(parsed.elements) ? parsed.elements : [],
      violations: Array.isArray(parsed.violations) ? parsed.violations : [],
    };
  } catch {
    return fallback;
  }
}

function inspectionId(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `insp_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Status is derived from the verified audit outcome — no fixed score gate. */
export function statusForAudit(violations: unknown[], auditOk: boolean): "APPROVED" | "HOLD" {
  return auditOk && violations.length === 0 ? "APPROVED" : "HOLD";
}

const SEVERITY_PENALTY: Record<Violation["severity"], number> = { CRITICAL: 30, HIGH: 18, MEDIUM: 8 };
const SEVERITY_RANK: Record<Violation["severity"], number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 };

/** Deterministic readiness score from verified violations (never model-sampled). */
export function scoreForViolations(violations: Violation[]): number {
  const penalty = violations.reduce((sum, v) => sum + (SEVERITY_PENALTY[v.severity] ?? 8), 0);
  return Math.max(0, Math.min(100, 100 - penalty));
}

export async function runLiveInspection(input: AuditInput): Promise<InspectionReport> {
  // Pipeline Nodes 2+3: Spark starts immediately on the image (SAM summary is
  // advisory only); SAM runs concurrently and annotates overlays on arrival.
  const samPromise = runSamStep(input);
  let spark = await runSparkAudit(input, []);
  // URL transport fallback: one retry with inline base64 if the URL hop failed.
  if (spark.status === "error" && input.inputImageUrl && input.inputImageB64) {
    spark = await runSparkAudit({ ...input, inputImageUrl: undefined }, []);
  }
  const sam = await samPromise;

  // Real geometry only: SAM overlays as returned. Spark elements may annotate
  // compliance of a matching SAM object, but never manufacture boxes.
  const overlays = sam.overlays;
  const byConcept = new Map(spark.audit.elements.map((e) => [`${e.concept}:${e.objectId}`, e.compliant]));
  for (const o of overlays) {
    const c = byConcept.get(`${o.concept}:${o.objectId}`);
    if (c !== undefined) o.compliant = c;
  }

  // Every citation must resolve in the runtime statute corpus; unverifiable
  // citations are dropped and reported, never silently trusted.
  const warnings: string[] = [];
  const violations = spark.audit.violations.filter((v) => {
    if (resolveCitation(v.codeSection)) return true;
    warnings.push(`Dropped unverifiable citation ${v.id} (${v.codeSection}): not found in statute corpus.`);
    return false;
  });
  if (spark.status !== "ok") warnings.push("Statutory auditor did not complete; result is HOLD for PE review.");
  if (!sam.concepts.length) warnings.push("No segmentation concepts were proposed or supplied; SAM step produced no overlays.");

  // Stable ordering + deterministic score so identical verified findings
  // always produce identical reports across runs.
  violations.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.id.localeCompare(b.id));

  const auditOk = spark.status === "ok";
  return {
    inspectionId: inspectionId(),
    status: statusForAudit(violations, auditOk),
    readinessScore: auditOk ? scoreForViolations(violations) : 0,
    transcript: input.instruction,
    occupancy: input.occupancy,
    source: input.source,
    planId: input.planId,
    trace: [
      { node: 1, model: env.voiceModel, status: "skipped", latencyMs: 0 },
      { node: 2, model: env.samModel, status: sam.status, latencyMs: sam.latencyMs },
      { node: 3, model: `${env.sparkModel} + statute tools`, status: spark.status, latencyMs: spark.latencyMs },
      { node: 4, model: env.imageModel, status: "skipped", latencyMs: 0 },
    ],
    samOverlays: overlays,
    violations,
    mcpTrace: spark.mcpTrace,
    warnings,
  };
}

export type GeneratedPlanKind = "redline" | "clean";

// Node 4: muse-image-1.0 reference-guided generation (PRD §8.5).
// kind="redline": visual markup for drafter review. kind="clean": revised
// blueprint with fixes baked in as clean linework (inspection target).
export async function generateRedline(
  floorplanB64: string,
  instructions: string,
  prevResponseId?: string,
  floorplanMime = "image/png",
  kind: GeneratedPlanKind = "redline",
): Promise<{ responseId: string; redlineImageB64: string }> {
  const tools = [
    {
      type: "image_generation" as const,
      enable_web_search: false,
      enable_shell: false,
      reasoning_strength: "low" as const,
      output_format: "png" as const,
    },
  ];
  const response = prevResponseId
    ? await meta.responses.create({
        model: env.imageModel,
        tools,
        previous_response_id: prevResponseId,
        input: instructions,
      })
    : await meta.responses.create({
        model: env.imageModel,
        tools,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text:
                  kind === "clean"
                    ? "Redraw this architectural floorplan as a CLEAN REVISED BLUEPRINT with these corrections applied as normal black linework: " +
                      `${instructions}. Keep existing walls and rooms intact except where a correction requires change. ` +
                      "Absolutely no red ink, no annotations, no callouts, no arrows, no legend, and no markup text — permit-ready clean linework only."
                    : "Edit this architectural floorplan while keeping existing walls and rooms intact. " +
                      `Apply crisp red architectural redline markups and callout arrows for: ${instructions}`,
              },
              { type: "input_image", image_url: `data:${floorplanMime};base64,${floorplanB64}`, detail: "auto" },
            ],
          },
        ],
      });

  const items = (response as { output?: Array<{ type: string; result?: string }> }).output ?? [];
  const image = items.find((o) => o.type === "image_generation_call");
  if (!image?.result) throw new Error(`${env.imageModel} returned no image_generation_call result`);
  return { responseId: (response as { id: string }).id, redlineImageB64: image.result };
}

// Dual generation: visual redline + clean revised plan, in parallel.
export async function generatePlanPair(
  floorplanB64: string,
  instructions: string,
  floorplanMime = "image/png",
): Promise<{ redline: { responseId: string; redlineImageB64: string }; clean: { responseId: string; redlineImageB64: string } }> {
  const [redline, clean] = await Promise.all([
    generateRedline(floorplanB64, instructions, undefined, floorplanMime, "redline"),
    generateRedline(floorplanB64, instructions, undefined, floorplanMime, "clean"),
  ]);
  return { redline, clean };
}
