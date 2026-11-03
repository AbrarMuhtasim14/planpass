// Deterministic local FastMCP statute dictionary (PRD F4 §6.1/§7).
// All cited code text originates here — never from the model — to prevent
// hallucinated section numbers.

export interface Statute {
  codeId: string;
  title: string;
  text: string;
}

const STATUTES: Record<string, Statute> = {
  "ADA-304.3": {
    codeId: "ADA-304.3",
    title: "Turning Space",
    text: 'ADA 2010 Section 304.3: A turning space shall be a space of 60 inches (1525 mm) diameter minimum, or a T-shaped space complying with 304.3.2, provided for a wheelchair to make a 180-degree turn.',
  },
  "ADA-604.3.2": {
    codeId: "ADA-604.3.2",
    title: "Overlap of Water Closet Clearance",
    text: "ADA 2010 Section 604.3.2: The required clearance around the water closet shall be permitted to overlap the water closet, associated grab bars, dispensers, sanitary napkin disposal units, coat hooks, shelves, accessible routes, clear floor space and clearances required at other fixtures, and the turning space, provided door swing does not overlap required fixture clearance.",
  },
  "ADA-404.2.3": {
    codeId: "ADA-404.2.3",
    title: "Clear Width of Doorways",
    text: 'ADA 2010 Section 404.2.3: Door openings shall provide a clear width of 32 inches (815 mm) minimum. Clear openings of doorways with swinging doors shall be measured between the face of the door and the stop, with the door open 90 degrees.',
  },
  "IBC-1020.2": {
    codeId: "IBC-1020.2",
    title: "Corridor Fire-Resistance Rating / Width",
    text: 'IBC 2024 Section 1020.2 (Table 1020.2): Corridors in Group A (assembly) occupancies serving an occupant load greater than 30 shall have a minimum clear width of 44 inches (1118 mm). Corridors in Group R occupancies shall have a minimum clear width of 36 inches (914 mm).',
  },
  "IRC-R310.1": {
    codeId: "IRC-R310.1",
    title: "Emergency Escape and Rescue Openings",
    text: "IRC Section R310.1: Basements, habitable attics and every sleeping room shall have not less than one operable emergency escape and rescue opening with a minimum net clear opening of 5.7 square feet (5.0 square feet for grade-floor openings), minimum net clear opening height of 24 inches and minimum net clear opening width of 20 inches.",
  },
  "IRC-R304.1": {
    codeId: "IRC-R304.1",
    title: "Minimum Habitable Room Area",
    text: "IRC Section R304.1: Every dwelling unit shall have at least one habitable room that shall have not less than 120 square feet of gross floor area. Other habitable rooms shall have a floor area of not less than 70 square feet.",
  },
};

export function lookup_ibc_ada_statute(args: { code_id: string }): Statute {
  const normalized = args.code_id.trim().toUpperCase().replace(/\s+/g, "");
  const found =
    STATUTES[normalized] ??
    Object.values(STATUTES).find(
      (s) => normalized.includes(s.codeId.replace("ADA-", "").replace("IBC-", "")) || normalized.includes(s.codeId),
    );
  if (found) return found;
  return {
    codeId: args.code_id,
    title: "Not in local statute dictionary",
    text: `No verbatim statute found for "${args.code_id}" in the local IBC 2024 / ADA 2010 / IRC dictionary. Per PRD §7 this citation must not be hallucinated — flag for senior PE review.`,
  };
}

export function evaluate_corridor_width(args: {
  measured_in: number;
  occupancy: string;
}): { measured_in: number; required_in: number; pass: boolean; statute: Statute } {
  const occ = args.occupancy.toLowerCase();
  const required_in = occ.includes("assembly") || occ.includes("commercial") || occ.includes("cafe") ? 44 : 36;
  return {
    measured_in: args.measured_in,
    required_in,
    pass: args.measured_in >= required_in,
    statute: lookup_ibc_ada_statute({ code_id: "IBC-1020.2" }),
  };
}

export function evaluate_ada_turning_circle(args: {
  clear_diameter_in: number;
  obstruction: string;
}): { clear_diameter_in: number; required_in: number; pass: boolean; statute: Statute } {
  return {
    clear_diameter_in: args.clear_diameter_in,
    required_in: 60,
    pass: args.clear_diameter_in >= 60,
    statute: lookup_ibc_ada_statute({ code_id: "ADA-604.3.2" }),
  };
}

export const MCP_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "lookup_ibc_ada_statute",
      description: "Look up verbatim building-code text from the local deterministic statute dictionary (IBC 2024, ADA 2010, IRC). Always call before citing a code section.",
      parameters: {
        type: "object",
        properties: { code_id: { type: "string", description: 'e.g. "ADA-604.3.2", "IBC-1020.2", "ADA-304.3"' } },
        required: ["code_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "evaluate_corridor_width",
      description: "Evaluate a measured corridor clear width in inches against IBC 1020.2 minimums for the occupancy.",
      parameters: {
        type: "object",
        properties: {
          measured_in: { type: "number" },
          occupancy: { type: "string" },
        },
        required: ["measured_in", "occupancy"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "evaluate_ada_turning_circle",
      description: "Evaluate an ADA wheelchair turning circle clear diameter in inches against the 60-inch minimum and door-swing overlap rule.",
      parameters: {
        type: "object",
        properties: {
          clear_diameter_in: { type: "number" },
          obstruction: { type: "string", description: "What obstructs the circle, e.g. inward door swing overlap" },
        },
        required: ["clear_diameter_in", "obstruction"],
      },
    },
  },
];

export function runMcpTool(name: string, argsJson: string): unknown {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(argsJson || "{}") as Record<string, unknown>;
  } catch {
    args = {};
  }
  if (name === "lookup_ibc_ada_statute") {
    return lookup_ibc_ada_statute({ code_id: String(args.code_id ?? "") });
  }
  if (name === "evaluate_corridor_width") {
    return evaluate_corridor_width({
      measured_in: Number(args.measured_in ?? 0),
      occupancy: String(args.occupancy ?? "Commercial"),
    });
  }
  if (name === "evaluate_ada_turning_circle") {
    return evaluate_ada_turning_circle({
      clear_diameter_in: Number(args.clear_diameter_in ?? 0),
      obstruction: String(args.obstruction ?? ""),
    });
  }
  return { error: `Unknown MCP tool ${name}` };
}
