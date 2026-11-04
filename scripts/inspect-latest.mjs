import { pool } from "../dist/db.js";

async function main() {
  const res = await pool.query("SELECT id, status, readiness_score, report, created_at FROM inspections ORDER BY created_at DESC LIMIT 2");
  for (const row of res.rows) {
    console.log("==========================================");
    console.log("ID:", row.id);
    console.log("Created At:", row.created_at);
    console.log("Readiness Score:", row.readiness_score);
    console.log("Status:", row.status);
    console.log("Violations:", JSON.stringify(row.report?.violations, null, 2));
    console.log("Trace:", JSON.stringify(row.report?.trace, null, 2));
    console.log("MCP Trace:", JSON.stringify(row.report?.mcpTrace, null, 2));
    console.log("Redline exists:", Boolean(row.report?.redlineImageBase64));
  }
  await pool.end();
}
main().catch(console.error);
