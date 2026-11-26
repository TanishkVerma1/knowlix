/**
 * Workspace cookie: a signed token that names the student's private
 * workspace. No email, no password, no personal data.
 * Edge-safe (used by proxy.ts), so it must not import node-only modules.
 */
import { SignJWT, jwtVerify } from "jose";

export const WORKSPACE_COOKIE = "knowlix_ws";
export const WORKSPACE_MAX_AGE = 60 * 60 * 24 * 400; // ~13 months

export async function signWorkspaceToken(workspaceId: string, secret: Uint8Array): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(workspaceId)
    .setIssuedAt()
    .setExpirationTime(`${WORKSPACE_MAX_AGE}s`)
    .sign(secret);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function verifyWorkspaceToken(token: string | undefined, secret: Uint8Array): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    return typeof payload.sub === "string" && UUID_RE.test(payload.sub) ? payload.sub : null;
  } catch {
    return null;
  }
}

export function cookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: WORKSPACE_MAX_AGE,
  };
}
