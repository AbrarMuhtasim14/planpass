import { readFile } from "node:fs/promises";
import { pool } from "../dist/db.js";

async function main() {
  const imgBuf = await readFile("generated_redline.png");
  const b64 = imgBuf.toString("base64");
  const { rows } = await pool.query("SELECT report FROM inspections WHERE id = $1", ["insp_20261103_232438"]);
  if (rows[0]) {
    const report = rows[0].report;
    report.redlineImageBase64 = b64;
    report.redlineMime = "image/png";
    await pool.query("UPDATE inspections SET report = $1 WHERE id = $2", [report, "insp_20261103_232438"]);
    console.log("Attached redlineImageBase64 to insp_20261103_232438!");
  }
  await pool.end();
}
main().catch(console.error);
