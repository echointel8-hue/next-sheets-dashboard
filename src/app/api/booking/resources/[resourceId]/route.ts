import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, requestAuditTag, verifySessionToken, type SessionPayload } from "@/lib/auth";
import { appendEditLog, updateBookingResource } from "@/lib/sheets";

export const dynamic = "force-dynamic";

function requireSession(request: NextRequest): { session: SessionPayload | null; response: NextResponse | null } {
  const session = verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return { session: null, response: NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 }) };
  }
  return { session, response: null };
}

interface ResourceUpdatePayload {
  name?: string;
  detail?: string;
  active?: boolean;
}

function readUpdatePayload(body: unknown): ResourceUpdatePayload | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const out: ResourceUpdatePayload = {};
  if (typeof b.name === "string") {
    if (!b.name.trim()) return null;
    out.name = b.name.trim();
  }
  if (typeof b.detail === "string") out.detail = b.detail.trim();
  if (typeof b.active === "boolean") out.active = b.active;
  if (Object.keys(out).length === 0) return null;
  return out;
}

/** Edits a vehicle/meeting room's name/detail, or toggles it
 * active/inactive (soft-deactivate — never hard-deleted, so past bookings
 * keep their meaning). Reachable by any logged-in account, per the
 * hospital's explicit request — no owner/creator restriction. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ resourceId: string }> }) {
  const { session, response } = requireSession(request);
  if (!session) return response;
  const { resourceId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "คำขอไม่ถูกต้อง" }, { status: 400 });
  }
  const updates = readUpdatePayload(body);
  if (!updates) {
    return NextResponse.json({ error: "ข้อมูลที่ส่งมาไม่ถูกต้อง" }, { status: 400 });
  }

  try {
    const resource = await updateBookingResource(resourceId, updates);
    const changeSummary = Object.entries(updates)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    await appendEditLog({
      timestamp: new Date().toISOString(),
      action: "แก้ไขทรัพยากรจอง",
      actor: session.username,
      department: session.department,
      oldValue: "",
      newValue: `${resource.name}: ${changeSummary} ${requestAuditTag(request)}`,
    });
    return NextResponse.json({ resource });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
