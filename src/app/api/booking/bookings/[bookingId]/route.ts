import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, requestAuditTag, verifySessionToken } from "@/lib/auth";
import { canCancelBooking } from "@/lib/booking";
import { appendEditLog, cancelBooking, getBookings } from "@/lib/sheets";

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
