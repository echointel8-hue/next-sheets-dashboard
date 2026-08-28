import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, hashPassword, requestAuditTag, verifySessionToken, type Role } from "@/lib/auth";
import { addUser, appendEditLog, getUsers, updateUser, type UserRecord } from "@/lib/sheets";

// Always live — reveals account data behind an auth check and accepts
// writes, never something to cache/prerender.
export const dynamic = "force-dynamic";

type PublicUser = Omit<UserRecord, "passwordHash">;

function toPublic(user: UserRecord): PublicUser {
  // Password hashes never leave the server, even to an authenticated
  // superadmin's browser — there's no legitimate reason the UI needs them.
  return {
    rowNumber: user.rowNumber,
    username: user.username,
    role: user.role,
    department: user.department,
    displayName: user.displayName,
    active: user.active,
  };
}

/** Managing users is restricted to the single env-configured bootstrap
 * account (SessionPayload.isBootstrap) — not just any superadmin. A
 * superadmin created through this same UI can add/edit/dispose equipment
 * across every department like any superadmin, but must not be able to
 * create or edit other accounts (including granting itself more access). */
function requireBootstrapSuperadmin(request: NextRequest) {
  const session = verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return { session: null, response: NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 }) };
  }
  if (!session.isBootstrap) {
    return {
      session: null,
      response: NextResponse.json(
        { error: "เฉพาะบัญชีผู้ดูแลระบบหลักเท่านั้นที่จัดการผู้ใช้ได้" },
        { status: 403 }
      ),
    };
  }
  return { session, response: null };
}

/** Lists every account in the Users tab — bootstrap account only. */
export async function GET(request: NextRequest) {
  const { session, response } = requireBootstrapSuperadmin(request);
  if (!session) return response;

  try {
    const users = await getUsers();
    return NextResponse.json({ users: users.map(toPublic) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

interface NewUserPayload {
  username: string;
  password: string;
  role: Role;
  department: string;
  displayName: string;
}

function readNewUserPayload(body: unknown): NewUserPayload | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.username !== "string" || b.username.trim() === "") return null;
  if (typeof b.password !== "string" || b.password.length < 4) return null;
  if (b.role !== "superadmin" && b.role !== "admin") return null;
  if (typeof b.displayName !== "string") return null;
  if (typeof b.department !== "string") return null;
  return {
    username: b.username.trim(),
    password: b.password,
    role: b.role,
    department: b.role === "admin" ? b.department.trim() : "",
    displayName: b.displayName.trim(),
  };
}

/** Creates a new account — bootstrap account only. The plaintext password is
 * hashed here and never written to the sheet or logged. */
export async function POST(request: NextRequest) {
  const { session, response } = requireBootstrapSuperadmin(request);
  if (!session) return response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "คำขอไม่ถูกต้อง" }, { status: 400 });
  }
  const submitted = readNewUserPayload(body);
  if (!submitted) {
    return NextResponse.json(
      { error: "ข้อมูลไม่ครบ — ต้องมีชื่อผู้ใช้, รหัสผ่าน (อย่างน้อย 4 ตัวอักษร), สิทธิ์ และชื่อที่แสดง" },
      { status: 400 }
    );
  }
  if (submitted.role === "admin" && submitted.department === "") {
    return NextResponse.json({ error: "admin ต้องระบุกลุ่มงานที่รับผิดชอบ" }, { status: 400 });
  }

  try {
    const existing = await getUsers();
    if (existing.some((u) => u.username === submitted.username)) {
      return NextResponse.json({ error: `มีชื่อผู้ใช้ "${submitted.username}" อยู่แล้ว` }, { status: 409 });
    }

    await addUser({
      username: submitted.username,
      passwordHash: hashPassword(submitted.password),
      role: submitted.role,
      department: submitted.department,
      displayName: submitted.displayName,
    });

    try {
      await appendEditLog({
        timestamp: new Date().toISOString(),
        action: "จัดการผู้ใช้",
        actor: session.username,
        department: submitted.department,
        oldValue: "",
        newValue: `สร้างผู้ใช้ "${submitted.username}" (${submitted.role}) ${requestAuditTag(request)}`,
      });
    } catch (logErr: unknown) {
      console.error("appendEditLog failed:", logErr);
    }

    const users = await getUsers();
    const created = users.find((u) => u.username === submitted.username);
    return NextResponse.json({ user: created ? toPublic(created) : null }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

interface UpdateUserPayload {
  username: string;
  password?: string;
  role?: Role;
  department?: string;
  displayName?: string;
  active?: boolean;
}

function readUpdateUserPayload(body: unknown): UpdateUserPayload | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.username !== "string" || b.username.trim() === "") return null;
  const out: UpdateUserPayload = { username: b.username.trim() };
  if (b.password !== undefined) {
    if (typeof b.password !== "string" || b.password.length < 4) return null;
    out.password = b.password;
  }
  if (b.role !== undefined) {
    if (b.role !== "superadmin" && b.role !== "admin") return null;
    out.role = b.role;
  }
  if (b.department !== undefined) {
    if (typeof b.department !== "string") return null;
    out.department = b.department.trim();
  }
  if (b.displayName !== undefined) {
    if (typeof b.displayName !== "string") return null;
    out.displayName = b.displayName.trim();
  }
  if (b.active !== undefined) {
    if (typeof b.active !== "boolean") return null;
    out.active = b.active;
  }
  return out;
}

/** Edits an existing account (reset password, change role/department,
 * rename, enable/disable) — bootstrap account only. */
export async function PATCH(request: NextRequest) {
  const { session, response } = requireBootstrapSuperadmin(request);
  if (!session) return response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "คำขอไม่ถูกต้อง" }, { status: 400 });
  }
  const submitted = readUpdateUserPayload(body);
  if (!submitted) {
    return NextResponse.json({ error: "ข้อมูลที่ส่งมาไม่ถูกต้อง" }, { status: 400 });
  }

  const nextRole = submitted.role;
  const nextDepartment = submitted.department;
  if (nextRole === "admin" && nextDepartment === "") {
    return NextResponse.json({ error: "admin ต้องระบุกลุ่มงานที่รับผิดชอบ" }, { status: 400 });
  }

  try {
    const updates: Partial<Pick<UserRecord, "passwordHash" | "role" | "department" | "displayName" | "active">> = {};
    if (submitted.password) updates.passwordHash = hashPassword(submitted.password);
    if (submitted.role) updates.role = submitted.role;
    if (submitted.department !== undefined) updates.department = submitted.department;
    if (submitted.displayName !== undefined) updates.displayName = submitted.displayName;
    if (submitted.active !== undefined) updates.active = submitted.active;

    const updated = await updateUser(submitted.username, updates);

    const changeSummary = [
      submitted.password && "รีเซ็ตรหัสผ่าน",
      submitted.role && `สิทธิ์ → ${submitted.role}`,
      submitted.department !== undefined && `กลุ่มงาน → ${submitted.department || "-"}`,
      submitted.displayName !== undefined && `ชื่อที่แสดง → ${submitted.displayName}`,
      submitted.active !== undefined && (submitted.active ? "เปิดใช้งาน" : "ปิดใช้งาน"),
    ].filter(Boolean);
    try {
      await appendEditLog({
        timestamp: new Date().toISOString(),
        action: "จัดการผู้ใช้",
        actor: session.username,
        department: updated.department,
        oldValue: "",
        newValue: `แก้ไขผู้ใช้ "${submitted.username}": ${changeSummary.join(", ") || "-"} ${requestAuditTag(request)}`,
      });
    } catch (logErr: unknown) {
      console.error("appendEditLog failed:", logErr);
    }

    return NextResponse.json({ user: toPublic(updated) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
