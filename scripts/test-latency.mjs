import { readFile } from "node:fs/promises";
import "../dist/env.js";
import { runLiveInspection } from "../dist/meta.js";

async function run() {
  console.log("Reading test_floorplan.png...");
  const bytes = await readFile("test_floorplan.png");
  const b64 = Buffer.from(bytes).toString("base64");

  console.log("Starting runLiveInspection...");
  const t0 = Date.now();
  const report = await runLiveInspection({
    inputImageB64: b64,
    inputMime: "image/png",
    planId: "test-latency-plan",
    source: "upload",
    floorplanKey: "test",
    occupancy: "Commercial Assembly",
    imageWidthPx: 848,
    imageHeightPx: 772,
    instruction: "Audit this commercial floorplan for ADA restroom clearance and IBC egress corridor width",
    concepts: [],
  });
  const totalSec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n=== INSPECTION COMPLETED IN ${totalSec}s ===`);
  console.log("Trace:", JSON.stringify(report.trace, null, 2));
  console.log("MCP Tool Count:", report.mcpTrace.length);
  console.log("Score:", report.readinessScore, "Status:", report.status);
  console.log("Violations:", report.violations.map(v => `${v.id}: ${v.title}`));
}

run().catch(console.error);
