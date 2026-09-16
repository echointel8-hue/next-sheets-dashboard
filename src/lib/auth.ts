import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import { hasPermission, type PermissionKey } from "@/lib/permissions";

// Login/session auth for the /manage area. Three roles:
// - superadmin: every department, can add/edit/dispose equipment
// - admin: one per department, can only edit rows in their own department
// - it: every department, read-only — no add/edit/dispose anywhere. Scoped
//   to the technical dashboard at /manage/it (spec tables + printable
//   maintenance-report generator) rather than the general /manage table.
//   Only reaches /manage/it alongside the single bootstrap superadmin
//   account, per the hospital's request — a regular superadmin created
//   later through /manage/users does NOT get /manage/it access, even
//   though role="superadmin" still means "every department" everywhere
//   else. See the isBootstrap check in src/app/manage/it/page.tsx.
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

// A sliding idle timeout, not a fixed session length: createSessionToken
// always stamps exp as "now + this", and proxy.ts re-mints the cookie with
// a fresh exp on every request that carries a still-valid one (any page,
// not just /manage) — so an active user's login never drops just from
// navigating around the site, but 5 minutes with *no* requests at all (tab
// idle, or closed) lets the existing exp lapse and the next /manage visit
// bounces to /login. Per the hospital's explicit request for a 5-minute
// idle logout instead of the previous fixed 8-hour session.
const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes of inactivity
export const SESSION_COOKIE = "manage_session";
export const SESSION_MAX_AGE_SECONDS = SESSION_TTL_MS / 1000;

export type Role = "superadmin" | "admin" | "it";

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
  /** Real Thai name (Users tab column E) looked up once at login time and
   * carried in the session from then on — every authenticated page reads
   * this straight off the already-verified cookie instead of each doing
   * its own separate getUsers() lookup just to show a name (that used to
   * happen on /manage/it/tasks and /manage/it/report specifically, and was
   * also why the same account could show a different name — displayName
   * on one page, bare username on another — depending on which page did
   * or didn't bother with the lookup). Falls back to the bare username for
   * the bootstrap account (env-configured, not a Users-tab row) and for
   * any account with a blank displayName cell. Baked in at login rather
   * than re-verified on every request — a superadmin renaming someone
   * through /manage/users won't be reflected until that account's next
   * login, an accepted tradeoff given the 5-minute idle session timeout. */
  displayName: string;
  /** Per-account permission overrides layered on top of the role above —
   * see lib/permissions.ts for the full model. Both are omitted entirely for
   * the bootstrap account (immune to revocation and already granted every
   * key by role, so there's nothing an override could add or take away) and
   * for any Users-tab account that has never had an override set. */
  extraPermissions?: PermissionKey[];
  revokedPermissions?: PermissionKey[];
  /** Random ID minted once per successful login (registerNewSession below),
   * carried unchanged through every sliding-refresh re-mint of this same
   * session (see proxy.ts's refreshSessionCookie, which reuses it rather
   * than generating a new one). Lets verifySessionToken tell "this same
   * browser session, still going" apart from "a different login for this
   * account happened somewhere else" — see the single-active-session
   * section below for the full mechanism. Empty string for a cookie signed
   * before this feature existed (tolerated, not enforced — see
   * verifySessionToken). */
  sessionId: string;
  exp: number; // epoch ms
}

/**
 * /manage/it (spec dashboard + maintenance-report generator) is reachable
 * by the "it" role, and — per the hospital's explicit request — the single
 * env-configured bootstrap account alone, NOT every "superadmin" account.
 * A regular superadmin created later through /manage/users has full
 * add/edit/dispose rights everywhere else, but does not get this page.
 * Centralized here since the page itself, its settings API route, and any
 * future IT-only route all need the exact same check.
 *
 * Now backed by hasPermission()'s "accessItDashboard" key (see
 * lib/permissions.ts) rather than a hardcoded role/isBootstrap comparison —
 * the default outcome for every existing account is unchanged (it role, or
 * the bootstrap superadmin), but a specific account can now additionally be
 * granted this through /manage/users' per-account permission overrides.
 */
export function canAccessItDashboard(
  session: Pick<SessionPayload, "role" | "isBootstrap" | "extraPermissions" | "revokedPermissions">
): boolean {
  return hasPermission(session, "accessItDashboard");
}

/**
 * Managing booking resources (adding a car/meeting room, editing one,
 * toggling it active/inactive) — per the hospital's explicit request, only
 * the "it" role or the single env-configured bootstrap superadmin account
 * may do this, exactly the same rule as canAccessItDashboard above. A
 * superadmin created later through /manage/users has full add/edit/dispose
 * rights everywhere else, but not here. *Making* a booking itself stays
 * open to every logged-in account regardless — see lib/booking.ts's top
 * comment — this only gates the resource list itself. Kept as its own
 * named function (rather than reusing canAccessItDashboard directly) so
 * the two rules can diverge later without one silently changing the other,
 * even though they start out identical.
 *
 * Now backed by hasPermission()'s "manageBookingResources" key — same
 * unchanged default outcome, now also grantable per account.
 */
export function canManageBookingResources(
  session: Pick<SessionPayload, "role" | "isBootstrap" | "extraPermissions" | "revokedPermissions">
): boolean {
  return hasPermission(session, "manageBookingResources");
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
    (payload.role !== "superadmin" && payload.role !== "admin" && payload.role !== "it") ||
    typeof payload.department !== "string" ||
    typeof payload.isBootstrap !== "boolean" ||
    typeof payload.exp !== "number"
  ) {
    return null;
  }
  // A cookie signed before displayName existed on SessionPayload simply
  // won't have this field — tolerate that (fall back to the username)
  // rather than rejecting the whole session and force-logging everyone out
  // the moment this deploys. Resolves itself the next time that account
  // logs in (a fresh cookie, minted with the real Users-tab displayName);
  // until then this session just shows the bare username, same as before
  // this feature existed — never worse, and self-limiting given the
  // 5-minute idle session timeout.
  if (typeof payload.displayName !== "string") payload.displayName = payload.username;
  // Same tolerance as displayName above, for the two permission-override
  // arrays added later — a cookie signed before this feature existed just
  // won't have them, which hasPermission() already treats as "no overrides"
  // (Array.isArray check rather than assuming shape from a hand-tampered
  // cookie; a malformed value is dropped rather than rejecting the session).
  if (!Array.isArray(payload.extraPermissions)) delete payload.extraPermissions;
  if (!Array.isArray(payload.revokedPermissions)) delete payload.revokedPermissions;
  // Same tolerance again, for sessionId — a cookie signed before the
  // single-active-session feature existed just won't have one.
  if (typeof payload.sessionId !== "string") payload.sessionId = "";
  if (Date.now() > payload.exp) return null;

  // Single active session per account (see the section below this
  // function): a non-empty sessionId participates in the check; an empty
  // one (legacy cookie, or the rare case a login somehow didn't mint one)
  // is waved through untracked, same "never worse than before this
  // feature existed" reasoning as the displayName/extraPermissions
  // fallbacks above.
  if (payload.sessionId) {
    const current = activeSessions.get(payload.username);
    if (current === undefined) {
      // Nothing recorded yet for this account — either the server just
      // restarted (the in-memory map is cleared, see the comment below) or
      // this is the very first request since a login minted this session.
      // Adopt it as the active one rather than rejecting it outright: a
      // mass logout on every deploy/restart would be worse than briefly
      // not enforcing exclusivity until the next real login re-establishes
      // it properly.
      activeSessions.set(payload.username, payload.sessionId);
    } else if (current !== payload.sessionId) {
      // A different login for this account is now the active one —
      // "logging in elsewhere kicks the old session out immediately," per
      // the hospital's explicit choice.
      return null;
    }
  }
  return payload;
}

// --- Single active session per account (in-memory, per Node process) ---
// Same in-memory-map tradeoff as the login rate limiter below (see that
// section's own comment) — resets on process restart, an accepted tradeoff
// for this deployment shape. Maps username -> the sessionId of whichever
// login is currently considered "the" active one for that account.
// registerNewSession is called exactly once per successful login (see the
// login route), overwriting whatever was there before — the previous
// session's cookie still carries the old sessionId, so its next request
// fails the check above and gets bounced to /login. A session just being
// refreshed (proxy.ts's sliding-exp re-mint) reuses its own existing
// sessionId rather than calling this again, so ordinary browsing never
// touches this map — only an actual new login (or an explicit logout, via
// clearActiveSession) does.
const activeSessions = new Map<string, string>();

/** Mints a new sessionId for `username` and registers it as the sole
 * active session for that account, silently superseding whatever session
 * (if any) was active before. Call once per successful login. */
export function registerNewSession(username: string): string {
  const sessionId = randomUUID();
  activeSessions.set(username, sessionId);
  return sessionId;
}

/** Releases `username`'s active-session slot — called on explicit logout
 * so nothing stale lingers. Not required for the kick-out-on-login
 * mechanism itself (a fresh login always overwrites regardless of what's
 * here), just tidiness. */
export function clearActiveSession(username: string): void {
  activeSessions.delete(username);
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
