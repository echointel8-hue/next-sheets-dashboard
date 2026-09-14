import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, requestAuditTag, verifySessionToken, type SessionPayload } from "@/lib/auth";
import { appendEditLog, createBookingResource, getBookingResources } from "@/lib/sheets";
import type { BookingResourceType } from "@/lib/booking";

// Always live — resources can be added by any logged-in account at any
// time and the list is small, so caching isn't worth the staleness.
export const dynamic = "force-dynamic";

/** Every logged-in account, any role — resource management was explicitly
 * opened up equally, see lib/booking.ts's top comment. Only "must be
 * logged in" is required, same shape as requireItAccess in
 * /api/manage/it/tasks but without the extra role check. */
function requireSession(request: NextRequest): { session: SessionPayload | null; response: NextResponse | null } {
  const session = verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return { session: null, response: NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 }) };
  }
  return { session, response: null };
}

export async function GET(request: NextRequest) {
  const { session, response } = requireSession(request);
  if (!session) return response;

  try {
    const resources = await getBookingResources();
    return NextResponse.json({ resources });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function readResourcePayload(body: unknown): { type: BookingResourceType; name: string; detail: string } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.type !== "car" && b.type !== "room") return null;
  if (typeof b.name !== "string" || !b.name.trim()) return null;
  if (typeof b.detail !== "string" && typeof b.detail !== "undefined") return null;
  return { type: b.type, name: b.name.trim(), detail: typeof b.detail === "string" ? b.detail.trim() : "" };
}

/** Adds one new vehicle or meeting room — reachable by any logged-in
 * account, per the hospital's explicit request. */
export async function POST(request: NextRequest) {
  const { session, response } = requireSession(request);
  if (!session) return response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "คำขอไม่ถูกต้อง" }, { status: 400 });
  }
  const payload = readResourcePayload(body);
  if (!payload) {
    return NextResponse.json({ error: "ข้อมูลที่ส่งมาไม่ถูกต้อง — กรุณาระบุประเภทและชื่อ" }, { status: 400 });
  }

  try {
    const resource = await createBookingResource({ ...payload, createdByUsername: session.username });
    await appendEditLog({
      timestamp: new Date().toISOString(),
      action: "เพิ่มทรัพยากรจอง",
      actor: session.username,
      department: session.department,
      oldValue: "",
      newValue: `${payload.type === "car" ? "รถ" : "ห้องประชุม"}: ${payload.name} ${requestAuditTag(request)}`,
    });
    return NextResponse.json({ resource });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
