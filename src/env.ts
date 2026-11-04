import "dotenv/config";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env ${name}`);
  return v;
}

function opt(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() ? v : fallback;
}

export const env = {
  databaseUrl: req("DATABASE_URL"),
  databaseUrlUnpooled: req("DATABASE_URL_UNPOOLED"),
  authBaseUrl: req("NEON_AUTH_BASE_URL"),
  authJwksUrl: req("NEON_AUTH_JWKS_URL"),
  metaApiKey: req("MODEL_API_KEY"),
  metaApiBaseUrl: opt("META_API_BASE_URL", "https://api.meta.ai/v1"),
  realtimeUrl: req("NEON_REALTIME_URL"),
  realtimeSecret: req("NEON_REALTIME_SECRET"),
  helloFnUrl: process.env.NEON_FUNCTION_HELLO_BASE_URL ?? "",
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  resendFrom: process.env.RESEND_FROM ?? "PlanPass <onboarding@resend.dev>",
  statutesFile: opt("STATUTES_FILE", "data/statutes.json"),
  samModel: opt("META_SAM_MODEL", "sam-3.1"),
  sparkModel: opt("META_SPARK_MODEL", "muse-spark-1.3"),
  imageModel: opt("META_IMAGE_MODEL", "muse-image-1.0"),
  voiceModel: opt("META_VOICE_MODEL", "muse-voice-transcribe-1.0"),
};

// DATABASE_NAME mirrors PRD: name in DATABASE_URL path
export const DATABASE_NAME = (() => {
  try {
    return new URL(env.databaseUrl).pathname.replace(/^\//, "");
  } catch {
    return "neondb";
  }
})();
