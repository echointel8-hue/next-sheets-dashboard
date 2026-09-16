import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, clearActiveSession, requestAuditTag, verifySessionToken } from "@/lib/auth";
import { appendEditLog } from "@/lib/sheets";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  // Read the session BEFORE clearing the cookie, so the log entry can
  // record who actually logged out. A missing/expired session still
  // succeeds (nothing to log in that case -- there's no identity to blame).
  const session = verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);

  if (session) {
    // Releases this account's active-session slot (lib/auth.ts's
    // activeSessions map) — not required for the kick-out-on-login
    // mechanism itself (a fresh login always overwrites regardless), just
    // tidiness so nothing stale lingers between this logout and whenever
    // the account next logs in.
    clearActiveSession(session.username);
    try {
      await appendEditLog({
        timestamp: new Date().toISOString(),
        action: "ออกจากระบบ",
        actor: session.username,
        department: session.department,
        oldValue: "",
        newValue: requestAuditTag(request),
      });
    } catch (err: unknown) {
      console.error("appendEditLog failed (logout):", err);
    }
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
