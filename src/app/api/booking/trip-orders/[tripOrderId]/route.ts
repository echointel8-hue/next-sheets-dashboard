import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, requestAuditTag, verifySessionToken } from "@/lib/auth";
import { canApproveCarBooking } from "@/lib/booking";
import { appendEditLog, getBookingResources, updateTripOrder } from "@/lib/sheets";

export const dynamic = "force-dynamic";

// No explicit return type here — see ../../resources/route.ts's doc comment
// on the identical helper for why that matters for Next's route-handler
// type checking.
function requireSession(request: NextRequest) {
  const session = verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return { session: null, response: NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 }) };
  }
  return { session, response: null };
}

interface TripOrderEditPayload {
  resourceId?: string;
  driverName?: string;
  startTime?: string;
  endTime?: string;
  notes?: string;
  /** เพิ่มคำขอจองรถ "รออนุมัติ" อื่นเข้าใบสั่งงานนี้ — ตามที่โรงพยาบาลขอเพิ่ม
   * ภายหลัง (เผื่อกรณีอนุมัติไปแล้วแต่มีกลุ่มอื่นอยากเดินทางไปด้วย) ดูคอมเมนต์
   * เต็มที่ updateTripOrder ใน lib/sheets.ts */
  addBookingIds?: string[];
}

function readEditPayload(body: unknown): TripOrderEditPayload | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const result: TripOrderEditPayload = {};

  if ("resourceId" in b) {
    if (typeof b.resourceId !== "string" || !b.resourceId.trim()) return null;
    result.resourceId = b.resourceId.trim();
  }
  if ("driverName" in b) {
    if (typeof b.driverName !== "string" || !b.driverName.trim()) return null;
    result.driverName = b.driverName.trim();
  }
  if ("notes" in b) {
    if (typeof b.notes !== "string") return null;
    result.notes = b.notes.trim();
  }
  const hasStart = "startTime" in b;
  const hasEnd = "endTime" in b;
  if (hasStart !== hasEnd) return null; // ต้องแก้คู่กันเสมอ — กันช่วงเวลาที่เริ่ม>=จบโดยไม่ตั้งใจ
  if (hasStart && hasEnd) {
    if (typeof b.startTime !== "string" || !b.startTime.trim()) return null;
    if (typeof b.endTime !== "string" || !b.endTime.trim()) return null;
    const start = new Date(b.startTime).getTime();
    const end = new Date(b.endTime).getTime();
    if (Number.isNaN(start) || Number.isNaN(end) || start >= end) return null;
    result.startTime = b.startTime;
    result.endTime = b.endTime;
  }
  if ("addBookingIds" in b) {
    if (!Array.isArray(b.addBookingIds) || !b.addBookingIds.every((id) => typeof id === "string" && id.trim())) {
      return null;
    }
    result.addBookingIds = (b.addBookingIds as string[]).map((id) => id.trim());
  }

  return Object.keys(result).length > 0 ? result : null;
}

/** Edits an already-issued TripOrder's own car/driver/time/notes — "แก้ไข
 * ข้อมูลเท่าที่จำเป็น" for management, per the hospital's explicit later
 * request. Same permission gate as everything else in the car-booking
 * review flow — see canApproveCarBooking in lib/booking.ts. Never edits the
 * bookings this TripOrder already covers, and never *removes* any of them
 * — the one exception is `addBookingIds`, a later explicit request letting
 * management add other still-pending car bookings into an already-approved
 * trip (e.g. another department wants to ride along after the fact) — see
 * updateTripOrder's doc comment in lib/sheets.ts for the full story and its
 * validation. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ tripOrderId: string }> }) {
  const { session, response } = requireSession(request);
  if (!session) return response;
  if (!canApproveCarBooking(session)) {
    return NextResponse.json(
      { error: "แก้ไขใบสั่งงานเดินทางได้เฉพาะสิทธิ์ Superadmin เท่านั้น" },
      { status: 403 }
    );
  }
  const { tripOrderId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "คำขอไม่ถูกต้อง" }, { status: 400 });
  }
  const edits = readEditPayload(body);
  if (!edits) {
    return NextResponse.json(
      { error: "ข้อมูลที่ส่งมาไม่ถูกต้อง — กรุณากรอกข้อมูลที่ต้องการแก้ไขให้ถูกต้องอย่างน้อย 1 รายการ" },
      { status: 400 }
    );
  }

  try {
    // resourceId ถูกส่งมาแยกจาก resourceName เสมอ (เหมือน POST
    // /api/booking/trip-orders) — resolve ชื่อรถปัจจุบันจากรายการทรัพยากรจริง
    // แทนการเชื่อใจชื่อที่ client ส่งมา
    let resourceName: string | undefined;
    if (edits.resourceId) {
      const resources = await getBookingResources();
      const resource = resources.find((r) => r.resourceId === edits.resourceId);
      if (!resource) {
        return NextResponse.json({ error: "ไม่พบรถนี้ — อาจถูกลบไปแล้ว" }, { status: 404 });
      }
      if (resource.type !== "car") {
        return NextResponse.json({ error: "ใบสั่งงานเดินทางใช้ได้กับรถเท่านั้น" }, { status: 400 });
      }
      resourceName = resource.name;
    }

    const { tripOrder: updated, addedBookings } = await updateTripOrder(tripOrderId, { ...edits, resourceName }, session.username);
    await appendEditLog({
      timestamp: new Date().toISOString(),
      action: "แก้ไขใบสั่งงานเดินทาง",
      actor: session.username,
      department: session.department,
      oldValue: "",
      newValue: `${updated.resourceName} คนขับ: ${updated.driverName} (${updated.bookingIds.length} รายการจอง${
        addedBookings.length > 0 ? ` — เพิ่มเข้ามาใหม่ ${addedBookings.length} รายการ` : ""
      }) ${requestAuditTag(request)}`,
    });
    return NextResponse.json({ tripOrder: updated, addedBookings });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
