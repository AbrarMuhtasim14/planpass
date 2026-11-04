// Sample floorplans are INPUTS only. They carry no scores, violations,
// overlays, or traces — every inspection result is produced live by the
// 4-node pipeline from the actual image bytes.
export interface SampleDef {
  id: string;
  label: string;
  file: string;
}

export const SAMPLES: SampleDef[] = [
  { id: "cafe-violation", label: "Commercial Cafe — sample plan A", file: "cafe-violation.svg" },
  { id: "cafe-compliant", label: "Commercial Cafe — sample plan B", file: "cafe-compliant.svg" },
  { id: "residential-adu", label: "Residential ADU — sample plan", file: "residential-adu.svg" },
  { id: "garments-factory", label: "Garments Manufacturing (Group F-1) — Ground Floor", file: "garments_factory_floorplan.jpg" },
  { id: "hospital-first-floor", label: "General Hospital (Group I-2) — First Floor", file: "hospital_first_floor.jpg" },
];

export function getSample(id: string): SampleDef | undefined {
  return SAMPLES.find((s) => s.id === id);
}
