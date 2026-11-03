import "dotenv/config";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env ${name}`);
  return v;
}

export const env = {
  databaseUrl: req("DATABASE_URL"),
  databaseUrlUnpooled: req("DATABASE_URL_UNPOOLED"),
  authBaseUrl: req("NEON_AUTH_BASE_URL"),
  authJwksUrl: req("NEON_AUTH_JWKS_URL"),
  metaApiKey: req("MODEL_API_KEY"),
  metaApiBaseUrl: process.env.META_API_BASE_URL ?? "https://api.meta.ai/v1",
  realtimeUrl: req("NEON_REALTIME_URL"),
  realtimeSecret: req("NEON_REALTIME_SECRET"),
  helloFnUrl: process.env.NEON_FUNCTION_HELLO_BASE_URL ?? "",
};

// DATABASE_NAME mirrors PRD: name in DATABASE_URL path
export const DATABASE_NAME = (() => {
  try {
    return new URL(env.databaseUrl).pathname.replace(/^\//, "");
  } catch {
    return "neondb";
  }
})();
