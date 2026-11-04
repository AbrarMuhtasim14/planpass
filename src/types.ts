/** Free-form occupancy description supplied per request — never a fixed enum. */
export type Occupancy = string;

export interface SamOverlay {
  concept: string;
  objectId: number;
  box_px: [number, number, number, number];
  compliant: boolean;
  /** SVG path decoded from the SAM mask (mask-raster coordinates; see mask_w/mask_h). */
  svg_path?: string;
  mask_w?: number;
  mask_h?: number;
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
  status: "ok" | "skipped" | "error";
  latencyMs: number;
}

export interface InspectionReport {
  inspectionId: string;
  status: "HOLD" | "APPROVED";
  readinessScore: number;
  transcript: string;
  occupancy: Occupancy;
  source: "upload" | "redline";
  planId: string | null;
  /** Content hash of inspected image bytes + audit params (repeat-run cache key). */
  planHash?: string;
  paramsHash?: string;
  trace: StepTrace[];
  samOverlays: SamOverlay[];
  violations: Violation[];
  mcpTrace: McpTraceEntry[];
  /** Non-fatal honesty notes, e.g. citations dropped as unverifiable. */
  warnings?: string[];
  /** Node 4 outputs: S3 keys only — never base64 bodies in JSONB. */
  redlineKey?: string;
  redlineMime?: string;
  revisedKey?: string;
  revisedMime?: string;
  /** Transient presigned URLs minted per-response (not persisted). */
  redlineUrl?: string;
  revisedUrl?: string;
}

export interface ElementRow {
  concept: string;
  objectId: number;
  compliant: boolean;
}

export interface AuditInput {
  inputImageB64: string;
  /** Presigned S3 URL for the same image; preferred Meta transport (no per-round base64). */
  inputImageUrl?: string;
  inputMime: string;
  planId: string | null;
  source: InspectionReport["source"];
  floorplanKey: string;
  occupancy: Occupancy;
  imageWidthPx: number;
  imageHeightPx: number;
  instruction: string;
  /** Optional caller-supplied SAM concepts; when absent the agent proposes them from the image. */
  concepts?: string[];
  /** Optional caller-supplied scale calibration (pixels per foot) used for measurements. */
  pixelsPerFoot?: number;
}
