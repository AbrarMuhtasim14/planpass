export type Occupancy = "Commercial" | "Business" | "Residential";

export interface SamOverlay {
  concept: string;
  objectId: number;
  box_px: [number, number, number, number];
  compliant: boolean;
}

export interface Violation {
  id: string;
  title: string;
  codeSection: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
  measuredValue: string;
  requiredValue: string;
  normBox1000: [number, number, number, number];
  remediationInstruction: string;
}

export interface McpTraceEntry {
  tool: string;
  input: Record<string, unknown>;
  output: string;
  latencyMs: number;
}

export interface StepTrace {
  node: number;
  model: string;
  status: "ok" | "cached" | "skipped" | "error";
  latencyMs: number;
}

export interface InspectionReport {
  inspectionId: string;
  status: "HOLD" | "APPROVED";
  readinessScore: number;
  transcript: string;
  occupancy: Occupancy;
  source: "benchmark" | "upload" | "redline";
  planId: string | null;
  trace: StepTrace[];
  samOverlays: SamOverlay[];
  violations: Violation[];
  mcpTrace: McpTraceEntry[];
}

export interface ElementRow {
  concept: string;
  objectId: number;
  compliant: boolean;
}

export interface AuditInput {
  inputImageB64: string;
  inputMime: string;
  planId: string | null;
  source: InspectionReport["source"];
  floorplanKey: string;
  occupancy: Occupancy;
  imageWidthPx: number;
  imageHeightPx: number;
  instruction: string;
}
