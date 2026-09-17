import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, requestAuditTag, verifySessionToken } from "@/lib/auth";
import { createBooking, getBookingResources, getBookings, getUsers, appendEditLog } from "@/lib/sheets";

// Always live — bookings and cancellations happen throughout the day and
// the conflict check must always see the current state, so caching isn't
// worth the staleness (same reasoning as MaintenanceTasks).
export const dynamic = "force-dynamic";

// No explicit return type here — see the identical helper's doc comment in
// ../resources/route.ts for why that matters for Next's route-handler type
// checking.
function requireSession(request: NextRequest) {
  const session = verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return { session: null, response: NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 }) };
  }
  return { session, response: null };
}

/** Every booking (live + cancelled), across every resource and department —
 * seeing what's already booked is the whole point of a shared calendar, so
 * this is never scoped to the caller's own department, unlike /manage's
 * equipment list. */
export async function GET(request: NextRequest) {
  const { session, response } = requireSession(request);
  if (!session) return response;

  try {
    const bookings = await getBookings();
    return NextResponse.json({ bookings });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

interface BookingPayload {
  resourceId: string;
  startTime: string;
  endTime: string;
  purpose: string;
  destination: string;
  participants: number;
  contactPhone: string;
  companions: string;
}

function readBookingPayload(body: unknown): BookingPayload | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.resourceId !== "string" || !b.resourceId.trim()) return null;
  if (typeof b.startTime !== "string" || !b.startTime.trim()) return null;
  if (typeof b.endTime !== "string" || !b.endTime.trim()) return null;
  if (typeof b.purpose !== "string" || !b.purpose.trim()) return null;
  if (typeof b.contactPhone !== "string" || !b.contactPhone.trim()) return null;
  if (typeof b.participants !== "number" || !Number.isFinite(b.participants) || b.participants < 0) return null;
  const destination = typeof b.destination === "string" ? b.destination.trim() : "";
  // ผู้ร่วมเดินทาง — optional, car only (derived down to "" for a room the
  // same way destination is, right below where this payload is consumed).
  const companions = typeof b.companions === "string" ? b.companions.trim() : "";

  const start = new Date(b.startTime).getTime();
  const end = new Date(b.endTime).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || start >= end) return null;

  return {
    resourceId: b.resourceId.trim(),
    startTime: b.startTime,
    endTime: b.endTime,
    purpose: b.purpose.trim(),
    destination,
    participants: b.participants,
    contactPhone: b.contactPhone.trim(),
    companions,
  };
}

/** Creates a booking. A room booking confirms immediately, same as always;
 * a car booking is created "pending" and needs a superadmin's approval
 * (see canApproveCarBooking in lib/booking.ts and the bookingId PATCH
 * route) before it counts as confirmed — per the hospital's explicit,
 * later request. Either way the time-conflict check inside createBooking()
 * is re-checked server-side against the live Bookings tab regardless of
 * what the client believed was free. bookedBy/department always come from
 * the session, never the request body — same rule as
 * MaintenanceTask.assignedTo. */
export async function POST(request: NextRequest) {
  const { session, response } = requireSession(request);
  if (!session) return response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "คำขอไม่ถูกต้อง" }, { status: 400 });
  }
  const payload = readBookingPayload(body);
  if (!payload) {
    return NextResponse.json({ error: "ข้อมูลที่ส่งมาไม่ถูกต้อง — กรุณากรอกข้อมูลให้ครบถ้วน" }, { status: 400 });
  }

  try {
    const resources = await getBookingResources();
    const resource = resources.find((r) => r.resourceId === payload.resourceId);
    if (!resource) {
      return NextResponse.json({ error: "ไม่พบรถ/ห้องประชุมนี้ — อาจถูกลบไปแล้ว" }, { status: 404 });
    }
    if (!resource.active) {
      return NextResponse.json({ error: "รถ/ห้องประชุมนี้ถูกปิดใช้งานแล้ว ไม่สามารถจองได้" }, { status: 400 });
    }

    // Best-effort — a Users tab hiccup shouldn't stop a booking, it just
    // means the booking shows the bare login string instead of a Thai
    // display name until the tab is reachable again (same pattern as
    // /api/manage/it/tasks POST).
    let displayName = session.username;
    try {
      const users = await getUsers();
      displayName = users.find((u) => u.username === session.username)?.displayName || session.username;
    } catch {
      // fall through with the username
    }

    const booking = await createBooking({
      resourceId: resource.resourceId,
      resourceType: resource.type,
      resourceName: resource.name,
      startTime: payload.startTime,
      endTime: payload.endTime,
      purpose: payload.purpose,
      destination: resource.type === "car" ? payload.destination : "",
      companions: resource.type === "car" ? payload.companions : "",
      participants: payload.participants,
      contactPhone: payload.contactPhone,
      bookedByUsername: session.username,
      bookedByDisplayName: displayName,
      department: session.department,
      // A room booking confirms immediately; a car booking starts pending
      // and needs a superadmin's approval — see the doc comment above.
      approvalStatus: resource.type === "car" ? "pending" : "approved",
    });

    await appendEditLog({
      timestamp: new Date().toISOString(),
      action: "จองทรัพยากร",
      actor: session.username,
      department: session.department,
      oldValue: "",
      newValue: `${resource.name}: ${payload.startTime} - ${payload.endTime} ${requestAuditTag(request)}`,
    });

    return NextResponse.json({ booking });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // A time-conflict throws a plain Error with a Thai message from
    // createBooking() — surface it as 409 so the client can tell "your
    // request was malformed" apart from "the slot's taken."
    const status = message.includes("ถูกจองไปแล้ว") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
