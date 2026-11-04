// PlanPass end-to-end verification against the running server on :3000.
// Usage: node scripts/verify-e2e.mjs
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const BASE = "http://localhost:3000";

// Auto-start server if not already running on :3000
let autoStartedServer = null;
try {
  await fetch(BASE + "/api/health");
} catch {
  console.log("Server not running on :3000 — automatically starting node dist/server.js...");
  autoStartedServer = spawn("node", ["dist/server.js"], { stdio: "ignore" });
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      const h = await fetch(BASE + "/api/health");
      if (h.ok) break;
    } catch {}
  }
}

const stamp = Date.now();
const email = `planpass-verify-${stamp}@example.com`;
const password = "PlanPass-Verify-2026!";
let cookie = "";
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) process.exitCode = 1;
}
async function req(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(BASE + path, { ...opts, headers, redirect: "manual" });
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
  return res;
}
async function json(path, opts = {}) {
  const res = await req(path, opts);
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch {}
  return { res, data, text };
}

// 1. Public UI + health (DB + Neon Function + Meta base URL)
{
  const { res, text } = await json("/api/health");
  const d = JSON.parse(text);
  check("health", res.status === 200 && d.db === "ok" && String(d.helloFunction).includes("Hello from Neon Functions"), `db=${d.db} fn=${d.helloFunction} meta=${d.metaApi}`);
  const home = await (await fetch(BASE + "/")).text();
  check("CAD studio UI served", home.includes("PlanPass") && home.includes("Layer controls") && home.includes("Voice Scope"));
  const bench = JSON.parse(await (await fetch(BASE + "/api/benchmarks")).text()).catch?.(() => null) ?? null;
}

// 2. Auth: sign up (Neon Auth via proxy), session via /api/me
{
  const { res, data } = await json("/api/auth/sign-up/email", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, name: "PlanPass Verify" }),
  });
  check("auth sign-up", res.status === 200 || res.status === 201, `status=${res.status}`);
  const me = await json("/api/me");
  check("auth session /api/me", me.res.status === 200 && !!me.data.user?.id, `user=${me.data.user?.id ?? "none"}`);
  var userId = me.data.user?.id;
}

// 3. Samples are inputs only; canned benchmark route is gone; live inspect is real.
{
  const samples = JSON.parse(await (await fetch(BASE + "/api/samples")).text());
  check("samples carry no canned verdicts", Array.isArray(samples) && samples.length === 3 && samples.every((s) => !("readinessScore" in s) && !("violations" in s) && !("samOverlays" in s)), `count=${samples.length}`);
  const gone = await json("/api/inspect/benchmark/cafe-violation", { method: "POST" });
  check("canned benchmark inspection removed", gone.res.status === 404, `status=${gone.res.status}`);
}
const png = await readFile("test_floorplan.png");
const live = await json("/api/inspect", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({
    imageBase64: Buffer.from(png).toString("base64"), imageMime: "image/png",
    occupancy: "Commercial Assembly", instruction: "Check corridor egress and ADA turning space",
    concepts: ["door", "corridor", "bathroom", "room"],
  }),
});
const v = live.data;
check("live inspection (SAM+Spark, real result)", live.res.status === 200 && !!v.inspectionId && Array.isArray(v.violations) && Array.isArray(v.samOverlays) && Array.isArray(v.mcpTrace),
  `score=${v.readinessScore} status=${v.status} violations=${v.violations?.length} overlays=${v.samOverlays?.length}`);
check("status consistent with violations", (v.violations?.length === 0 && v.status === "APPROVED") || (v.violations?.length > 0 && v.status === "HOLD"), `status=${v.status}`);
check("no fabricated zero boxes", !(v.samOverlays ?? []).some((o) => o.box_px?.[2] === 0 && o.box_px?.[3] === 0), `overlays=${v.samOverlays?.length}`);

// 4. Runtime statute corpus (data/statutes.json)
{
  const { data } = await json("/api/statutes/ADA-604.3.2");
  check("statute lookup ADA-604.3.2", String(data.text || "").includes("door swing does not overlap"), (data.title || ""));
  const all = await json("/api/statutes");
  check("statute corpus endpoint", (all.data.statutes?.length ?? 0) >= 6, `count=${all.data.statutes?.length}`);
}

// 5. Upload floorplan -> Neon S3 assets bucket + plans row + presigned URL
let planId = null;
{
  const svg = await readFile("public/benchmarks/cafe-violation.svg");
  const form = new FormData();
  form.append("file", new Blob([svg], { type: "image/svg+xml" }), "cafe-violation.svg");
  const { res, data } = await json("/api/plans/upload", { method: "POST", body: form });
  planId = data.plan?.id;
  check("upload -> S3 assets", res.status === 201 && !!planId && String(data.plan?.s3Key || "").startsWith("plans/"), `key=${data.plan?.s3Key}`);
  const list = await json("/api/plans");
  check("plans list (DB + presign)", list.data.plans?.some(p => p.id === planId && String(p.url||"").includes("assets")), `count=${list.data.plans?.length}`);
  if (data.plan?.url) {
    const got = await fetch(data.plan.url);
    check("presigned download", got.status === 200, `status=${got.status}`);
  }
}

// 6. History persisted in Neon Postgres + Realtime sealed query
{
  const hist = await json("/api/inspections");
  check("inspection history (Postgres)", hist.res.status === 200 && (hist.data.inspections?.length ?? 0) >= 1, `rows=${hist.data.inspections?.length}`);
  const live = await json("/api/inspections/live", { method: "POST" });
  check("realtime sealed query", live.res.status === 200 && !!live.data.capability && !!live.data.expiresAt, `expiresAt=${live.data.expiresAt}`);
}

// 7. Exports: stamped PDF packet + JSONL dataset
{
  const pdfRes = await req(`/api/inspections/${v.inspectionId}/permit.pdf`);
  const buf = new Uint8Array(await pdfRes.arrayBuffer());
  const head = new TextDecoder().decode(buf.slice(0, 5));
  check("permit PDF", pdfRes.status === 200 && head === "%PDF-", `bytes=${buf.length}`);
  const jl = await req(`/api/inspections/${v.inspectionId}/dataset.jsonl`);
  const txt = await jl.text();
  check("JSONL dataset", jl.status === 200 && txt.includes(v.inspectionId), `bytes=${txt.length}`);
}

// 8. No deterministic shortcuts: redline/reverify must use real images/results.
{
  const det = await json("/api/redline", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ inspectionId: v.inspectionId, benchmarkId: "cafe-violation", mode: "deterministic" }),
  });
  check("deterministic redline shortcut removed", det.res.status === 400 && !det.data.reverifiedReport, `status=${det.res.status}`);
  const noRed = await json("/api/reverify", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ inspectionId: v.inspectionId, benchmarkId: "cafe-violation" }),
  });
  check("deterministic reverify shortcut removed", noRed.res.status === 400, `status=${noRed.res.status}`);
  // Dual-generation package + key-only storage (no live generation in e2e).
  const pkg = await json(`/api/inspections/${v.inspectionId}/package`);
  check("export package shape", pkg.res.status === 200 && pkg.data.cleanPlan === null && Array.isArray(pkg.data.redlinePackage?.violations),
    `status=${pkg.res.status} cleanPlan=${pkg.data.cleanPlan}`);
  const stored = await json(`/api/inspections/${v.inspectionId}`);
  check("report stores keys not base64", stored.res.status === 200 && !("redlineImageBase64" in stored.data) && stored.text.length < 20000,
    `bytes=${stored.text.length}`);
  const em404 = await json(`/api/inspections/insp_missing/email-permit`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}),
  });
  check("email unknown inspection -> 404", em404.res.status === 404, `status=${em404.res.status}`);
}

// 9. Second user isolation (cross-user history must be empty of first user's rows)
{
  const email2 = `planpass-verify-b-${stamp}@example.com`;
  const saved = cookie; cookie = "";
  await json("/api/auth/sign-up/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: email2, password, name: "Verify B" }) });
  const histB = await json("/api/inspections");
  check("cross-user isolation", histB.res.status === 200 && (histB.data.inspections?.length ?? -1) === 0, `userB rows=${histB.data.inspections?.length}`);
  cookie = saved;
}

console.log("\n" + results.filter(r=>r.ok).length + "/" + results.length + " checks passed");

if (autoStartedServer) {
  autoStartedServer.kill();
}
