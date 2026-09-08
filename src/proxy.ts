import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  verifySessionToken,
  type SessionPayload,
} from "@/lib/auth";

/**
 * Two independent auth layers, checked in order:
 *
 * 1. Optional HTTP Basic Auth gate — OFF by default. This dashboard shows
 *    real staff names, positions and departments pulled live from a Google
 *    Form response sheet, with no access control of its own. Set
 *    BASIC_AUTH_USER and BASIC_AUTH_PASS in .env.local to require a login
 *    before anyone can view *anything* on the site; leave them unset and
 *    this layer is a no-op. Lightweight gate suitable for an internal tool
 *    on a trusted network — not a substitute for layer 2.
 *
 * 2. Per-user login for /manage and /api/manage/* — the add/edit/dispose
 *    equipment area and user management, gated by a signed session cookie
 *    (see src/lib/auth.ts) issued by POST /api/auth/login. The public
 *    dashboard (/, /api/sheets) is unaffected — it stays viewable without
 *    logging in, same as before. Role-specific checks (superadmin-only
 *    routes like /manage/users) happen inside each page/route handler
 *    itself, not here — this layer only establishes "logged in or not."
 *
 * Next.js 16 renamed the "middleware" file convention to "proxy", and
 * defaults it to the Node.js runtime (not Edge) — which is what makes it
 * safe for this file to import src/lib/auth.ts's use of Node's `crypto`.
 */
export function proxy(request: NextRequest) {
  const basicAuthFailure = checkBasicAuth(request);
  if (basicAuthFailure) return basicAuthFailure;

  const { pathname } = request.nextUrl;
  const isManagePage = pathname === "/manage" || pathname.startsWith("/manage/");
  const isManageApi = pathname === "/api/manage" || pathname.startsWith("/api/manage/");

  const session = verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);

  if ((isManagePage || isManageApi) && !session) {
    if (isManageApi) {
      return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const response = NextResponse.next();
  // Sliding idle timeout: any request — on any page, not just /manage —
  // that still carries a valid session re-mints the cookie with a fresh
  // expiry, so browsing the public dashboard (or anywhere else on the
  // site) while logged in never drops the login on its own. It only lapses
  // once SESSION_MAX_AGE_SECONDS passes with no requests at all. Skipped
  // for the two routes that already set this same cookie themselves
  // (login mints it fresh, logout clears it) — refreshing here too would
  // race whichever Set-Cookie header the browser ends up applying last.
  const managesOwnCookie = pathname === "/api/auth/login" || pathname === "/api/auth/logout";
  if (session && !managesOwnCookie) refreshSessionCookie(response, session);
  return response;
}

function refreshSessionCookie(response: NextResponse, session: SessionPayload) {
  const refreshed = createSessionToken({
    username: session.username,
    role: session.role,
    department: session.department,
    isBootstrap: session.isBootstrap,
  });
  response.cookies.set(SESSION_COOKIE, refreshed, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

function checkBasicAuth(request: NextRequest): NextResponse | null {
  const expectedUser = process.env.BASIC_AUTH_USER;
  const expectedPass = process.env.BASIC_AUTH_PASS;
  if (!expectedUser || !expectedPass) {
    return null;
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Basic ")) {
    const encoded = authHeader.slice("Basic ".length);
    let decoded = "";
    try {
      decoded = atob(encoded);
    } catch {
      // fall through to 401 below
    }
    const separatorIndex = decoded.indexOf(":");
    const suppliedUser = decoded.slice(0, separatorIndex);
    const suppliedPass = decoded.slice(separatorIndex + 1);
    if (suppliedUser === expectedUser && suppliedPass === expectedPass) {
      return null;
    }
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Equipment Dashboard"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
