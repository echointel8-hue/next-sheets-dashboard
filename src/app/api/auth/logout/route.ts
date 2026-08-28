import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, requestAuditTag, verifySessionToken } from "@/lib/auth";
import { appendEditLog } from "@/lib/sheets";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  // Read the session BEFORE clearing the cookie, so the log entry can
  // record who actually logged out. A missing/expired session still
  // succeeds (nothing to log in that case -- there's no identity to blame).
  const session = verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);

  if (session) {
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
