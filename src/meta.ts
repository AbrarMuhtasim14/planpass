import OpenAI from "openai";
import { env } from "./env.js";
import { MCP_TOOLS, runMcpTool } from "./statutes.js";
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
        [JSON.stringify({ model: "muse-voice-transcribe-1.0", audioEncoding: "WAV", mode: "PUSH_TO_TALK" })],
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

const CONCEPTS = ["door", "corridor", "bathroom", "room"] as const;

// Node 2: sam-3.1 — ONE noun per request, concurrent, /v1/responses streaming (PRD §8.3)
async function segmentSingleConcept(concept: string, b64: string): Promise<string> {
  const chunks: string[] = [];
  const stream = await meta.responses.create({
    model: "sam-3.1",
    stream: true,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: concept },
          { type: "input_image", image_url: `data:image/png;base64,${b64}`, detail: "auto" },
        ],
      },
    ],
  });
  for await (const event of stream as AsyncIterable<{ type?: string; delta?: string }>) {
    if (event.type === "response.output_text.delta" && event.delta) chunks.push(event.delta);
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

// Parse streamed SAM text: tolerant extractor for box tuples/JSON in the output.
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

async function runSamStep(imageB64: string): Promise<SamStepResult> {
  const t0 = Date.now();
  try {
    const raws = await Promise.all(CONCEPTS.map((c) => segmentSingleConcept(c, imageB64)));
    const overlays = raws.flatMap((raw, i) => parseSamBoxes(raw, CONCEPTS[i]));
    return { overlays, status: "ok", latencyMs: Date.now() - t0 };
  } catch {
    return { overlays: [], status: "error", latencyMs: Date.now() - t0 };
  }
}

interface SparkAudit {
  readiness_score: number;
  elements: ElementRow[];
  violations: Violation[];
}

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
    "You are PlanPass, a certified-grade municipal building-code examiner. Analyze the architectural floorplan image. " +
    "Use the provided SAM segmentation summary to localize doors, corridors, restrooms. " +
    "Before citing any building code you MUST call lookup_ibc_ada_statute, and call evaluate_corridor_width / evaluate_ada_turning_circle for dimensional checks. " +
    "Return ONLY strict JSON matching this schema: {readiness_score:number(0-100), elements:[{concept:string, objectId:number, compliant:boolean}], " +
    "violations:[{id:string, title:string, codeSection:string, severity:'CRITICAL'|'HIGH'|'MEDIUM', measuredValue:string, requiredValue:string, normBox1000:[number,number,number,number], remediationInstruction:string}]}. " +
    "Coordinates normBox1000 are on a 0-1000 grid (0,0 top-left). Score >90 and zero violations means APPROVED.";

  const userText =
    `Occupancy: ${input.occupancy}. Inspection scope: ${input.instruction || "Audit this floorplan for ADA restroom clearance and IBC egress corridor width"}. ` +
    `SAM segmentation summary: ${segSummary}.`;

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    {
      role: "user",
      content: [
        { type: "text", text: userText },
        { type: "image_url", image_url: { url: `data:${input.inputMime};base64,${input.inputImageB64}` } },
      ],
    },
  ];

  try {
    let completion = await meta.chat.completions.create({
      model: "muse-spark-1.3",
      messages,
      tools: MCP_TOOLS,
      tool_choice: "auto",
    });

    // MCP tool loop (max 4 rounds)
    for (let round = 0; round < 4; round++) {
      const msg = completion.choices[0]?.message;
      if (!msg) break;
      messages.push(msg);
      const calls = msg.tool_calls ?? [];
      if (!calls.length) break;
      for (const call of calls) {
        if (call.type !== "function") continue;
        const tt = Date.now();
        const result = runMcpTool(call.function.name, call.function.arguments);
        mcpTrace.push({
          tool: call.function.name,
          input: JSON.parse(call.function.arguments || "{}") as Record<string, unknown>,
          output: typeof result === "string" ? result : JSON.stringify(result),
          latencyMs: Date.now() - tt,
        });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: typeof result === "string" ? result : JSON.stringify(result),
        });
      }
      completion = await meta.chat.completions.create({
        model: "muse-spark-1.3",
        messages,
        tools: MCP_TOOLS,
        tool_choice: "auto",
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

export async function runLiveInspection(input: AuditInput): Promise<InspectionReport> {
  const sam = await runSamStep(input.inputImageB64);
  const spark = await runSparkAudit(input, sam.overlays);

  const overlays: SamOverlay[] = sam.overlays.length
    ? sam.overlays
    : spark.audit.elements.map((e, i) => ({
        concept: e.concept,
        objectId: e.objectId ?? i + 1,
        box_px: [0, 0, 0, 0] as [number, number, number, number],
        compliant: e.compliant,
      }));

  const byConcept = new Map(spark.audit.elements.map((e) => [`${e.concept}:${e.objectId}`, e.compliant]));
  for (const o of overlays) {
    const c = byConcept.get(`${o.concept}:${o.objectId}`);
    if (c !== undefined) o.compliant = c;
  }

  const score = spark.audit.readiness_score;
  return {
    inspectionId: inspectionId(),
    status: score >= 90 && spark.audit.violations.length === 0 ? "APPROVED" : "HOLD",
    readinessScore: score,
    transcript: input.instruction,
    occupancy: input.occupancy,
    source: input.source,
    planId: input.planId,
    trace: [
      { node: 1, model: "muse-voice-transcribe-1.0", status: "skipped", latencyMs: 0 },
      { node: 2, model: "sam-3.1", status: sam.status, latencyMs: sam.latencyMs },
      { node: 3, model: "muse-spark-1.3 + FastMCP", status: spark.status, latencyMs: spark.latencyMs },
      { node: 4, model: "muse-image-1.0", status: "skipped", latencyMs: 0 },
    ],
    samOverlays: overlays,
    violations: spark.audit.violations,
    mcpTrace: spark.mcpTrace,
  };
}

// Node 4: muse-image-1.0 reference-guided redline (PRD §8.5)
export async function generateRedline(
  floorplanB64: string,
  instructions: string,
  prevResponseId?: string,
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
        model: "muse-image-1.0",
        tools,
        previous_response_id: prevResponseId,
        input: instructions,
      })
    : await meta.responses.create({
        model: "muse-image-1.0",
        tools,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text:
                  "Edit this architectural floorplan while keeping existing walls and rooms intact. " +
                  `Apply crisp red architectural redline markups and callout arrows for: ${instructions}`,
              },
              { type: "input_image", image_url: `data:image/png;base64,${floorplanB64}`, detail: "auto" },
            ],
          },
        ],
      });

  const items = (response as { output?: Array<{ type: string; result?: string }> }).output ?? [];
  const image = items.find((o) => o.type === "image_generation_call");
  if (!image?.result) throw new Error("muse-image-1.0 returned no image_generation_call result");
  return { responseId: (response as { id: string }).id, redlineImageB64: image.result };
}
