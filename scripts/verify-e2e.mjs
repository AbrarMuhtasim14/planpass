// PlanPass end-to-end verification against the running server on :3000.
// Usage: node scripts/verify-e2e.mjs
import { readFile } from "node:fs/promises";

const BASE = "http://localhost:3000";
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

// 3. Benchmark cached audits (deterministic, PRD §7)
async function bench(id, score, status, violCount) {
  const { res, data } = await json(`/api/inspect/benchmark/${id}`, { method: "POST" });
  check(`benchmark ${id}`, res.status === 200 && data.readinessScore === score && data.status === status && (data.violations?.length ?? -1) === violCount,
    `score=${data.readinessScore} status=${data.status} violations=${data.violations?.length}`);
  return data;
}
const v = await bench("cafe-violation", 42, "HOLD", 2);
await bench("cafe-compliant", 98, "APPROVED", 0);
await bench("residential-adu", 96, "APPROVED", 0);
check("violation citations", v.violations?.[0]?.codeSection?.includes("604.3.2") && v.violations?.[1]?.codeSection?.includes("1020.2"), v.violations?.map(x=>x.codeSection).join(" | "));

// 4. Statute dictionary (deterministic MCP source)
{
  const { data } = await json("/api/statutes/ADA-604.3.2");
  check("statute lookup ADA-604.3.2", String(data.text || "").includes("door swing does not overlap"), (data.title || ""));
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
  check("inspection history (Postgres)", hist.res.status === 200 && (hist.data.inspections?.length ?? 0) >= 3, `rows=${hist.data.inspections?.length}`);
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

// 8. Closed-loop redline + re-verification (deterministic benchmark path)
{
  const { res, data } = await json("/api/redline", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ inspectionId: v.inspectionId, benchmarkId: "cafe-violation", mode: "deterministic" }),
  });
  check("redline + re-verify", res.status === 200 && data.reverifiedReport?.readinessScore === 98 && data.reverifiedReport?.status === "APPROVED" && !!data.redlineImageBase64,
    `score=${data.reverifiedReport?.readinessScore} status=${data.reverifiedReport?.status}`);
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
