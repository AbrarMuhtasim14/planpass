import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { randomUUID, createHash } from "node:crypto";

const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
import { env } from "./env.js";
import { pool, initDb } from "./db.js";
import { requireUser } from "./auth.js";
import { uploadPlanBytes, downloadPlanBytes, planPresignedUrl, putObject, getObjectBytes, objectUrl, redlineKeyFor, revisedKeyFor } from "./storage.js";
import { transcribeInspectorAudio, runLiveInspection, generatePlanPair, normalizeConcepts } from "./meta.js";
import { lookup_ibc_ada_statute, allStatutes } from "./statutes.js";
import { SAMPLES } from "./samples.js";
import { imageInfo } from "./image.js";
import { permitPacketPdf, datasetJsonl } from "./exports.js";
import { sendPermitApprovalEmail } from "./email.js";
import { sealInspections } from "./realtime.js";
import type { InspectionReport, Occupancy } from "./types.js";

export const app = new Hono();

app.get("/api/health", async (c) => {
  let hello = "unreachable";
  if (env.helloFnUrl) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(env.helloFnUrl, { signal: controller.signal });
      clearTimeout(t);
      hello = (await res.text()).slice(0, 80);
    } catch {
      hello = "unreachable";
    }
  }
  let db = "ok";
  try {
    await pool.query("SELECT 1");
  } catch {
    db = "error";
  }
  return c.json({
    ok: true,
    service: "planpass",
    branch: process.env.NEON_BRANCH ?? null,
    db,
    helloFunction: hello,
    metaApi: env.metaApiBaseUrl,
  });
});

// --- Neon Auth proxy: cookie-based Better Auth flow (Managed Auth quickstart) ---
app.all("/api/auth/*", async (c) => {
  const url = new URL(c.req.url);
  const upstream = `${env.authBaseUrl}${url.pathname.replace(/^\/api\/auth/, "")}${url.search}`;
  const parsedUpstream = new URL(upstream);
  const headers = new Headers(c.req.raw.headers);
  headers.delete("host");
  headers.delete("x-forwarded-host");
  headers.set("host", parsedUpstream.host);
  headers.set("origin", parsedUpstream.origin);
  const body =
    c.req.method === "GET" || c.req.method === "HEAD" ? undefined : await c.req.raw.arrayBuffer();
  const res = await fetch(upstream, { method: c.req.method, headers, body, redirect: "manual" });
  const out = new Headers(res.headers);
  return new Response(res.body, { status: res.status, headers: out });
});

async function currentUser(c: { req: { raw: Request } }) {
  return requireUser(c.req.raw.headers);
}

// Attach transient presigned URLs for stored generated plans (keys persist, URLs do not).
async function enrichReport(report: InspectionReport): Promise<InspectionReport> {
  const out = { ...report };
  if (out.redlineKey) out.redlineUrl = await objectUrl(out.redlineKey).catch(() => undefined);
  if (out.revisedKey) out.revisedUrl = await objectUrl(out.revisedKey).catch(() => undefined);
  return out;
}

app.get("/api/me", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  return c.json({ user });
});

// --- Sample library: input files only, no canned results ---
// Every inspection — sample or upload — runs the live 4-node pipeline.
app.get("/api/samples", (c) =>
  c.json(SAMPLES.map((s) => ({ id: s.id, label: s.label, url: `/benchmarks/${s.file}` }))),
);
app.get("/api/benchmarks", (c) =>
  c.json(SAMPLES.map((s) => ({ id: s.id, label: s.label, url: `/benchmarks/${s.file}` }))),
);

// --- Plan upload -> S3 assets bucket + plans row ---
app.post("/api/plans/upload", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.parseBody();
  const file = body["file"];
  if (!(file instanceof File)) return c.json({ error: "file field required" }, 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const info = imageInfo(bytes);
  if (!info) {
    return c.json({ error: "Unsupported file — upload a PNG, JPEG, WebP, GIF, or SVG floorplan (export PDFs to PNG first)" }, 415);
  }
  const mime = info.mime;
  const id = randomUUID();
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `plans/${id}/${safe}`;
  await uploadPlanBytes(key, bytes, mime);
  await pool.query(
    `INSERT INTO plans (id, s3_key, filename, mime_type, width_px, height_px, source, uploaded_by, sha256)
     VALUES ($1,$2,$3,$4,$5,$6,'upload',$7,$8)`,
    [id, key, file.name, mime, info?.width ?? 0, info?.height ?? 0, user.id, sha256(bytes)],
  );
  const url = await planPresignedUrl(key);
  return c.json(
    { plan: { id, s3Key: key, filename: file.name, mimeType: mime, widthPx: info?.width ?? null, heightPx: info?.height ?? null, url } },
    201,
  );
});

app.get("/api/plans", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const { rows } = await pool.query(
    `SELECT id, s3_key, filename, mime_type, source, created_at FROM plans WHERE uploaded_by = $1 ORDER BY created_at DESC LIMIT 50`,
    [user.id],
  );
  const plans = await Promise.all(
    rows.map(async (r) => ({ ...r, url: await planPresignedUrl(r.s3_key as string) })),
  );
  return c.json({ plans });
});

app.get("/api/plans/:id", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const { rows } = await pool.query(
    `SELECT id, s3_key, filename, mime_type, source, created_at FROM plans WHERE id = $1 AND uploaded_by = $2`,
    [c.req.param("id"), user.id],
  );
  if (!rows[0]) return c.json({ error: "Not found" }, 404);
  const url = await planPresignedUrl(rows[0].s3_key as string);
  return c.json({ ...rows[0], url });
});

// --- Voice scope (Node 1) ---
app.post("/api/voice/transcribe", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const bytes = new Uint8Array(await c.req.raw.arrayBuffer());
  const result = await transcribeInspectorAudio(bytes);
  return c.json(result);
});

// --- Live inspection (Nodes 2+3) ---
app.post("/api/inspect", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const body = (await c.req.json().catch(() => ({}))) as {
    planId?: string;
    imageBase64?: string;
    imageMime?: string;
    occupancy?: Occupancy;
    instruction?: string;
    transcript?: string;
    concepts?: string[] | string;
    pixelsPerFoot?: number;
  };

  let imageB64 = body.imageBase64 ?? "";
  let mime = body.imageMime ?? "image/png";
  let planId: string | null = body.planId ?? null;
  let imageUrl: string | undefined;

  // Repeat-run consistency: identical image bytes + identical audit params
  // return the stored verified report instead of re-sampling the models.
  // Fast path uses the plan's stored sha256 — no S3 download on a cache hit.
  const paramsHash = sha256(JSON.stringify({
    occupancy: body.occupancy ?? "",
    instruction: body.instruction ?? body.transcript ?? "",
    concepts: normalizeConcepts(body.concepts),
    pixelsPerFoot: body.pixelsPerFoot && body.pixelsPerFoot > 0 ? body.pixelsPerFoot : null,
  }));
  const cacheLookup = async (planHash: string) => {
    const cached = await pool.query(
      `SELECT report FROM inspections WHERE user_id = $1 AND report->>'planHash' = $2 AND report->>'paramsHash' = $3 ORDER BY created_at DESC LIMIT 1`,
      [user.id, planHash, paramsHash],
    );
    return cached.rows[0]?.report as InspectionReport | undefined;
  };

  let planHash = "";
  if (planId && !imageB64) {
    const { rows } = await pool.query(`SELECT s3_key, mime_type, uploaded_by, sha256 FROM plans WHERE id = $1`, [planId]);
    const plan = rows[0];
    if (!plan) return c.json({ error: "Plan not found" }, 404);
    if (plan.uploaded_by !== user.id) return c.json({ error: "Forbidden" }, 403);
    if (plan.sha256) {
      const hit = await cacheLookup(plan.sha256 as string);
      if (hit) return c.json(await enrichReport(hit));
    }
    const bytes = await downloadPlanBytes(plan.s3_key as string);
    imageB64 = Buffer.from(bytes).toString("base64");
    mime = (plan.mime_type as string) || mime;
    imageUrl = await planPresignedUrl(plan.s3_key as string).catch(() => undefined);
  }
  if (!imageB64) return c.json({ error: "imageBase64 or planId required" }, 400);

  const info = imageInfo(Buffer.from(imageB64, "base64"));
  planHash = sha256(Buffer.from(imageB64, "base64"));
  const hit = await cacheLookup(planHash);
  if (hit) return c.json(await enrichReport(hit));
  const report = await runLiveInspection({
    inputImageB64: imageB64,
    inputImageUrl: imageUrl,
    inputMime: info?.mime ?? mime,
    planId,
    source: "upload",
    floorplanKey: planId ?? "inline",
    occupancy: body.occupancy ?? "",
    imageWidthPx: info?.width ?? 0,
    imageHeightPx: info?.height ?? 0,
    instruction: body.instruction ?? body.transcript ?? "",
    concepts: normalizeConcepts(body.concepts),
    pixelsPerFoot: body.pixelsPerFoot && body.pixelsPerFoot > 0 ? body.pixelsPerFoot : undefined,
  });
  report.transcript = body.transcript ?? report.transcript;
  report.planHash = planHash;
  report.paramsHash = paramsHash;
  await saveInspection(report, user.id);
  return c.json(report);
});

// --- Redline (Node 4) + closed-loop re-verification ---
app.post("/api/redline", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const body = (await c.req.json().catch(() => ({}))) as {
    inspectionId?: string;
    imageBase64?: string;
    instructions?: string;
  };

  const instructionsFrom = async (
    inspectionId?: string,
  ): Promise<{ text: string; report?: InspectionReport; planId?: string | null }> => {
    if (!inspectionId) return { text: "" };
    const { rows } = await pool.query(`SELECT report, plan_id FROM inspections WHERE id = $1 AND user_id = $2`, [
      inspectionId,
      user.id,
    ]);
    const report = rows[0]?.report as InspectionReport | undefined;
    if (!report) return { text: "" };
    return {
      text: report.violations.map((v) => `${v.id}: ${v.remediationInstruction}`).join(" "),
      report,
      planId: rows[0]?.plan_id as string | null,
    };
  };

  const { text: remediation, report: sourceReport, planId: sourcePlanId } = await instructionsFrom(body.inspectionId);
  // No invented remediation: instructions must come from the real audit
  // (its violations) or from the caller.
  const instructions = remediation || body.instructions || "";
  if (!instructions) {
    return c.json({ error: "No remediation instructions — run an inspection with violations first, or supply instructions" }, 400);
  }

  let imageB64 = body.imageBase64 ?? "";
  const targetPlanId = sourceReport?.planId || sourcePlanId;
  if (!imageB64 && targetPlanId) {
    const { rows } = await pool.query(`SELECT s3_key FROM plans WHERE id = $1 AND uploaded_by = $2`, [
      targetPlanId,
      user.id,
    ]);
    if (rows[0]?.s3_key) {
      const bytes = await downloadPlanBytes(rows[0].s3_key as string);
      imageB64 = Buffer.from(bytes).toString("base64");
    }
  }

  if (!imageB64) {
    return c.json({ error: "No image source found for redline generation" }, 400);
  }

  const srcInfo = imageInfo(Buffer.from(imageB64, "base64"));
  // Dual generation in parallel: visual redline (drafter markup) + clean
  // revised blueprint (fixes baked in, inspection target). Both land in S3;
  // only keys + MIME persist — never base64 bodies.
  const pair = await generatePlanPair(imageB64, instructions, srcInfo?.mime ?? "image/png");
  const stamp = body.inspectionId ?? randomUUID();
  const redlineKey = redlineKeyFor(stamp);
  const revisedKey = revisedKeyFor(stamp);
  await Promise.all([
    putObject(redlineKey, Buffer.from(pair.redline.redlineImageB64, "base64"), "image/png"),
    putObject(revisedKey, Buffer.from(pair.clean.redlineImageB64, "base64"), "image/png"),
  ]);
  if (body.inspectionId) {
    await pool.query(
      `UPDATE inspections SET report = jsonb_set(jsonb_set(jsonb_set(jsonb_set(report, '{redlineKey}', to_jsonb($1::text)), '{redlineMime}', '"image/png"'), '{revisedKey}', to_jsonb($2::text)), '{revisedMime}', '"image/png"') WHERE id = $3 AND user_id = $4`,
      [redlineKey, revisedKey, body.inspectionId, user.id],
    );
  }
  const [redlineUrl, revisedUrl] = await Promise.all([
    objectUrl(redlineKey).catch(() => ""),
    objectUrl(revisedKey).catch(() => ""),
  ]);
  return c.json({
    mode: "live",
    responseIds: { redline: pair.redline.responseId, clean: pair.clean.responseId },
    redline: { key: redlineKey, mime: "image/png", url: redlineUrl },
    revised: { key: revisedKey, mime: "image/png", url: revisedUrl },
  });
});

// --- Statutes (runtime corpus in data/statutes.json) ---
app.get("/api/statutes", (c) => c.json({ statutes: allStatutes() }));
app.get("/api/statutes/:codeId", (c) => c.json(lookup_ibc_ada_statute({ code_id: c.req.param("codeId") })));

// --- History + Realtime sealing ---
app.get("/api/inspections", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const { rows } = await pool.query(
    `SELECT id, plan_id, occupancy, status, readiness_score, source, created_at FROM inspections WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [user.id],
  );
  return c.json({ inspections: rows });
});

app.get("/api/inspections/:id", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const { rows } = await pool.query(`SELECT report FROM inspections WHERE id = $1 AND user_id = $2`, [
    c.req.param("id"),
    user.id,
  ]);
  if (!rows[0]) return c.json({ error: "Not found" }, 404);
  return c.json(await enrichReport(rows[0].report as InspectionReport));
});

// --- Re-inspection (F7): live inspection on the CLEAN REVISED plan ---
// Never the markup: revisedKey (generated clean blueprint) or an
// architect-uploaded clean revision via planId.
app.post("/api/reverify", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const body = (await c.req.json().catch(() => ({}))) as {
    inspectionId?: string;
    planId?: string;
    occupancy?: Occupancy;
    concepts?: string[] | string;
    pixelsPerFoot?: number;
  };

  let imageB64 = "";
  let imageUrl: string | undefined;
  let occupancy: Occupancy = body.occupancy ?? "";
  let storedMime = "";
  let planId: string | null = body.planId ?? null;

  if (planId) {
    // Architect-uploaded clean revision.
    const { rows } = await pool.query(`SELECT s3_key, mime_type FROM plans WHERE id = $1 AND uploaded_by = $2`, [planId, user.id]);
    if (!rows[0]) return c.json({ error: "Plan not found" }, 404);
    const bytes = await getObjectBytes(rows[0].s3_key as string);
    imageB64 = Buffer.from(bytes).toString("base64");
    storedMime = (rows[0].mime_type as string) || "";
    imageUrl = await objectUrl(rows[0].s3_key as string).catch(() => undefined);
  } else if (body.inspectionId) {
    const { rows } = await pool.query(`SELECT report, plan_id FROM inspections WHERE id = $1 AND user_id = $2`, [
      body.inspectionId,
      user.id,
    ]);
    const stored = rows[0]?.report as InspectionReport | undefined;
    if (!stored?.revisedKey) {
      return c.json({ error: "No clean revised plan found — generate the redline + revised plan first, or upload a clean revision" }, 400);
    }
    const bytes = await getObjectBytes(stored.revisedKey);
    imageB64 = Buffer.from(bytes).toString("base64");
    storedMime = stored.revisedMime ?? "image/png";
    imageUrl = await objectUrl(stored.revisedKey).catch(() => undefined);
    if (!occupancy && stored?.occupancy) occupancy = stored.occupancy;
    planId = (rows[0]?.plan_id as string | null) ?? stored?.planId ?? null;
  }
  if (!imageB64) {
    return c.json({ error: "No clean revised plan found — generate the redline + revised plan first, or upload a clean revision" }, 400);
  }

  const info = imageInfo(Buffer.from(imageB64, "base64"));
  const report = await runLiveInspection({
    inputImageB64: imageB64,
    inputImageUrl: imageUrl,
    inputMime: info?.mime ?? storedMime ?? "image/png",
    planId,
    source: "redline",
    floorplanKey: "revised",
    occupancy,
    imageWidthPx: info?.width ?? 0,
    imageHeightPx: info?.height ?? 0,
    instruction: "Re-inspect this clean revised floorplan: confirm prior violations are resolved.",
    concepts: normalizeConcepts(body.concepts),
    pixelsPerFoot: body.pixelsPerFoot && body.pixelsPerFoot > 0 ? body.pixelsPerFoot : undefined,
  });
  report.transcript = "Re-inspection of clean revised floorplan (no markup).";
  await saveInspection(report, user.id);
  return c.json(await enrichReport(report));
});

// --- Export package: clean blueprint (permit-ready) + redline package ---
app.get("/api/inspections/:id/package", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const { rows } = await pool.query(`SELECT report FROM inspections WHERE id = $1 AND user_id = $2`, [
    c.req.param("id"),
    user.id,
  ]);
  if (!rows[0]) return c.json({ error: "Not found" }, 404);
  const report = rows[0].report as InspectionReport;
  const pack = async (key?: string, mime?: string) =>
    key ? { key, mime: mime ?? "image/png", url: await objectUrl(key).catch(() => "") } : null;
  return c.json({
    inspectionId: report.inspectionId,
    status: report.status,
    readinessScore: report.readinessScore,
    cleanPlan: await pack(report.revisedKey, report.revisedMime),
    redlinePackage: {
      redline: await pack(report.redlineKey, report.redlineMime),
      violations: report.violations,
      permitPdf: `/api/inspections/${report.inspectionId}/permit.pdf`,
      dataset: `/api/inspections/${report.inspectionId}/dataset.jsonl`,
    },
  });
});

// --- PE permit approval email (Resend + stamped PDF attachment) ---
app.post("/api/inspections/:id/email-permit", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const body = (await c.req.json().catch(() => ({}))) as { to?: string };
  const { rows } = await pool.query(`SELECT report FROM inspections WHERE id = $1 AND user_id = $2`, [
    c.req.param("id"),
    user.id,
  ]);
  if (!rows[0]) return c.json({ error: "Not found" }, 404);
  const report = rows[0].report as InspectionReport;
  const to = body.to ?? user.email;
  if (!to) return c.json({ error: "Recipient email required (sign in with email session or pass {to})" }, 400);
  const result = await sendPermitApprovalEmail(to, report);
  if (!result.sent) return c.json(result, 502);
  return c.json(result);
});

app.post("/api/inspections/live", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  return c.json(await sealInspections(user.id));
});

// --- Exports: stamped PDF packet + JSONL dataset ---
app.get("/api/inspections/:id/permit.pdf", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const { rows } = await pool.query(`SELECT report FROM inspections WHERE id = $1 AND user_id = $2`, [
    c.req.param("id"),
    user.id,
  ]);
  if (!rows[0]) return c.json({ error: "Not found" }, 404);
  const pdf = await permitPacketPdf(rows[0].report as InspectionReport);
  return new Response(pdf.buffer as ArrayBuffer, {
    headers: { "content-type": "application/pdf", "content-disposition": "attachment; filename=permit-packet.pdf" },
  });
});

app.get("/api/inspections/:id/dataset.jsonl", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const { rows } = await pool.query(`SELECT report FROM inspections WHERE id = $1 AND user_id = $2`, [
    c.req.param("id"),
    user.id,
  ]);
  if (!rows[0]) return c.json({ error: "Not found" }, 404);
  return new Response(datasetJsonl(rows[0].report as InspectionReport), {
    headers: { "content-type": "application/x-ndjson", "content-disposition": "attachment; filename=dataset.jsonl" },
  });
});

async function saveInspection(report: InspectionReport, userId: string): Promise<void> {
  const planId = report.planId;
  await pool.query(
    `INSERT INTO inspections (id, plan_id, user_id, occupancy, status, readiness_score, source, transcript, report)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, status = EXCLUDED.status, readiness_score = EXCLUDED.readiness_score, report = EXCLUDED.report`,
    [
      report.inspectionId,
      planId,
      userId,
      report.occupancy,
      report.status,
      report.readinessScore,
      report.source,
      report.transcript,
      report,
    ],
  );
}

if (!process.env.VERCEL) {
  app.use("/*", serveStatic({ root: "./public" }));
}

app.notFound((c) => c.json({ error: "Not found", path: c.req.path }, 404));

const port = Number(process.env.PORT ?? 3000);
async function start() {
  await initDb();
  serve({ fetch: app.fetch, port });
  console.log(`PlanPass listening on http://localhost:${port}`);
}

if (!process.env.VERCEL) {
  start().catch((err) => {
    console.error("Startup failed:", err);
    process.exit(1);
  });
}

