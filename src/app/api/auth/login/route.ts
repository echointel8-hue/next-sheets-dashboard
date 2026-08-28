import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  clearAttempts,
  clientIp,
  createSessionToken,
  isLockedOut,
  recordFailedAttempt,
  requestAuditTag,
  verifyPassword,
  type Role,
} from "@/lib/auth";
import { appendEditLog, getUsers } from "@/lib/sheets";

// Never cache/prerender — checks live rate-limit + credential state.
export const dynamic = "force-dynamic";

/** Every login attempt — success or failure — is written to EditLog, per
 * the hospital's request to log everything from login onward. A logging
 * failure never blocks the actual login outcome. */
async function logLoginAttempt(
  request: NextRequest,
  outcome: "สำเร็จ" | "ล้มเหลว",
  detail: { username: string; role?: Role; department?: string; isBootstrap?: boolean; reason?: string }
): Promise<void> {
  try {
    const parts = [
      outcome === "สำเร็จ"
        ? `สิทธิ์: ${detail.role}${detail.isBootstrap ? " (bootstrap)" : ""}`
        : `เหตุผล: ${detail.reason ?? "ไม่ทราบ"}`,
      requestAuditTag(request),
    ];
    await appendEditLog({
      timestamp: new Date().toISOString(),
      action: outcome === "สำเร็จ" ? "เข้าสู่ระบบสำเร็จ" : "เข้าสู่ระบบล้มเหลว",
      actor: detail.username,
      department: detail.department ?? "",
      oldValue: "",
      newValue: parts.join(" "),
    });
  } catch (err: unknown) {
    console.error("appendEditLog failed (login):", err);
  }
}

function readCredentials(body: unknown): { username: string; password: string } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.username !== "string" || typeof b.password !== "string") return null;
  if (!b.username.trim() || !b.password) return null;
  return { username: b.username.trim(), password: b.password };
}

interface Matched {
  username: string;
  role: Role;
  department: string;
  isBootstrap: boolean;
}

/** The bootstrap account (env-configured) always works, independent of the
 * Users sheet tab — guarantees there's always a way in even if that tab is
 * empty, missing, or every real superadmin gets accidentally deactivated.
 * Once logged in, use it to create real accounts via /manage/users. */
function checkBootstrapAccount(username: string, password: string): Matched | null {
  const bootstrapUsername = process.env.BOOTSTRAP_SUPERADMIN_USERNAME;
  const bootstrapHash = process.env.BOOTSTRAP_SUPERADMIN_PASSWORD_HASH;
  if (!bootstrapUsername || !bootstrapHash) return null;
  if (username !== bootstrapUsername) return null;
  if (!verifyPassword(password, bootstrapHash)) return null;
  return { username, role: "superadmin", department: "", isBootstrap: true };
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "คำขอไม่ถูกต้อง" }, { status: 400 });
  }
  const credentials = readCredentials(body);
  if (!credentials) {
    return NextResponse.json({ error: "กรุณาระบุชื่อผู้ใช้และรหัสผ่าน" }, { status: 400 });
  }
  const { username, password } = credentials;

  const rateLimitKey = `${clientIp(request)}:${username}`;
  if (isLockedOut(rateLimitKey)) {
    await logLoginAttempt(request, "ล้มเหลว", {
      username,
      reason: "ถูกล็อกชั่วคราว (พยายามผิดหลายครั้ง)",
    });
    return NextResponse.json(
      { error: "ลองรหัสผ่านผิดหลายครั้งเกินไป กรุณารอ 5 นาทีแล้วลองใหม่" },
      { status: 429 }
    );
  }

  let matched = checkBootstrapAccount(username, password);

  if (!matched) {
    try {
      const users = await getUsers();
      const user = users.find((u) => u.username === username && u.active);
      if (user && verifyPassword(password, user.passwordHash)) {
        // Always false here — even a "superadmin" role user from the
        // Users tab is not the bootstrap account, so it can't manage
        // other users. See the isBootstrap comment on SessionPayload.
        matched = { username: user.username, role: user.role, department: user.department, isBootstrap: false };
      }
    } catch (err: unknown) {
      // Users tab missing/misconfigured — fall through to the generic
      // failure below instead of leaking sheet-structure details to an
      // unauthenticated caller. The bootstrap account above still works
      // regardless of this tab's state.
      console.error("getUsers failed during login:", err);
    }
  }

  if (!matched) {
    recordFailedAttempt(rateLimitKey);
    await logLoginAttempt(request, "ล้มเหลว", {
      username,
      reason: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง",
    });
    return NextResponse.json({ error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" }, { status: 401 });
  }

  clearAttempts(rateLimitKey);
  const token = createSessionToken(matched);
  await logLoginAttempt(request, "สำเร็จ", {
    username: matched.username,
    role: matched.role,
    department: matched.department,
    isBootstrap: matched.isBootstrap,
  });

  const response = NextResponse.json({ ok: true, role: matched.role, department: matched.department });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
