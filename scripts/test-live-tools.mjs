// Live public-API tool checks (eCFR + Nominatim) via the FastMCP dispatcher.
// Run after `npm run build`: node scripts/test-live-tools.mjs
import { runMcpTool, MCP_TOOLS } from "../dist/statutes.js";

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}

const names = MCP_TOOLS.map((t) => t.function.name);
check("MCP_TOOLS exposes live tools", names.includes("lookup_ecfr_federal_rule") && names.includes("lookup_jurisdiction"), names.join(","));

const ecfr = await runMcpTool("lookup_ecfr_federal_rule", JSON.stringify({ query: "wheelchair turning space" }));
check("eCFR returns Title 36/28 statutes", Array.isArray(ecfr.statutes) && ecfr.statutes.length > 0,
  `count=${ecfr.statutes?.length} first=${ecfr.statutes?.[0]?.codeId} err=${ecfr.error ?? ""}`);
check("eCFR excerpt is Statute-shaped", !!ecfr.statutes?.[0]?.text && ecfr.statutes[0].text.length > 40 && !ecfr.statutes[0].text.includes("<strong"),
  `len=${ecfr.statutes?.[0]?.text?.length}`);

const jur = await runMcpTool("lookup_jurisdiction", JSON.stringify({ address: "1600 Amphitheatre Parkway, Mountain View, CA" }));
check("Nominatim resolves jurisdiction", jur.city === "Mountain View" && jur.state === "California",
  `city=${jur.city} county=${jur.county} state=${jur.state} err=${jur.error ?? ""}`);

const bogus = await runMcpTool("lookup_jurisdiction", JSON.stringify({ address: "" }));
check("empty address handled gracefully", typeof bogus.error === "string", bogus.error ?? "");

console.log(failures ? `\n${failures} live-tool check(s) FAILED` : "\nAll live-tool checks passed");
process.exit(failures ? 1 : 0);
