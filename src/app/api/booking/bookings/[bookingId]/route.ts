import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, requestAuditTag, verifySessionToken } from "@/lib/auth";
import { canApproveCarBooking, canCancelBooking } from "@/lib/booking";
import { appendEditLog, cancelBooking, getBookings, setBookingApprovalStatus } from "@/lib/sheets";

export const dynamic = "force-dynamic";

// No explicit return type here — see the identical helper's doc comment in
// ../../resources/route.ts for why that matters for Next's route-handler
// type checking.
function requireSession(request: NextRequest) {
  const session = verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return { session: null, response: NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 }) };
  }
  return { session, response: null };
}

/** Cancels (soft — never deletes) one booking. Only the account that made
 * it, or any superadmin, may cancel — see lib/booking.ts canCancelBooking.
 * Every other logged-in account can see the booking but not cancel it. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ bookingId: string }> }) {
  const { session, response } = requireSession(request);
  if (!session) return response;
  const { bookingId } = await params;

  try {
    const bookings = await getBookings();
    const booking = bookings.find((b) => b.bookingId === bookingId);
    if (!booking) {
      return NextResponse.json({ error: "ไม่พบรายการจองนี้ — อาจถูกยกเลิกไปแล้ว" }, { status: 404 });
    }
    if (!canCancelBooking(booking, session)) {
      return NextResponse.json(
        { error: "ยกเลิกได้เฉพาะผู้จองเองหรือผู้ดูแลระบบ (superadmin) เท่านั้น" },
        { status: 403 }
      );
    }

    const cancelled = await cancelBooking(bookingId, session.username);
    await appendEditLog({
      timestamp: new Date().toISOString(),
      action: "ยกเลิกการจอง",
      actor: session.username,
      department: session.department,
      oldValue: "",
      newValue: `${cancelled.resourceName}: ${cancelled.startTime} - ${cancelled.endTime} ${requestAuditTag(request)}`,
    });
    return NextResponse.json({ booking: cancelled });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function readApprovalPayload(body: unknown): "approved" | "rejected" | null {
  if (!body || typeof body !== "object") return null;
  const v = (body as Record<string, unknown>).approvalStatus;
  return v === "approved" || v === "rejected" ? v : null;
}

/** Approves or rejects a pending car booking. Reachable only by an account
 * with the superadmin role — see canApproveCarBooking in lib/booking.ts,
 * which (unlike canManageBookingResources) is not narrowed to the
 * bootstrap account only, per the hospital's explicit choice. Room
 * bookings never have anything to approve — setBookingApprovalStatus
 * itself rejects those, and any booking that's already been reviewed. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ bookingId: string }> }) {
  const { session, response } = requireSession(request);
  if (!session) return response;
  if (!canApproveCarBooking(session)) {
    return NextResponse.json(
      { error: "อนุมัติ/ไม่อนุมัติการจองรถได้เฉพาะสิทธิ์ Superadmin เท่านั้น" },
      { status: 403 }
    );
  }
  const { bookingId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "คำขอไม่ถูกต้อง" }, { status: 400 });
  }
  const approvalStatus = readApprovalPayload(body);
  if (!approvalStatus) {
    return NextResponse.json({ error: "ข้อมูลที่ส่งมาไม่ถูกต้อง" }, { status: 400 });
  }

  try {
    const updated = await setBookingApprovalStatus(bookingId, approvalStatus, session.username);
    await appendEditLog({
      timestamp: new Date().toISOString(),
      action: approvalStatus === "approved" ? "อนุมัติการจองรถ" : "ไม่อนุมัติการจองรถ",
      actor: session.username,
      department: session.department,
      oldValue: "",
      newValue: `${updated.resourceName}: ${updated.startTime} - ${updated.endTime} ${requestAuditTag(request)}`,
    });
    return NextResponse.json({ booking: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
