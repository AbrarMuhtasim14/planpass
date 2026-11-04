import { writeFile } from "node:fs/promises";
import { pool } from "../dist/db.js";

async function main() {
  const { rows } = await pool.query("SELECT report FROM inspections WHERE id = $1", ["insp_20261104_003936"]);
  if (rows[0]?.report?.redlineImageBase64) {
    const buf = Buffer.from(rows[0].report.redlineImageBase64, "base64");
    await writeFile("f:/planpass/factory_redline.png", buf);
    console.log("Saved f:/planpass/factory_redline.png successfully! Size:", buf.length, "bytes");
  } else {
    console.log("No redline image found in report!");
  }
  await pool.end();
}

main().catch(console.error);
