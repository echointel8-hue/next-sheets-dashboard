import { NextRequest, NextResponse } from "next/server";

/**
 * Optional HTTP Basic Auth gate — OFF by default.
 *
 * This dashboard shows real staff names, positions and departments pulled
 * live from a Google Form response sheet, with no access control of its
 * own. Set BASIC_AUTH_USER and BASIC_AUTH_PASS in .env.local to require a
 * login before anyone can view it; leave them unset and the app behaves
 * exactly as before (no auth prompt).
 *
 * This is a lightweight gate suitable for an internal tool on a trusted
 * network — it is not a substitute for real per-user authentication if the
 * dashboard is ever exposed more broadly.
 *
 * Next.js 16 renamed the "middleware" file convention to "proxy" — this
 * file (and its exported `proxy` function) is that convention.
 */
export function proxy(request: NextRequest) {
  const expectedUser = process.env.BASIC_AUTH_USER;
  const expectedPass = process.env.BASIC_AUTH_PASS;
  if (!expectedUser || !expectedPass) {
    return NextResponse.next();
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
      return NextResponse.next();
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
