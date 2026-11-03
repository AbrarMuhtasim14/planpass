import { createRealtime, rawSql, type SealedLiveQuery } from "@neon/realtime/server";
import { env, DATABASE_NAME } from "./env.js";

export interface InspectionRow {
  id: string;
  plan_id: string | null;
  occupancy: string;
  status: string;
  readiness_score: number;
  source: string;
  created_at: string;
}

const realtime = createRealtime({
  secret: env.realtimeSecret,
  db: DATABASE_NAME,
});

// Live query over inspection history, authorized by verified user id (queries.md pattern).
export function inspectionsQuery(userId: string) {
  return rawSql<InspectionRow>(
    `SELECT id, plan_id, occupancy, status, readiness_score, source, created_at FROM inspections WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [userId],
  );
}

export async function sealInspections(userId: string): Promise<SealedLiveQuery<InspectionRow>> {
  return realtime.seal({ query: inspectionsQuery(userId) });
}
