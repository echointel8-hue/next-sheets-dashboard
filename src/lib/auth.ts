import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";

// Login/session auth for the /manage area. Two roles:
// - superadmin: every department, can add/edit/dispose equipment
// - admin: one per department, can only edit rows in their own department
//
// User accounts live in the "Users" tab of the spreadsheet (see
// src/lib/sheets.ts getUsers/addUser/updateUser) — only a password *hash*
// is ever stored there, never the real password. Passwords are hashed here
// (scrypt, salted) whenever the bootstrap account creates/resets a user
// through the /manage/users UI; nothing else needs to know how hashing works.
//
// Managing users (/manage/users, /api/manage/users) is deliberately NOT a
// superadmin privilege — a superadmin created through that UI (e.g. an IT
// or admin-department account) can add/edit/dispose equipment across every
// department like any superadmin, but cannot create or edit other accounts.
// Only the single env-configured bootstrap account (SessionPayload.
// isBootstrap) can — see checkBootstrapAccount() in the login route.

const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours — a work shift
export const SESSION_COOKIE = "manage_session";
export const SESSION_MAX_AGE_SECONDS = SESSION_TTL_MS / 1000;

export type Role = "superadmin" | "admin";

export interface SessionPayload {
  username: string;
  role: Role;
  /** Department the account is scoped to. Always empty for superadmin
   * (every department); always set for admin. */
  department: string;
  /** True only for the one env-configured bootstrap account — the sole
   * account allowed to manage other users. A superadmin created through
   * the Users tab / /manage/users UI always gets false here, even though
   * their role is also "superadmin". */
  isBootstrap: boolean;
  exp: number; // epoch ms
}

/** Hashes a plaintext password for storage (in the Users sheet tab or the
 * BOOTSTRAP_SUPERADMIN_PASSWORD_HASH env var) — "<saltHex>:<hashHex>".
 * Called server-side only, from the add/reset-user flow; the plaintext
 * password itself is never written anywhere. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string | undefined | null): boolean {
  if (!stored) return false;
  const sepIndex = stored.indexOf(":");
  if (sepIndex === -1) return false;
  const saltHex = stored.slice(0, sepIndex);
  const hashHex = stored.slice(sepIndex + 1);
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;
  const actual = scryptSync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function getSessionSecret(): string {
  const secret = process.env.EDIT_SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "ไม่พบ EDIT_SESSION_SECRET ที่ยาวพอใน .env.local (ต้องเป็นสตริงสุ่มอย่างน้อย 16 ตัวอักษร) — จำเป็นสำหรับเซ็นชื่อ session การเข้าสู่ระบบจัดการ"
    );
  }
  return secret;
}

function sign(payloadB64: string): string {
  return createHmac("sha256", getSessionSecret()).update(payloadB64).digest("hex");
}

export function createSessionToken(payload: Omit<SessionPayload, "exp">): string {
  const full: SessionPayload = { ...payload, exp: Date.now() + SESSION_TTL_MS };
  const payloadB64 = Buffer.from(JSON.stringify(full), "utf8").toString("base64url");
  return `${payloadB64}.${sign(payloadB64)}`;
}

/** Validates signature + expiry, returns the decoded session, or null if
 * missing/invalid/expired/tampered. */
export function verifySessionToken(token: string | undefined | null): SessionPayload | null {
  if (!token) return null;
  const dotIndex = token.indexOf(".");
  if (dotIndex === -1) return null;
  const payloadB64 = token.slice(0, dotIndex);
  const sig = token.slice(dotIndex + 1);
  if (!payloadB64 || !sig) return null;

  let sigBuf: Buffer;
  let expectedBuf: Buffer;
  try {
    sigBuf = Buffer.from(sig, "hex");
    expectedBuf = Buffer.from(sign(payloadB64), "hex");
  } catch {
    return null;
  }
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
    typeof payload.username !== "string" ||
    (payload.role !== "superadmin" && payload.role !== "admin") ||
    typeof payload.department !== "string" ||
    typeof payload.isBootstrap !== "boolean" ||
    typeof payload.exp !== "number"
  ) {
    return null;
  }
  if (Date.now() > payload.exp) return null;
  return payload;
}

// --- Login rate limiting (in-memory, per Node process) ---
// This app deploys as a single always-on `next start` process on the
// hospital LAN (see next.config.ts's allowedDevOrigins comment) rather than
// serverless/multi-instance, so an in-memory map is a reasonable brute-force
// deterrent here. It resets on process restart — an accepted tradeoff, not a
// gap, for this deployment shape.
interface AttemptState {
  count: number;
  lockedUntil: number;
}
const attempts = new Map<string, AttemptState>();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000; // 5 minutes

export function isLockedOut(key: string): boolean {
  const state = attempts.get(key);
  if (!state) return false;
  if (state.lockedUntil && Date.now() < state.lockedUntil) return true;
  if (state.lockedUntil && Date.now() >= state.lockedUntil) attempts.delete(key);
  return false;
}

export function recordFailedAttempt(key: string): void {
  const state = attempts.get(key) ?? { count: 0, lockedUntil: 0 };
  state.count += 1;
  if (state.count >= MAX_ATTEMPTS) {
    state.lockedUntil = Date.now() + LOCKOUT_MS;
    state.count = 0;
  }
  attempts.set(key, state);
}

export function clearAttempts(key: string): void {
  attempts.delete(key);
}

// --- Audit-log detail helpers ---
// Every /api/manage/* and /api/auth/* route appends to the EditLog sheet
// tab (src/lib/sheets.ts appendEditLog) on every action, per the hospital's
// request to log everything from login onward as thoroughly as possible.
// The tab's schema is fixed (8 columns, already documented in README and
// created by hand in the sheet), so IP/user-agent go into the ค่าใหม่
// (newValue) cell as a bracketed suffix instead of new columns — see
// requestAuditTag() below, used the same way at every call site.

/** Best-effort client IP from the X-Forwarded-For header set by the
 * reverse proxy this app sits behind on the hospital LAN. "unknown" if
 * accessed directly (e.g. hitting the Node port with no proxy in front). */
export function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return "unknown";
}

/** "[ip=...; ua=...]" — appended to an EditLog newValue string so every
 * logged action (not just login) carries the same who/where detail. */
export function requestAuditTag(request: NextRequest): string {
  const ip = clientIp(request);
  const ua = request.headers.get("user-agent")?.trim() || "ไม่ทราบ";
  return `[ip=${ip}; ua=${ua}]`;
}
