import { readFile } from "node:fs/promises";

const BASE = "http://localhost:3000";

async function main() {
  console.log("=== STEP 1: Authenticate with Neon Auth ===");
  const loginRes = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    body: JSON.stringify({ email: "abrarmohtasim14@gmail.com", password: "12345678" }),
  });
  console.log("Sign-in status:", loginRes.status);
  const setCookie = loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : [];
  const cookie = setCookie.map(c => c.split(';')[0]).join('; ');
  console.log("Got session cookie:", Boolean(cookie));

  console.log("\n=== STEP 2: Upload downloaded floorplan to Neon S3 ===");
  const fileBytes = await readFile("test_floorplan.png");
  const form = new FormData();
  form.append("file", new Blob([fileBytes], { type: "image/png" }), "downloaded_wikimedia_floorplan.png");
  
  const uploadRes = await fetch(`${BASE}/api/plans/upload`, {
    method: "POST",
    headers: { cookie },
    body: form,
  });
  console.log("Upload HTTP status:", uploadRes.status);
  const uploadData = await uploadRes.json();
  console.log("Uploaded plan ID:", uploadData.plan?.id);
  console.log("Neon S3 storage key:", uploadData.plan?.s3Key);

  console.log("\n=== STEP 3: Execute Full Agentic Inspection (Meta API sam-3.1 + muse-spark-1.3 + FastMCP) ===");
  console.log("Sending plan to /api/inspect (Occupancy: Commercial Assembly)...");
  const t0 = Date.now();
  const inspectRes = await fetch(`${BASE}/api/inspect`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      planId: uploadData.plan.id,
      occupancy: "Commercial",
      instruction: "Check this floorplan for IBC corridor width and ADA accessibility compliance",
    }),
  });
  const duration = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(`Inspection completed in ${duration}s. HTTP status:`, inspectRes.status);
  const report = await inspectRes.json();
  
  console.log("\n--- AGENTIC REPORT SUMMARY ---");
  console.log("Inspection ID:", report.inspectionId);
  console.log("Readiness Score:", report.readinessScore + "%");
  console.log("Status:", report.status);
  console.log("SAM Overlays Detected:", report.samOverlays?.length ?? 0);
  if (report.samOverlays?.length) {
    console.log("Detected elements:", report.samOverlays.map(o => `${o.concept}#${o.objectId}`).join(", "));
  }
  console.log("Violations Flagged:", report.violations?.length ?? 0);
  if (report.violations?.length) {
    report.violations.forEach((v, i) => {
      console.log(`  [${i+1}] ${v.id} (${v.severity}): ${v.title} -> ${v.codeSection}`);
      console.log(`      Measured: ${v.measuredValue} | Required: ${v.requiredValue}`);
      console.log(`      Remediation: ${v.remediationInstruction}`);
    });
  }
  console.log("Agent Step Trace:");
  report.trace?.forEach(t => console.log(`  • Node ${t.node} (${t.model}): ${t.status} (${t.latencyMs}ms)`));
  console.log("FastMCP Tool Calls:");
  report.mcpTrace?.forEach(m => console.log(`  • Tool: ${m.tool} (${m.latencyMs}ms) -> ${m.output?.slice(0, 80)}...`));

  console.log("\n=== STEP 4: Persisted in Neon PostgreSQL ===");
  const historyRes = await fetch(`${BASE}/api/inspections`, { headers: { cookie } });
  const history = await historyRes.json();
  console.log("Inspections in DB for user:", history.inspections?.length);
  const latest = history.inspections?.[0];
  console.log("Latest row:", latest?.id, latest?.status, latest?.readiness_score + "%");
}

main().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
