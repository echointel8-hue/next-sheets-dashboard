import { hasPermission, type PermissionSession } from "@/lib/permissions";

// Pure type definitions + derivation logic for the vehicle / meeting-room
// booking feature ("ระบบจองรถ จองห้องประชุม") — dependency-free so client
// components can import these directly without pulling in googleapis (see
// lib/maintenanceLog.ts / lib/specEvaluation.ts for the same split this
// file follows). The actual Google Sheets read/write for both tabs lives in
// lib/sheets.ts, which imports and re-exports these types.
//
// Per the hospital's explicit request, *making a booking* stays open to
// every logged-in account (any role) — there is no role restriction there,
// only "must be logged in." Managing the resources themselves (adding a
// car/room, editing one, toggling it active/inactive) is narrower: only the
// "it" role or the single env-configured bootstrap superadmin account may
// do that — see canManageBookingResources in lib/auth.ts — a superadmin
// created later through /manage/users cannot. Bookings are confirmed
// immediately on creation; the only gate is the time-conflict check below
// against the same resource.
//
// The one exception is car bookings: per a later explicit request, a car
// booking additionally needs approval before it counts as confirmed — see
// BookingApprovalStatus/canApproveCarBooking below. Room bookings never go
// through this — they stay auto-confirmed exactly as before.

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
  /** "" (no photo) or a full `data:image/...;base64,...` data URL, resized
   * and compressed client-side (see BookingResourceFormModal) before it's
   * ever sent to the server, so a booker can see what they're booking
   * before confirming. Stored directly in the sheet cell — see
   * MAX_RESOURCE_IMAGE_DATA_URL_LENGTH below for why it has to stay small. */
  imageDataUrl: string;
  /** Number of seats — only meaningful (and only collected in the UI) for
   * type "car"; always 0 for a room. 0 also means "not specified" for an
   * older car resource added before this field existed, in which case
   * isOverSeatCapacity below never flags it (there is nothing to compare
   * against). */
  seatCount: number;
}

/** Google Sheets caps a single cell at 50,000 characters — this keeps a
 * healthy safety margin under that ceiling (the row's other columns, plus
 * quoting/encoding overhead, all share the same request) while still
 * allowing a small, recognizable photo. BookingResourceFormModal resizes
 * and re-compresses every photo client-side to fit under this before it's
 * ever submitted; isValidResourceImageDataUrl below is the one shared check
 * both that upload UI and the API routes (defense in depth) run against it. */
export const MAX_RESOURCE_IMAGE_DATA_URL_LENGTH = 42000;

export function isValidResourceImageDataUrl(value: string): boolean {
  if (value === "") return true;
  if (value.length > MAX_RESOURCE_IMAGE_DATA_URL_LENGTH) return false;
  return /^data:image\/(png|jpe?g|webp);base64,/.test(value);
}

/** True only when this is a car resource with a known seat count and the
 * requested traveler count exceeds it — used both by BookingFormModal
 * (client-side, non-blocking warning) and could be reused server-side if
 * this ever needs to be enforced. A room booking, or a car with seatCount
 * still 0 ("not specified"), never triggers this. Per the hospital's
 * explicit choice, exceeding this only warns — it never blocks the
 * booking. */
export function isOverSeatCapacity(
  resource: Pick<BookingResource, "type" | "seatCount">,
  participants: number
): boolean {
  return resource.type === "car" && resource.seatCount > 0 && participants > resource.seatCount;
}

/** Car bookings need a superadmin's approval before they count as
 * confirmed — a later, narrower request than the original "every booking
 * confirms immediately" rule. Room bookings never go through this: they're
 * created already "approved" (see createBooking's approvalStatus
 * derivation in lib/sheets.ts) and this field is otherwise ignored for
 * them. A car booking made before this feature existed also reads back as
 * "approved" (see parseApprovalStatus in lib/sheets.ts) rather than
 * retroactively becoming "pending" — it was already confirmed under the
 * rule in force when it was made. */
export type BookingApprovalStatus = "pending" | "approved" | "rejected";

/** One booking against one resource, for one time range. Live vs cancelled
 * is tracked separately from approval (cancelledAt is blank while live, set
 * once cancelled — see isBookingCancelled) — a booking can be cancelled
 * regardless of its approvalStatus. Cancelled bookings are kept (never
 * deleted) as an audit trail and so the same time slot's history is
 * visible, but are always excluded from the conflict check along with
 * rejected car bookings — see hasBookingConflict. */
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
  /** "pending" only ever applies to a car booking awaiting a superadmin's
   * review; room bookings and pre-existing car bookings are "approved".
   * See BookingApprovalStatus above. */
  approvalStatus: BookingApprovalStatus;
  /** Blank until reviewed; set once a superadmin approves/rejects — see
   * canApproveCarBooking below. */
  approvedAt: string;
  approvedByUsername: string;
  /** Blank while the booking is live; set to an ISO timestamp once
   * cancelled — see isBookingCancelled. */
  cancelledAt: string;
  cancelledByUsername: string;
}

export function isBookingCancelled(booking: Pick<Booking, "cancelledAt">): boolean {
  return booking.cancelledAt.trim() !== "";
}

/** Display label + tone for a booking's overall status, shared by every
 * booking list/calendar view (BookingDashboard, BookingCalendar) so the
 * wording and color never drift between them. Cancelled always wins — a
 * cancelled booking is cancelled regardless of whether it was ever
 * approved — otherwise this just mirrors approvalStatus, which is always
 * "approved" for a room booking (see createBooking in lib/sheets.ts), so a
 * room booking always reads exactly as it always has. */
export function bookingStatusLabel(
  booking: Pick<Booking, "cancelledAt" | "approvalStatus">
): { text: string; tone: "cancelled" | "pending" | "approved" | "rejected" } {
  if (isBookingCancelled(booking)) return { text: "ยกเลิกแล้ว", tone: "cancelled" };
  if (booking.approvalStatus === "pending") return { text: "รออนุมัติ", tone: "pending" };
  if (booking.approvalStatus === "rejected") return { text: "ไม่อนุมัติ", tone: "rejected" };
  return { text: "ยืนยันแล้ว", tone: "approved" };
}

/** Splits a startTime/endTime string ("2026-08-25T14:30", the raw
 * <input type="datetime-local"> value) into its date and time parts by
 * string matching — never `new Date(...)`, so this never shifts by the
 * viewer's or server's timezone, matching the "local wall-clock, no
 * conversion" convention documented on Booking above. Returns null for
 * anything that doesn't match (a blank or malformed cell).
 *
 * Also accepts "2026-08-25 14:30[:00]" — a space instead of "T", an
 * optional seconds part, and an hour that isn't zero-padded. That's the
 * shape Google Sheets can silently rewrite a date-looking string into when
 * it's written with valueInputOption "USER_ENTERED" (it recognizes the
 * text as a date and reformats it on save; a later read-back then sees the
 * reformatted text, not what was written). Every booking write now uses
 * "RAW" instead precisely to stop that from happening going forward — see
 * the note on createBooking in lib/sheets.ts — but tolerating the
 * space-separated shape here means a booking written before that fix still
 * parses correctly instead of silently disappearing from the calendar
 * (which needs this to succeed) while still showing, garbled, in the flat
 * list (which just prints the raw string when this returns null). */
export function splitBookingDateTime(raw: string): { dateKey: string; time: string } | null {
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return { dateKey: `${y}-${mo}-${d}`, time: `${h.padStart(2, "0")}:${mi}` };
}

/** startTime/endTime -> epoch milliseconds, via splitBookingDateTime so it
 * tolerates the same two shapes that function does — never `new
 * Date(raw).getTime()` directly, which isn't guaranteed to parse a
 * non-standard "YYYY-MM-DD HH:MM" string the same way across JS engines.
 * Returns NaN for anything unparseable, same contract as Date#getTime(),
 * so existing NaN checks at every call site keep working unchanged. */
function bookingDateTimeToMillis(raw: string): number {
  const parts = splitBookingDateTime(raw);
  if (!parts) return NaN;
  const [y, mo, d] = parts.dateKey.split("-").map(Number);
  const [h, mi] = parts.time.split(":").map(Number);
  return new Date(y, mo - 1, d, h, mi).getTime();
}

/** "2026-08-25T14:30" -> "25/08/2026 14:30" — display formatting shared by
 * the flat list (BookingDashboard) and the calendar view
 * (BookingCalendar), both of which show the exact same underlying data in
 * a different shape. Falls back to the raw string unchanged if it doesn't
 * match the expected format. */
export function formatBookingDateTime(raw: string): string {
  const parts = splitBookingDateTime(raw);
  if (!parts) return raw;
  const [y, mo, d] = parts.dateKey.split("-");
  return `${d}/${mo}/${y} ${parts.time}`;
}

/** True if [startTime, endTime) would overlap any existing, still-relevant
 * booking on the same resource — the gate a new booking has to clear.
 * Cancelled bookings never block (the slot was given back), and neither do
 * rejected car bookings (the trip was turned down, so the slot is free
 * again) — a *pending* car booking still blocks, though, so two accounts
 * can't both have a request in flight for the same overlapping slot while
 * a superadmin hasn't reviewed either yet. Half-open interval overlap
 * test: two ranges overlap iff existing.start < new.end && existing.end >
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
  const start = bookingDateTimeToMillis(startTime);
  const end = bookingDateTimeToMillis(endTime);
  if (Number.isNaN(start) || Number.isNaN(end) || start >= end) return false;

  return existingBookings.some((b) => {
    if (b.resourceId !== resourceId) return false;
    if (excludeBookingId && b.bookingId === excludeBookingId) return false;
    if (isBookingCancelled(b)) return false;
    if (b.approvalStatus === "rejected") return false;
    const bStart = bookingDateTimeToMillis(b.startTime);
    const bEnd = bookingDateTimeToMillis(b.endTime);
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
 * department's booking outright. Backed by hasPermission()'s
 * "cancelAnyBooking" key for the "someone else's booking" half — same
 * unchanged default (any superadmin), now also grantable per account; a
 * booking's own owner can always cancel it regardless, exactly as before. */
export function canCancelBooking(
  booking: Pick<Booking, "bookedByUsername">,
  session: { username: string } & PermissionSession
): boolean {
  return booking.bookedByUsername === session.username || hasPermission(session, "cancelAnyBooking");
}

/** Who may approve/reject a pending car booking: any account with the
 * superadmin role — per the hospital's explicit choice, this is *not*
 * narrowed to the single bootstrap account the way
 * canManageBookingResources is; every superadmin (bootstrap or one created
 * later through /manage/users) can review car bookings, matching
 * canCancelBooking's "any superadmin" reach above. Room bookings never
 * reach this check — they have no pending state to review. Backed by
 * hasPermission()'s "approveCarBooking" key — same unchanged default (any
 * superadmin), now also grantable per account. */
export function canApproveCarBooking(session: PermissionSession): boolean {
  return hasPermission(session, "approveCarBooking");
}
