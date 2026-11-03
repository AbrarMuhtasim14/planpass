import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "./env.js";

// Managed Better Auth JWT verification (neon-functions / neon-realtime skill pattern):
// JWKS from NEON_AUTH_JWKS_URL, issuer + audience = origin of NEON_AUTH_BASE_URL.
const jwks = createRemoteJWKSet(new URL(env.authJwksUrl));
const authOrigin = new URL(env.authBaseUrl).origin;

export async function verifyBearer(token: string): Promise<string | undefined> {
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: authOrigin,
      audience: authOrigin,
    });
    return payload.sub;
  } catch {
    return undefined;
  }
}

// Cookie session: forward the browser cookie to Managed Auth's get-session.
export async function sessionUser(cookie: string | undefined): Promise<{ id: string; email?: string } | undefined> {
  if (!cookie) return undefined;
  try {
    const res = await fetch(`${env.authBaseUrl}/get-session`, {
      headers: { cookie },
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { user?: { id: string; email?: string } } | null;
    return data?.user ? { id: data.user.id, email: data.user.email } : undefined;
  } catch {
    return undefined;
  }
}

export async function requireUser(headers: Headers): Promise<{ id: string; email?: string } | undefined> {
  const auth = headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    const id = await verifyBearer(auth.slice(7).trim());
    if (id) return { id };
  }
  return sessionUser(headers.get("cookie") ?? undefined);
}
