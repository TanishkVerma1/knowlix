import { NextResponse, type NextRequest } from "next/server";
import { WORKSPACE_COOKIE, cookieOptions, signWorkspaceToken, verifyWorkspaceToken } from "@/server/auth/token";

/**
 * Gives every browser its own private workspace before any page or API call
 * runs, so parallel first requests can never create two workspaces.
 */
async function secret(): Promise<Uint8Array> {
  const explicit = process.env.SESSION_SECRET?.trim();
  const db = process.env.DATABASE_URL?.trim();
  const material = explicit || (db ? `knowlix-session:${db}` : "knowlix-dev-session-secret");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return new Uint8Array(digest);
}

export async function proxy(request: NextRequest) {
  const key = await secret();
  const existing = request.cookies.get(WORKSPACE_COOKIE)?.value;
  if (await verifyWorkspaceToken(existing, key)) return NextResponse.next();

  const token = await signWorkspaceToken(crypto.randomUUID(), key);
  // Make the new cookie visible to this same request's handlers…
  request.cookies.set(WORKSPACE_COOKIE, token);
  const response = NextResponse.next({ request: { headers: request.headers } });
  // …and persist it in the browser.
  response.cookies.set(WORKSPACE_COOKIE, token, cookieOptions(request.nextUrl.protocol === "https:"));
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|webp|ico|woff2?)$).*)"],
};
