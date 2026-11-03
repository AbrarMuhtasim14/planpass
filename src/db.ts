import { Pool } from "pg";
import { env } from "./env.js";

// Pooled (-pooler) DATABASE_URL, sslmode=require -> verify-full
const pool = new Pool({
  connectionString: env.databaseUrl.replace("sslmode=require", "sslmode=verify-full"),
  max: 5,
});
pool.on("error", (err) => console.error("[db pool]", err));

export async function initDb(): Promise<void> {
  // Direct (unpooled) string for DDL, per neon-postgres skill migration guidance
  const direct = new Pool({
    connectionString: env.databaseUrlUnpooled.replace(
      "sslmode=require",
      "sslmode=verify-full",
    ),
    max: 1,
  });
  try {
    await direct.query(`
      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        s3_key TEXT NOT NULL,
        filename TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        width_px INTEGER NOT NULL DEFAULT 0,
        height_px INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'upload',
        uploaded_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS inspections (
        id TEXT PRIMARY KEY,
        plan_id TEXT NULL REFERENCES plans(id) ON DELETE SET NULL,
        user_id TEXT NOT NULL,
        occupancy TEXT NOT NULL,
        status TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'upload',
        transcript TEXT NOT NULL DEFAULT '',
        report JSONB NOT NULL DEFAULT '{}'::jsonb,
        readiness_score INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS inspections_user_id_idx ON inspections(user_id);
      CREATE INDEX IF NOT EXISTS inspections_created_at_idx ON inspections(created_at DESC);
    `);
  } finally {
    await direct.end();
  }
}

export { pool };
