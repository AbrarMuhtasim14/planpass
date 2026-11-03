import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { InspectionReport, SamOverlay, Violation } from "./types.js";

export interface BenchmarkDef {
  id: string;
  label: string;
  file: string;
  occupancy: "Commercial" | "Business" | "Residential";
  transcript: string;
  readinessScore: number;
  status: "HOLD" | "APPROVED";
  samOverlays: SamOverlay[];
  violations: Violation[];
}

const cafeOverlays: SamOverlay[] = [
  { concept: "door", objectId: 1, box_px: [410, 360, 480, 430], compliant: false },
  { concept: "bathroom", objectId: 1, box_px: [360, 100, 550, 360], compliant: false },
  { concept: "corridor", objectId: 1, box_px: [360, 360, 550, 560], compliant: false },
  { concept: "room", objectId: 1, box_px: [60, 100, 940, 720], compliant: true },
];

const cafeViolations: Violation[] = [
  {
    id: "V-01",
    title: "Restroom Door Swing Overlaps Wheelchair Turning Space",
    codeSection: "ADA 2010 §604.3.2 & §304.3",
    severity: "CRITICAL",
    measuredValue: '46 in clear turning diameter (inward swing overlap of 14 in)',
    requiredValue: "60 in minimum unobstructed turning circle",
    normBox1000: [400, 200, 560, 380],
    remediationInstruction:
      "Flip restroom door swing outward into the alcove and add red dimension callout showing 60-inch clear turning circle.",
  },
  {
    id: "V-02",
    title: "Egress Corridor Below Minimum Clear Width",
    codeSection: "IBC 2024 §1020.2 (Table 1020.2)",
    severity: "CRITICAL",
    measuredValue: "32 in clear corridor width",
    requiredValue: "44 in minimum for Group A assembly (occupant load > 30)",
    normBox1000: [360, 360, 550, 560],
    remediationInstruction:
      "Widen corridor bottleneck to 44 in minimum clear and add red dimension line with clearance callout.",
  },
];

export const BENCHMARKS: BenchmarkDef[] = [
  {
    id: "cafe-violation",
    label: "Commercial Cafe — Violation State",
    file: "cafe-violation.svg",
    occupancy: "Commercial",
    transcript: "Check this commercial floorplan for ADA restroom clearance and IBC corridor egress width.",
    readinessScore: 42,
    status: "HOLD",
    samOverlays: cafeOverlays,
    violations: cafeViolations,
  },
  {
    id: "cafe-compliant",
    label: "Commercial Cafe — Compliant State",
    file: "cafe-compliant.svg",
    occupancy: "Commercial",
    transcript: "Verify ADA restroom clearance and corridor egress for PE sign-off.",
    readinessScore: 98,
    status: "APPROVED",
    samOverlays: cafeOverlays.map((o) => ({ ...o, compliant: true })),
    violations: [],
  },
  {
    id: "residential-adu",
    label: "Residential ADU Layout",
    file: "residential-adu.svg",
    occupancy: "Residential",
    transcript: "Check this ADU for bedroom egress window and habitable room area.",
    readinessScore: 96,
    status: "APPROVED",
    samOverlays: [
      { concept: "room", objectId: 1, box_px: [80, 100, 920, 700], compliant: true },
      { concept: "bathroom", objectId: 1, box_px: [80, 480, 360, 700], compliant: true },
      { concept: "door", objectId: 1, box_px: [855, 460, 920, 550], compliant: true },
    ],
    violations: [],
  },
];

export function getBenchmark(id: string): BenchmarkDef | undefined {
  return BENCHMARKS.find((b) => b.id === id);
}

export async function benchmarkSvgBytes(id: string): Promise<Uint8Array> {
  const def = getBenchmark(id);
  if (!def) throw new Error(`Unknown benchmark ${id}`);
  const buf = await readFile(join(process.cwd(), "public", "benchmarks", def.file));
  return new Uint8Array(buf);
}

export function cachedReport(def: BenchmarkDef): InspectionReport {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    inspectionId: `insp_bench_${def.id.replace(/-/g, "_")}`,
    status: def.status,
    readinessScore: def.readinessScore,
    transcript: def.transcript,
    occupancy: def.occupancy,
    source: "benchmark",
    planId: def.id,
    trace: [
      { node: 1, model: "muse-voice-transcribe-1.0", status: "cached", latencyMs: 0 },
      { node: 2, model: "sam-3.1", status: "cached", latencyMs: 0 },
      { node: 3, model: "muse-spark-1.3 + FastMCP", status: "cached", latencyMs: 0 },
      { node: 4, model: "muse-image-1.0", status: "skipped", latencyMs: 0 },
    ],
    samOverlays: def.samOverlays,
    violations: def.violations,
    mcpTrace:
      def.id === "cafe-violation"
        ? [
            {
              tool: "lookup_ibc_ada_statute",
              input: { code_id: "ADA-604.3.2" },
              output:
                "ADA 2010 Section 604.3.2: The required clearance around the water closet shall be permitted to overlap the water closet, associated grab bars, dispensers, sanitary napkin disposal units, coat hooks, shelves, accessible routes, clear floor space and clearances required at other fixtures, and the turning space, provided door swing does not overlap required fixture clearance.",
              latencyMs: 0,
            },
            {
              tool: "evaluate_corridor_width",
              input: { measured_in: 32, occupancy: "Commercial" },
              output: JSON.stringify({ measured_in: 32, required_in: 44, pass: false }),
              latencyMs: 0,
            },
            {
              tool: "evaluate_ada_turning_circle",
              input: { clear_diameter_in: 46, obstruction: "inward door swing overlap" },
              output: JSON.stringify({ clear_diameter_in: 46, required_in: 60, pass: false }),
              latencyMs: 0,
            },
          ]
        : [],
  };
}

export function remediatedReport(inspectionId: string): InspectionReport {
  const def = getBenchmark("cafe-compliant")!;
  const report = cachedReport(def);
  return {
    ...report,
    inspectionId,
    source: "redline",
    transcript: "Closed-loop re-verification of redlined floorplan.",
    trace: report.trace.map((t) =>
      t.node === 4
        ? { node: 4, model: "muse-image-1.0", status: "ok" as const, latencyMs: 0 }
        : t,
    ),
  };
}
