import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { env } from "./env.js";
import { pool, initDb } from "./db.js";
import { requireUser } from "./auth.js";
import { uploadPlanBytes, downloadPlanBytes, planPresignedUrl } from "./storage.js";
import { transcribeInspectorAudio, runLiveInspection, generateRedline, norm1000ToPixels } from "./meta.js";
import { lookup_ibc_ada_statute } from "./statutes.js";
import { BENCHMARKS, getBenchmark, benchmarkSvgBytes, cachedReport, remediatedReport } from "./benchmarks.js";
import { permitPacketPdf, datasetJsonl } from "./exports.js";
import { sealInspections } from "./realtime.js";
import type { InspectionReport, Occupancy } from "./types.js";

const app = new Hono();

app.get("/api/health", async (c) => {
  let hello = "unreachable";
  if (env.helloFnUrl) {
    try {
      const res = await fetch(env.helloFnUrl);
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
  const headers = new Headers(c.req.raw.headers);
  headers.delete("host");
  if (!headers.get("origin")) {
    headers.set("origin", url.origin || "http://localhost:3000");
  }
  const body =
    c.req.method === "GET" || c.req.method === "HEAD" ? undefined : await c.req.raw.arrayBuffer();
  const res = await fetch(upstream, { method: c.req.method, headers, body, redirect: "manual" });
  const out = new Headers(res.headers);
  return new Response(res.body, { status: res.status, headers: out });
});

async function currentUser(c: { req: { raw: Request } }) {
  return requireUser(c.req.raw.headers);
}

app.get("/api/me", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  return c.json({ user });
});

// --- Benchmarks & cached audits (PRD §7 deterministic fallback) ---
app.get("/api/benchmarks", (c) =>
  c.json(BENCHMARKS.map((b) => ({ id: b.id, label: b.label, occupancy: b.occupancy, url: `/benchmarks/${b.file}` }))),
);

app.post("/api/inspect/benchmark/:id", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const def = getBenchmark(c.req.param("id"));
  if (!def) return c.json({ error: "Unknown benchmark" }, 404);
  const report = cachedReport(def);
  await saveInspection(report, user.id);
  return c.json(report);
});

// --- Plan upload -> S3 assets bucket + plans row ---
app.post("/api/plans/upload", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.parseBody();
  const file = body["file"];
  if (!(file instanceof File)) return c.json({ error: "file field required" }, 400);
  const mime = file.type || "application/octet-stream";
  // Single-page PDF accepted at ingestion; live vision audit expects raster — noted in response.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const id = randomUUID();
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `plans/${id}/${safe}`;
  await uploadPlanBytes(key, bytes, mime);
  await pool.query(
    `INSERT INTO plans (id, s3_key, filename, mime_type, width_px, height_px, source, uploaded_by)
     VALUES ($1,$2,$3,$4,0,0,'upload',$5)`,
    [id, key, file.name, mime, user.id],
  );
  const url = await planPresignedUrl(key);
  return c.json({ plan: { id, s3Key: key, filename: file.name, mimeType: mime, url } }, 201);
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
  };

  let imageB64 = body.imageBase64 ?? "";
  let mime = body.imageMime ?? "image/png";
  let planId: string | null = body.planId ?? null;

  if (planId && !imageB64) {
    const { rows } = await pool.query(`SELECT s3_key, mime_type, uploaded_by FROM plans WHERE id = $1`, [planId]);
    const plan = rows[0];
    if (!plan) return c.json({ error: "Plan not found" }, 404);
    if (plan.uploaded_by !== user.id) return c.json({ error: "Forbidden" }, 403);
    const bytes = await downloadPlanBytes(plan.s3_key as string);
    imageB64 = Buffer.from(bytes).toString("base64");
    mime = (plan.mime_type as string) || mime;
  }
  if (!imageB64) return c.json({ error: "imageBase64 or planId required" }, 400);

  const report = await runLiveInspection({
    inputImageB64: imageB64,
    inputMime: mime,
    planId,
    source: "upload",
    floorplanKey: planId ?? "inline",
    occupancy: body.occupancy ?? "Commercial",
    imageWidthPx: 1000,
    imageHeightPx: 800,
    instruction: body.instruction ?? body.transcript ?? "",
  });
  report.transcript = body.transcript ?? report.transcript;
  await saveInspection(report, user.id);
  return c.json(report);
});

// --- Redline (Node 4) + closed-loop re-verification ---
app.post("/api/redline", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const body = (await c.req.json().catch(() => ({}))) as {
    inspectionId?: string;
    benchmarkId?: string;
    imageBase64?: string;
    mode?: "deterministic" | "live";
  };

  const instructionsFrom = async (inspectionId?: string): Promise<{ text: string; report?: InspectionReport }> => {
    if (!inspectionId) return { text: "" };
    const { rows } = await pool.query(`SELECT report FROM inspections WHERE id = $1 AND user_id = $2`, [
      inspectionId,
      user.id,
    ]);
    const report = rows[0]?.report as InspectionReport | undefined;
    if (!report) return { text: "" };
    return { text: report.violations.map((v) => `${v.id}: ${v.remediationInstruction}`).join(" "), report };
  };

  const { text: remediation, report: sourceReport } = await instructionsFrom(body.inspectionId);
  const instructions = remediation || "Flip restroom door swing outward; widen corridor to 44 inches; add red dimension callouts.";

  // Deterministic closed-loop for benchmark violation plan (PRD §7)
  if (body.benchmarkId === "cafe-violation" || body.mode === "deterministic" || !body.imageBase64) {
    const reReport = remediatedReport(body.inspectionId ?? sourceReport?.inspectionId ?? "insp_redline");
    await saveInspection(reReport, user.id);
    const svg = await benchmarkSvgBytes("cafe-compliant");
    return c.json({
      mode: "deterministic",
      redlineImageBase64: Buffer.from(svg).toString("base64"),
      redlineMime: "image/svg+xml",
      reverifiedReport: reReport,
    });
  }

  const live = await generateRedline(body.imageBase64, instructions);
  return c.json({
    mode: "live",
    responseId: live.responseId,
    redlineImageBase64: live.redlineImageB64,
    redlineMime: "image/png",
  });
});

// --- Statutes (deterministic MCP dictionary) ---
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
  return c.json(rows[0].report);
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
  const planId = report.planId && getBenchmark(report.planId) ? null : report.planId;
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

app.use("/*", serveStatic({ root: "./public" }));

const port = Number(process.env.PORT ?? 3000);
async function start() {
  await initDb();
  serve({ fetch: app.fetch, port });
  console.log(`PlanPass listening on http://localhost:${port}`);
}

start().catch((err) => {
  console.error("Startup failed:", err);
  process.exit(1);
});

