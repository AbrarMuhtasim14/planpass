import { readFileSync } from "node:fs";
import { env } from "./env.js";

// Statute corpus is runtime data (data/statutes.json by default, override
// with STATUTES_FILE), not code. Add/edit codes without recompiling.
// Cited text still only ever originates here — never from model memory.
export interface Statute {
  codeId: string;
  title: string;
  text: string;
}

interface CorridorRule {
  occupancies: string[];
  requiredIn: number;
  statuteCodeId: string;
}

interface StatuteCorpus {
  statutes: Statute[];
  rules: {
    corridorWidth: CorridorRule[];
    turningCircle: { requiredIn: number; statuteCodeId: string; obstructionKeywords: string[] };
  };
}

const DEFAULT_CORPUS: StatuteCorpus = {
  statutes: [
    {
      codeId: "ADA-304.3",
      title: "Turning Space",
      text: "ADA 2010 Section 304.3: A turning space shall be a space of 60 inches (1525 mm) diameter minimum, or a T-shaped space complying with 304.3.2, provided for a wheelchair to make a 180-degree turn.",
    },
    {
      codeId: "ADA-604.3.2",
      title: "Overlap of Water Closet Clearance",
      text: "ADA 2010 Section 604.3.2: The required clearance around the water closet shall be permitted to overlap the water closet, associated grab bars, dispensers, sanitary napkin disposal units, coat hooks, shelves, accessible routes, clear floor space and clearances required at other fixtures, and the turning space, provided door swing does not overlap required fixture clearance.",
    },
    {
      codeId: "ADA-404.2.3",
      title: "Clear Width of Doorways",
      text: "ADA 2010 Section 404.2.3: Door openings shall provide a clear width of 32 inches (815 mm) minimum. Clear openings of doorways with swinging doors shall be measured between the face of the door and the stop, with the door open 90 degrees.",
    },
    {
      codeId: "IBC-1020.2",
      title: "Corridor Fire-Resistance Rating / Width",
      text: "IBC 2024 Section 1020.2 (Table 1020.2): Corridors in Group I-2 (hospitals and healthcare facilities) serving patient rooms, emergency suites, and bed movement shall have a minimum clear width of 96 inches (2438 mm). Corridors in Group E (educational / schools) occupancies serving an occupant load greater than 100 shall have a minimum clear width of 72 inches (1829 mm). Corridors in Group A (assembly) occupancies serving an occupant load greater than 30 shall have a minimum clear width of 44 inches (1118 mm). Corridors in Group R occupancies shall have a minimum clear width of 36 inches (914 mm).",
    },
    {
      codeId: "IRC-R310.1",
      title: "Emergency Escape and Rescue Openings",
      text: "IRC Section R310.1: Basements, habitable attics and every sleeping room shall have not less than one operable emergency escape and rescue opening with a minimum net clear opening of 5.7 square feet (5.0 square feet for grade-floor openings), minimum net clear opening height of 24 inches and minimum net clear opening width of 20 inches.",
    },
    {
      codeId: "IRC-R304.1",
      title: "Minimum Habitable Room Area",
      text: "IRC Section R304.1: Every dwelling unit shall have at least one habitable room that shall have not less than 120 square feet of gross floor area. Other habitable rooms shall have a floor area of not less than 70 square feet.",
    },
  ],
  rules: {
    corridorWidth: [
      { occupancies: ["hospital", "institutional", "group i", "i-2", "healthcare"], requiredIn: 96, statuteCodeId: "IBC-1020.2" },
      { occupancies: ["school", "education", "educational", "group e", "e-", "academy"], requiredIn: 72, statuteCodeId: "IBC-1020.2" },
      { occupancies: ["assembly", "commercial", "cafe", "group a", "a-"], requiredIn: 44, statuteCodeId: "IBC-1020.2" },
      { occupancies: ["residential", "group r", "r-"], requiredIn: 36, statuteCodeId: "IBC-1020.2" },
      { occupancies: ["factory", "industrial", "group f", "f-1", "f-2", "*"], requiredIn: 44, statuteCodeId: "IBC-1020.2" },
    ],
    turningCircle: {
      requiredIn: 60,
      statuteCodeId: "ADA-604.3.2",
      obstructionKeywords: ["door swing", "door", "swing", "overlap", "obstruct"],
    },
  },
};

let corpusCache: StatuteCorpus | null = null;

export function loadCorpus(): StatuteCorpus {
  if (corpusCache) return corpusCache;
  try {
    const raw = readFileSync(env.statutesFile, "utf8");
    const parsed = JSON.parse(raw) as StatuteCorpus;
    if (parsed.statutes && parsed.statutes.length > 0) {
      corpusCache = parsed;
      return corpusCache;
    }
  } catch {
    // Falls through to DEFAULT_CORPUS
  }
  corpusCache = DEFAULT_CORPUS;
  return corpusCache;
}

export function allStatutes(): Statute[] {
  return loadCorpus().statutes;
}

const normalize = (s: string) => s.trim().toUpperCase().replace(/\s+/g, "");

export function findStatute(codeId: string): Statute | undefined {
  const normalized = normalize(codeId);
  const statutes = allStatutes();
  return (
    statutes.find((s) => normalize(s.codeId) === normalized) ??
    statutes.find(
      (s) => normalized.includes(normalize(s.codeId)) || normalized.includes(normalize(s.codeId).replace(/^(ADA|IBC|IRC)-/, "")),
    )
  );
}

// Keyword search over codeId/title/text so applicability can be discovered
// from the inspection scope instead of recalled section numbers.
export function searchStatutes(query: string): Statute[] {
  const words = query.toLowerCase().split(/[^a-z0-9.]+/).filter((w) => w.length > 2);
  if (!words.length) return [];
  return allStatutes()
    .map((s) => {
      const hay = `${s.codeId} ${s.title} ${s.text}`.toLowerCase();
      return { s, hits: words.filter((w) => hay.includes(w)).length };
    })
    .filter((r) => r.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .map((r) => r.s);
}

// Resolve any citation string (e.g. "ADA 2010 §604.3.2 & §304.3") to a real
// corpus entry, or undefined when the citation cannot be verified.
export function resolveCitation(citation: string): Statute | undefined {
  const direct = findStatute(citation);
  if (direct) return direct;
  const tokens = citation.match(/(?:ADA|IBC|IRC)[-\s]?[A-Z]?\d+(?:\.\d+)*/gi) ?? [];
  for (const t of tokens) {
    const found = findStatute(t);
    if (found) return found;
  }
  return undefined;
}

const LIVE_UA = "PlanPass/1.0 (municipal-audit)";

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface EcfrStatute extends Statute {
  source: string;
  titleNumber: string;
}

// Live federal ADA rules from the US eCFR API (Titles 36 / 28), parsed into Statute shape.
export async function lookup_ecfr_federal_rule(args: {
  query: string;
}): Promise<{ query: string; statutes: EcfrStatute[]; source: string; error?: string }> {
  const query = (args.query ?? "").trim();
  if (!query) return { query, statutes: [], source: "ecfr.gov", error: "query required" };
  try {
    const res = await fetch(
      `https://www.ecfr.gov/api/search/v1/results?query=${encodeURIComponent(query)}`,
      { headers: { "User-Agent": LIVE_UA }, signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return { query, statutes: [], source: "ecfr.gov", error: `eCFR HTTP ${res.status}` };
    const data = (await res.json()) as {
      results?: Array<{
        hierarchy?: { title?: string; part?: string; section?: string; appendix?: string };
        headings?: { part?: string };
        full_text_excerpt?: string;
      }>;
    };
    const statutes: EcfrStatute[] = (data.results ?? [])
      .filter((r) => r.hierarchy?.title === "36" || r.hierarchy?.title === "28")
      .slice(0, 3)
      .map((r) => {
        const part = r.hierarchy?.part ?? "";
        const section = r.hierarchy?.section ?? r.hierarchy?.appendix ?? "";
        return {
          codeId: `eCFR Title ${r.hierarchy?.title} Part ${part}${section ? ` ${section}` : ""}`.trim(),
          title: stripHtml(r.headings?.part ?? "Federal ADA rule"),
          text: stripHtml(r.full_text_excerpt ?? "").slice(0, 900),
          source: "https://www.ecfr.gov (live)",
          titleNumber: r.hierarchy?.title ?? "",
        };
      })
      .filter((s) => s.text.length > 0);
    return { query, statutes, source: "ecfr.gov" };
  } catch (e) {
    return { query, statutes: [], source: "ecfr.gov", error: String(e) };
  }
}

export interface Jurisdiction {
  query: string;
  city: string;
  county: string;
  state: string;
  postcode: string;
  country: string;
  displayName: string;
  lat: number | null;
  lon: number | null;
  source: string;
  error?: string;
}

// Live municipal jurisdiction resolution via OpenStreetMap Nominatim.
export async function lookup_jurisdiction(args: { address: string }): Promise<Jurisdiction> {
  const query = (args.address ?? "").trim();
  const empty: Jurisdiction = {
    query, city: "", county: "", state: "", postcode: "", country: "",
    displayName: "", lat: null, lon: null, source: "nominatim.openstreetmap.org",
  };
  if (!query) return { ...empty, error: "address required" };
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=1`,
      { headers: { "User-Agent": LIVE_UA }, signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return { ...empty, error: `Nominatim HTTP ${res.status}` };
    const data = (await res.json()) as Array<{
      display_name?: string;
      lat?: string;
      lon?: string;
      address?: { city?: string; town?: string; village?: string; county?: string; state?: string; postcode?: string; country?: string };
    }>;
    const hit = data[0];
    if (!hit) return { ...empty, error: "No jurisdiction match for address" };
    const a = hit.address ?? {};
    return {
      query,
      city: a.city ?? a.town ?? a.village ?? "",
      county: a.county ?? "",
      state: a.state ?? "",
      postcode: a.postcode ?? "",
      country: a.country ?? "",
      displayName: hit.display_name ?? "",
      lat: hit.lat ? Number(hit.lat) : null,
      lon: hit.lon ? Number(hit.lon) : null,
      source: "nominatim.openstreetmap.org",
    };
  } catch (e) {
    return { ...empty, error: String(e) };
  }
}

export function lookup_ibc_ada_statute(args: { code_id?: string; query?: string }): Statute {
  const found = args.code_id ? findStatute(args.code_id) : undefined;
  if (found) return found;
  if (args.query) {
    const [hit] = searchStatutes(args.query);
    if (hit) return hit;
  }
  const asked = args.code_id ?? args.query ?? "";
  return {
    codeId: asked,
    title: "Not in local statute dictionary",
    text: `No verbatim statute found for "${asked}" in the runtime statute corpus (${env.statutesFile}). This citation must not be hallucinated — flag for senior PE review.`,
  };
}

export function evaluate_corridor_width(args: {
  measured_in: number;
  occupancy: string;
}): { measured_in: number; required_in: number; pass: boolean; statute: Statute } {
  const occ = args.occupancy.toLowerCase();
  const rules = loadCorpus().rules.corridorWidth;
  const rule =
    rules.find((r) => r.occupancies.some((o) => o !== "*" && occ.includes(o))) ??
    rules.find((r) => r.occupancies.includes("*")) ??
    rules[0];
  const required_in = rule?.requiredIn ?? 0;
  return {
    measured_in: args.measured_in,
    required_in,
    pass: required_in > 0 && args.measured_in >= required_in,
    statute: lookup_ibc_ada_statute({ code_id: rule?.statuteCodeId ?? "IBC-1020.2" }),
  };
}

export function evaluate_ada_turning_circle(args: {
  clear_diameter_in: number;
  obstruction: string;
}): { clear_diameter_in: number; required_in: number; pass: boolean; statute: Statute } {
  const rule = loadCorpus().rules.turningCircle;
  const obstruction = args.obstruction.toLowerCase();
  const isExplicitlyClear = /none|clear|outward|no obstruction|unobstructed/.test(obstruction);
  const obstructed = !isExplicitlyClear && rule.obstructionKeywords.some((k) => k && obstruction.includes(k));
  return {
    clear_diameter_in: args.clear_diameter_in,
    required_in: rule.requiredIn,
    pass: !obstructed && rule.requiredIn > 0 && args.clear_diameter_in >= rule.requiredIn,
    statute: lookup_ibc_ada_statute({ code_id: rule.statuteCodeId }),
  };
}

export const MCP_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "lookup_ibc_ada_statute",
      description: "Look up verbatim building-code text from the runtime statute corpus. Call with code_id when known, or with query keywords to discover the applicable section. Always call before citing a code section.",
      parameters: {
        type: "object",
        properties: {
          code_id: { type: "string", description: 'e.g. "ADA-604.3.2", "IBC-1020.2", "ADA-304.3"' },
          query: { type: "string", description: "Keyword query, e.g. \"wheelchair turning space door swing\"" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "evaluate_corridor_width",
      description: "Evaluate a measured corridor clear width in inches against the corpus corridor rule for the occupancy.",
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
      description: "Evaluate an ADA wheelchair turning circle clear diameter in inches against the corpus turning-circle rule, including door-swing obstruction.",
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
  {
    type: "function" as const,
    function: {
      name: "lookup_ecfr_federal_rule",
      description: "Fetch live federal ADA rule excerpts from the US eCFR API (Titles 36/28). Call when a federal ADA citation or current federal text is needed beyond the local corpus.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: 'e.g. "wheelchair turning space", "door clear width"' },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "lookup_jurisdiction",
      description: "Resolve a street address to its live municipal jurisdiction (city, county, state) via OpenStreetMap Nominatim. Call when the plan address or jurisdiction is mentioned.",
      parameters: {
        type: "object",
        properties: {
          address: { type: "string", description: 'e.g. "1600 Amphitheatre Parkway, Mountain View, CA"' },
        },
        required: ["address"],
      },
    },
  },
];

export async function runMcpTool(name: string, argsJson: string): Promise<unknown> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(argsJson || "{}") as Record<string, unknown>;
  } catch {
    args = {};
  }
  if (name === "lookup_ibc_ada_statute") {
    return lookup_ibc_ada_statute({
      code_id: args.code_id ? String(args.code_id) : undefined,
      query: args.query ? String(args.query) : undefined,
    });
  }
  if (name === "evaluate_corridor_width") {
    return evaluate_corridor_width({
      measured_in: Number(args.measured_in ?? 0),
      occupancy: String(args.occupancy ?? ""),
    });
  }
  if (name === "evaluate_ada_turning_circle") {
    return evaluate_ada_turning_circle({
      clear_diameter_in: Number(args.clear_diameter_in ?? 0),
      obstruction: String(args.obstruction ?? ""),
    });
  }
  if (name === "lookup_ecfr_federal_rule") {
    return lookup_ecfr_federal_rule({ query: String(args.query ?? "") });
  }
  if (name === "lookup_jurisdiction") {
    return lookup_jurisdiction({ address: String(args.address ?? "") });
  }
  return { error: `Unknown MCP tool ${name}` };
}
