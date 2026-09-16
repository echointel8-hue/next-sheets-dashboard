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
 *    /booking and /api/booking/* (vehicle/meeting-room booking) share this
 *    same "logged in or not" gate — every role is equally allowed in once
 *    logged in, so there's no additional role check anywhere for it.
 *    /menu (the post-login system-choice page) shares the same gate too.
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
  const isBookingPage = pathname === "/booking" || pathname.startsWith("/booking/");
  const isBookingApi = pathname === "/api/booking" || pathname.startsWith("/api/booking/");
  // The post-login system-choice page (see src/app/menu/page.tsx) — no API
  // routes of its own, it just links out to /manage and /booking.
  const isMenuPage = pathname === "/menu" || pathname.startsWith("/menu/");

  const session = verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);

  if ((isManagePage || isManageApi || isBookingPage || isBookingApi || isMenuPage) && !session) {
    if (isManageApi || isBookingApi) {
      return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
    }
    // No "?next=..." attached here (there used to be one) — /login always
    // sends a freshly logged-in account to /menu regardless of which
    // protected URL it originally tried to reach, per the hospital's
    // explicit request. See src/app/login/page.tsx's own comment.
    return NextResponse.redirect(new URL("/login", request.url));
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
    displayName: session.displayName,
    // Both fixed here at the same time:
    // - extraPermissions/revokedPermissions were missing from this list
    //   entirely, so a granted/revoked account silently lost its overrides
    //   on this very first sliding-refresh after login (every request
    //   refreshes — see the comment on the call site below) — a real bug,
    //   not by design.
    // - sessionId is reused as-is, never regenerated here — only a fresh
    //   /api/auth/login call (registerNewSession) mints a new one. Ordinary
    //   browsing must never touch the single-active-session map (lib/
    //   auth.ts), or every refresh would spuriously re-claim "I'm the
    //   active session," and two devices refreshing in quick succession
    //   would end up fighting over which one counts as active instead of
    //   only a genuine new login deciding that.
    extraPermissions: session.extraPermissions,
    revokedPermissions: session.revokedPermissions,
    sessionId: session.sessionId,
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
