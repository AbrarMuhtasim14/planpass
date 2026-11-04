// Live-only / flexibility checks: no canned results, runtime-derived inputs.
// Run after `npm run build`: node scripts/test-flexibility.mjs
import { readFile } from "node:fs/promises";
import { SAMPLES } from "../dist/samples.js";
import { imageInfo } from "../dist/image.js";
import { searchStatutes, lookup_ibc_ada_statute } from "../dist/statutes.js";
import { statusForAudit } from "../dist/meta.js";

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}

// Samples are inputs only — no precomputed scores, violations, or overlays.
check("samples carry no canned verdicts",
  SAMPLES.length > 0 && SAMPLES.every((s) => Object.keys(s).sort().join(",") === "file,id,label"),
  SAMPLES.map((s) => s.id).join(","));

// Image dimensions/mime are read from the actual bytes, not assumed 1000x800/png.
{
  const png = await readFile("test_floorplan.png");
  const info = imageInfo(new Uint8Array(png));
  check("PNG info from bytes", info?.mime === "image/png" && info.width > 0 && info.height > 0,
    `${info?.mime} ${info?.width}x${info?.height}`);
  const svg = await readFile("public/benchmarks/cafe-violation.svg");
  const sinfo = imageInfo(new Uint8Array(svg));
  check("SVG info from bytes", sinfo?.mime === "image/svg+xml" && sinfo.width === 1000 && sinfo.height === 800,
    `${sinfo?.mime} ${sinfo?.width}x${sinfo?.height}`);
}

// Statutes are searchable runtime data, not only exact code-id recall.
{
  const hits = searchStatutes("wheelchair turning space door swing");
  check("statute keyword search", hits.some((s) => s.codeId === "ADA-604.3.2" || s.codeId === "ADA-304.3"),
    hits.map((s) => s.codeId).join(","));
  check("unknown statute is not invented", lookup_ibc_ada_statute({ code_id: "XYZ-999.9" }).title.includes("Not in"),
    lookup_ibc_ada_statute({ code_id: "XYZ-999.9" }).title);
}

// Status is derived from real audit outcome, not a fixed score threshold.
check("status derives from violations",
  statusForAudit([], true) === "APPROVED" &&
  statusForAudit([{ id: "V-01" }], true) === "HOLD" &&
  statusForAudit([], false) === "HOLD");

console.log(failures ? `\n${failures} flexibility check(s) FAILED` : "\nAll flexibility checks passed");
process.exit(failures ? 1 : 0);
