import type { Role } from "@/lib/auth";

// Pure type definitions + derivation logic for the vehicle / meeting-room
// booking feature ("ระบบจองรถ จองห้องประชุม") — dependency-free so client
// components can import these directly without pulling in googleapis (see
// lib/maintenanceLog.ts / lib/specEvaluation.ts for the same split this
// file follows). The actual Google Sheets read/write for both tabs lives in
// lib/sheets.ts, which imports and re-exports these types.
//
// Per the hospital's explicit request: every logged-in account (any role —
// superadmin, admin, it) has equal rights to add/edit resources and to
// book them — there is no role restriction anywhere in this feature, only
// "must be logged in." Bookings are confirmed immediately on creation; the
// only gate is the time-conflict check below against the same resource —
// there is no approval step.

export type BookingResourceType = "car" | "room";

/** One bookable resource — a vehicle or a meeting room. Soft-deactivated
 * (Active=N) rather than ever hard-deleted, so past bookings against it
 * keep their meaning (a booking snapshots the resource's name at the time
 * it was made — see Booking.resourceName below — but still points back at
 * this ResourceId for the conflict check and for "which resource is this
 * booking against" in the UI). A deactivated resource simply stops
 * appearing as choosable for *new* bookings. */
export interface BookingResource {
  resourceId: string;
  type: BookingResourceType;
  name: string;
  /** Free text — e.g. a car's license plate/seats, a room's floor/capacity. */
  detail: string;
  active: boolean;
  createdAt: string;
  createdByUsername: string;
}

/** One booking against one resource, for one time range. No status field —
 * a booking is either live (cancelledAt is blank) or cancelled
 * (cancelledAt is set); there is no pending/approved state since bookings
 * confirm immediately. Cancelled bookings are kept (never deleted) as an
 * audit trail and so the same time slot's history is visible, but are
 * always excluded from the conflict check — see hasBookingConflict. */
export interface Booking {
  bookingId: string;
  resourceId: string;
  resourceType: BookingResourceType;
  /** Snapshot of the resource's name at booking time, so this booking's
   * label in the UI/printouts never changes even if the resource is later
   * renamed — same rationale as MaintenanceTask's equipment snapshot
   * fields in lib/sheets.ts. */
  resourceName: string;
  /** ISO 8601 datetime strings (local wall-clock, no timezone conversion —
   * same convention as every other timestamp this app stores). */
  startTime: string;
  endTime: string;
  /** วัตถุประสงค์ / เหตุผลการใช้งาน — required for every booking. */
  purpose: string;
  /** ปลายทาง — only meaningful (and only collected in the UI) for
   * resourceType "car"; always "" for a room booking. */
  destination: string;
  /** จำนวนผู้โดยสาร/ผู้เข้าร่วม. */
  participants: number;
  /** เบอร์ติดต่อผู้จอง. */
  contactPhone: string;
  bookedByUsername: string;
  bookedByDisplayName: string;
  department: string;
  createdAt: string;
  /** Blank while the booking is live; set to an ISO timestamp once
   * cancelled — see isBookingCancelled. */
  cancelledAt: string;
  cancelledByUsername: string;
}

export function isBookingCancelled(booking: Pick<Booking, "cancelledAt">): boolean {
  return booking.cancelledAt.trim() !== "";
}

/** True if [startTime, endTime) would overlap any existing, non-cancelled
 * booking on the same resource — the only gate a new booking has to clear,
 * since there is no approval step. Half-open interval overlap test:
 * two ranges overlap iff existing.start < new.end && existing.end >
 * new.start. `excludeBookingId` lets a future "edit booking time" feature
 * check a booking against every *other* booking without conflicting with
 * itself; unused by plain creation. */
export function hasBookingConflict(
  existingBookings: Booking[],
  resourceId: string,
  startTime: string,
  endTime: string,
  excludeBookingId?: string
): boolean {
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || start >= end) return false;

  return existingBookings.some((b) => {
    if (b.resourceId !== resourceId) return false;
    if (excludeBookingId && b.bookingId === excludeBookingId) return false;
    if (isBookingCancelled(b)) return false;
    const bStart = new Date(b.startTime).getTime();
    const bEnd = new Date(b.endTime).getTime();
    if (Number.isNaN(bStart) || Number.isNaN(bEnd)) return false;
    return bStart < end && bEnd > start;
  });
}

/** Who may cancel a booking: the account that made it, or any superadmin
 * (every department, same "oversight" reach a superadmin already has
 * everywhere else in this app) — not gated to the bootstrap account, since
 * resource/booking management itself was explicitly opened up to every
 * role equally. Not exposed as a setting the user was asked about; this is
 * a reasonable default to stop one account from cancelling another
 * department's booking outright. */
export function canCancelBooking(
  booking: Pick<Booking, "bookedByUsername">,
  session: { username: string; role: Role }
): boolean {
  return booking.bookedByUsername === session.username || session.role === "superadmin";
}
