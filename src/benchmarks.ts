// Removed: this module previously held canned benchmark scores, violations,
// overlays, and fabricated MCP traces. Sample plans are now live-inspected
// inputs only — see src/samples.ts. Kept as a re-export shim so stale imports
// fail on the removed result APIs instead of silently using canned data.
export { SAMPLES as BENCHMARKS, getSample } from "./samples.js";
export type { SampleDef as BenchmarkDef } from "./samples.js";
