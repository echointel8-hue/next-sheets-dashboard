"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Ban, Building2, ChevronLeft, ChevronRight, Loader2, MapPin, Pencil, Phone, Truck, Users, X } from "lucide-react";
import type { Role } from "@/lib/auth";
import { actionColorVars, type ActionColor } from "@/lib/actionColors";
import type { PermissionKey } from "@/lib/permissions";
import {
  bookingStatusLabel,
  canCancelBooking,
  formatBookingDateTime,
  isBookingCancelled,
  splitBookingDateTime,
  type Booking,
  type TripOrder,
} from "@/lib/booking";

// Tone -> badge classes for bookingStatusLabel's four tones — same mapping
// as BookingDashboard's own copy (small enough to duplicate, matching this
// codebase's existing per-file constant convention).
const STATUS_BADGE_CLASSES: Record<ReturnType<typeof bookingStatusLabel>["tone"], string> = {
  cancelled: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  pending: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  approved: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  rejected: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
};

const THAI_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];
const THAI_WEEKDAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

/** Local-calendar-date key ("YYYY-MM-DD") for a plain JS Date, built from
 * its local getFullYear/getMonth/getDate — never toISOString(), which is
 * UTC-based and would shift the date near midnight depending on the
 * viewer's timezone. Every date this component works with is a "local
 * wall-clock date" the same way Booking.startTime/endTime are (see
 * lib/booking.ts), so this keeps the same convention. */
function dateKeyFromDate(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

function addDaysToKey(dateKey: string, days: number): string {
  const [y, mo, d] = dateKey.split("-").map(Number);
  const dt = new Date(y, mo - 1, d);
  dt.setDate(dt.getDate() + days);
  return dateKeyFromDate(dt);
}

/** Every calendar date a booking's [startTime, endTime) touches — almost
 * always just one date, but a booking that crosses midnight (e.g. an
 * overnight car trip 20:00 -> 08:00 the next day) shows up on both dates
 * it actually spans. Drops a trailing end-date whose time is exactly
 * "00:00" — a booking ending right at midnight doesn't really occupy that
 * next date. Capped at 60 days as a safety guard against a malformed row. */
function bookingDateKeys(booking: Booking): string[] {
  const start = splitBookingDateTime(booking.startTime);
  const end = splitBookingDateTime(booking.endTime);
  if (!start) return [];
  if (!end || end.dateKey === start.dateKey) return [start.dateKey];

  const keys: string[] = [];
  let cur = start.dateKey;
  for (let i = 0; i < 60; i++) {
    keys.push(cur);
    if (cur === end.dateKey) break;
    cur = addDaysToKey(cur, 1);
  }
  if (keys.length > 1 && keys[keys.length - 1] === end.dateKey && end.time === "00:00") {
    keys.pop();
  }
  return keys;
}

/** All 42 dates (6 full Sun-Sat weeks) covering the given month, including
 * the leading/trailing days borrowed from the adjacent months — a fixed
 * cell count keeps every month's grid the same height. */
function monthGrid(monthCursor: Date): Date[] {
  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = new Date(year, month, 1 - firstOfMonth.getDay());
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    days.push(d);
  }
  return days;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/**
 * Month-view calendar for one resource type's bookings — each day cell
 * shows a colored chip per booking that touches that date (color keyed by
 * resource, via resourceColorMap, so which vehicle/room is booked reads at
 * a glance), clicking a day with bookings opens a detail panel with the
 * full information and a cancel action, same as the flat list view this
 * sits alongside in BookingDashboard.
 */
export default function BookingCalendar({
  typeLabel,
  bookings,
  resourceColorMap,
  session,
  onCancel,
  cancellingBookingId,
  showDestination,
  canApprove,
  onReject,
  rejectingBookingId,
  selectedBookingIds,
  onToggleSelect,
  tripOrderByBookingId,
  onEditBooking,
  onEditTripOrder,
  onOpenTripOrder,
  onClearSelection,
}: {
  typeLabel: string;
  bookings: Booking[];
  resourceColorMap: Map<string, ActionColor>;
  session: { username: string; role: Role; isBootstrap: boolean; extraPermissions?: PermissionKey[]; revokedPermissions?: PermissionKey[] };
  onCancel: (booking: Booking) => void;
  cancellingBookingId: string | null;
  showDestination: boolean;
  /** True only on the car calendar, for a superadmin — see canApproveCarBooking
   * in lib/booking.ts. Room calendars never pass true, since room bookings
   * have no pending state to review. */
  canApprove: boolean;
  /** Rejects a pending car booking outright — the only single-click decision
   * left here. "Approving" is no longer a status flip: it only happens by
   * dispatching a TripOrder (see selectedBookingIds/onToggleSelect below and
   * TripOrderModal), which combining >1 selection into is exactly the
   * carpool feature. */
  onReject: (booking: Booking) => void;
  rejectingBookingId: string | null;
  /** Pending car bookings picked to go into the same TripOrder — owned by
   * BookingDashboard so it survives switching between calendar/list view. */
  selectedBookingIds: Set<string>;
  onToggleSelect: (booking: Booking) => void;
  /** Booking.bookingId -> the TripOrder that dispatched it (once approved
   * this way) — lets a booking card show which car/driver it ended up with,
   * without ever having edited the booking row itself. */
  tripOrderByBookingId: Map<string, TripOrder>;
  /** Opens ManagementEditBookingModal for this booking — "แก้ไขข้อมูลเท่าที่
   * จำเป็น" per the hospital's later request, only ever the narrow field set
   * editBookingByManagement allows (see its doc comment in lib/sheets.ts).
   * Same canApprove gate as everything else here. */
  onEditBooking: (booking: Booking) => void;
  /** Opens TripOrderModal in edit mode for the TripOrder covering this
   * booking — lets management correct the assigned car/driver/time after
   * the fact, without touching which bookings it covers. */
  onEditTripOrder: (tripOrder: TripOrder) => void;
  /** เปิด TripOrderModal โหมดสร้างใหม่ (ออกใบสั่งงาน) สำหรับรายการที่เลือกไว้
   * ใน selectedBookingIds ทั้งหมด — ปุ่มนี้ย้ายมาอยู่ใน DayDetailModal เอง
   * ตามที่ขอ (เดิมมีอยู่แต่ที่หัวข้อด้านบนปฏิทิน ซึ่งถูกโมดัลนี้บังไว้พอดี
   * ตอนดูรายละเอียดวัน) — BookingDashboard เป็นเจ้าของ state ที่แท้จริง. */
  onOpenTripOrder: () => void;
  /** ล้าง selectedBookingIds ทั้งหมด (ทุกวัน ไม่ใช่แค่วันที่กำลังปิด) —
   * เรียกตอนปิดหน้าต่างรายละเอียดวัน (ปุ่ม X, คลิกฉากหลัง) เพื่อไม่ให้รายการ
   * ที่เคยติ๊กไว้จากวันอื่นก่อนหน้านี้ค้างรวมอยู่ในตัวเลขที่ปุ่ม "ออกใบสั่งงาน
   * เดินทาง" ของวันถัดไปโดยไม่รู้ตัว ("ต้องรีเซ็ตเป็นแต่ละวัน" ตามที่ขอ) —
   * เปิดวันใหม่ต้องเริ่มเลือกใหม่เสมอ. */
  onClearSelection: () => void;
}) {
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(new Date()));
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);

  const days = useMemo(() => monthGrid(monthCursor), [monthCursor]);
  const todayKey = useMemo(() => dateKeyFromDate(new Date()), []);

  const bookingsByDate = useMemo(() => {
    const map = new Map<string, Booking[]>();
    for (const b of bookings) {
      for (const key of bookingDateKeys(b)) {
        const list = map.get(key) ?? [];
        list.push(b);
        map.set(key, list);
      }
    }
    for (const list of map.values()) list.sort((a, b) => (a.startTime < b.startTime ? -1 : 1));
    return map;
  }, [bookings]);

  const legendNames = useMemo(() => Array.from(resourceColorMap.keys()), [resourceColorMap]);
  const selectedBookings = selectedDateKey ? (bookingsByDate.get(selectedDateKey) ?? []) : [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMonthCursor((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
            aria-label="เดือนก่อนหน้า"
            className="rounded-full p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <ChevronLeft size={18} strokeWidth={2} aria-hidden="true" />
          </button>
          <span className="min-w-[9rem] text-center text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            {THAI_MONTHS[monthCursor.getMonth()]} {monthCursor.getFullYear()}
          </span>
          <button
            type="button"
            onClick={() => setMonthCursor((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
            aria-label="เดือนถัดไป"
            className="rounded-full p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <ChevronRight size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => setMonthCursor(startOfMonth(new Date()))}
          className="rounded-full border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          วันนี้
        </button>
      </div>

      {legendNames.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1.5">
          {legendNames.map((name) => {
            const color = resourceColorMap.get(name);
            if (!color) return null;
            return (
              <span key={name} className="inline-flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--seg-c)] dark:bg-[var(--seg-c-dark)]"
                  style={actionColorVars(color)}
                  aria-hidden="true"
                />
                {name}
              </span>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-7 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700">
        {THAI_WEEKDAYS.map((wd) => (
          <div
            key={wd}
            className="border-b border-r border-zinc-100 bg-zinc-50 px-1.5 py-1.5 text-center text-xs font-medium text-zinc-400 last:border-r-0 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-500"
          >
            {wd}
          </div>
        ))}
        {days.map((day) => {
          const key = dateKeyFromDate(day);
          const inMonth = day.getMonth() === monthCursor.getMonth();
          const dayBookings = bookingsByDate.get(key) ?? [];
          const isToday = key === todayKey;
          const visible = dayBookings.slice(0, 3);
          const extra = dayBookings.length - visible.length;
          return (
            <button
              type="button"
              key={key}
              onClick={() => dayBookings.length > 0 && setSelectedDateKey(key)}
              disabled={dayBookings.length === 0}
              className={`flex min-h-[5.5rem] flex-col items-stretch gap-1 border-b border-r border-zinc-100 p-1.5 text-left last:border-r-0 dark:border-zinc-800 ${
                inMonth ? "bg-white dark:bg-zinc-900" : "bg-zinc-50/60 dark:bg-zinc-950/30"
              } ${
                dayBookings.length > 0
                  ? "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                  : "cursor-default"
              }`}
            >
              <span
                className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                  isToday
                    ? "bg-gradient-to-br from-[var(--brand)] to-[var(--brand-2)] font-semibold text-[var(--brand-contrast)]"
                    : inMonth
                      ? "text-zinc-600 dark:text-zinc-300"
                      : "text-zinc-300 dark:text-zinc-600"
                }`}
              >
                {day.getDate()}
              </span>
              <div className="flex flex-col gap-0.5">
                {visible.map((b) => {
                  const cancelled = isBookingCancelled(b);
                  const pending = !cancelled && b.approvalStatus === "pending";
                  const color = resourceColorMap.get(b.resourceName);
                  const startTimeOfDay = splitBookingDateTime(b.startTime)?.time ?? "";
                  const endTimeOfDay = splitBookingDateTime(b.endTime)?.time ?? "";
                  return (
                    <span
                      key={b.bookingId}
                      style={!cancelled && color ? actionColorVars(color) : undefined}
                      // จองรถที่ "รออนุมัติ" ใช้เส้นขอบประสีเหลือง แทนสีทรัพยากร
                      // ปกติ — ให้ superadmin กวาดตาเห็นได้ทันทีว่ายังต้องรีวิว
                      className={`truncate rounded px-1 py-0.5 text-[10px] leading-tight ${
                        cancelled
                          ? "bg-zinc-200 text-zinc-500 line-through dark:bg-zinc-800 dark:text-zinc-500"
                          : pending
                            ? "border border-dashed border-amber-500 bg-amber-50 text-amber-800 dark:border-amber-400 dark:bg-amber-950/40 dark:text-amber-200"
                            : "bg-[var(--seg-c)] text-white dark:bg-[var(--seg-c-dark)]"
                      }`}
                    >
                      {startTimeOfDay}
                      {endTimeOfDay ? `-${endTimeOfDay}` : ""} {b.department || b.resourceName}
                    </span>
                  );
                })}
                {extra > 0 && (
                  <span className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500">
                    +{extra} เพิ่มเติม
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {selectedDateKey && (
        <DayDetailModal
          dateKey={selectedDateKey}
          typeLabel={typeLabel}
          bookings={selectedBookings}
          resourceColorMap={resourceColorMap}
          session={session}
          onCancel={onCancel}
          cancellingBookingId={cancellingBookingId}
          showDestination={showDestination}
          canApprove={canApprove}
          onReject={onReject}
          rejectingBookingId={rejectingBookingId}
          selectedBookingIds={selectedBookingIds}
          onToggleSelect={onToggleSelect}
          tripOrderByBookingId={tripOrderByBookingId}
          onEditBooking={onEditBooking}
          onEditTripOrder={onEditTripOrder}
          onOpenTripOrder={onOpenTripOrder}
          onClose={() => {
            // ปิดหน้าต่างวันนี้ + ล้างรายการที่เลือกไว้ทั้งหมด — ดูคอมเมนต์ที่
            // onClearSelection prop ด้านบนสำหรับเหตุผล
            onClearSelection();
            setSelectedDateKey(null);
          }}
        />
      )}
    </div>
  );
}

function DayDetailModal({
  dateKey,
  typeLabel,
  bookings,
  resourceColorMap,
  session,
  onCancel,
  cancellingBookingId,
  showDestination,
  canApprove,
  onReject,
  rejectingBookingId,
  selectedBookingIds,
  onToggleSelect,
  tripOrderByBookingId,
  onEditBooking,
  onEditTripOrder,
  onOpenTripOrder,
  onClose,
}: {
  dateKey: string;
  typeLabel: string;
  bookings: Booking[];
  resourceColorMap: Map<string, ActionColor>;
  session: { username: string; role: Role; isBootstrap: boolean; extraPermissions?: PermissionKey[]; revokedPermissions?: PermissionKey[] };
  onCancel: (booking: Booking) => void;
  cancellingBookingId: string | null;
  showDestination: boolean;
  canApprove: boolean;
  onReject: (booking: Booking) => void;
  rejectingBookingId: string | null;
  selectedBookingIds: Set<string>;
  onToggleSelect: (booking: Booking) => void;
  tripOrderByBookingId: Map<string, TripOrder>;
  onEditBooking: (booking: Booking) => void;
  onEditTripOrder: (tripOrder: TripOrder) => void;
  onOpenTripOrder: () => void;
  onClose: () => void;
}) {
  const [y, mo, d] = dateKey.split("-");
  const dateLabel = `${d}/${mo}/${y}`;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-day-detail-title"
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-zinc-900"
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <h2 id="booking-day-detail-title" className="text-base font-semibold text-zinc-800 dark:text-zinc-100">
            การจอง{typeLabel} วันที่ {dateLabel}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดหน้าต่าง"
            className="rounded-full p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
          >
            <X size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        <div className="flex flex-col gap-3 overflow-y-auto px-5 py-4">
          {bookings.length === 0 ? (
            <p className="py-4 text-center text-sm text-zinc-500 dark:text-zinc-400">ไม่มีการจองในวันนี้</p>
          ) : (
            bookings.map((b) => {
              const cancelled = isBookingCancelled(b);
              const color = resourceColorMap.get(b.resourceName);
              const status = bookingStatusLabel(b);
              return (
                <div
                  key={b.bookingId}
                  className={`flex flex-col gap-1.5 rounded-xl border p-3 ${
                    cancelled
                      ? "border-zinc-200 opacity-70 dark:border-zinc-800"
                      : "border-zinc-200 dark:border-zinc-700"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      {color && (
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--seg-c)] dark:bg-[var(--seg-c-dark)]"
                          style={actionColorVars(color)}
                          aria-hidden="true"
                        />
                      )}
                      <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                        {b.resourceName}
                      </span>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASSES[status.tone]}`}>
                      {status.text}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {formatBookingDateTime(b.startTime)} – {formatBookingDateTime(b.endTime)}
                  </p>
                  <p className="text-sm text-zinc-700 dark:text-zinc-200">{b.purpose}</p>
                  {showDestination && b.destination && (
                    <span className="inline-flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                      <MapPin size={12} strokeWidth={2} aria-hidden="true" className="shrink-0" />
                      {b.destination}
                    </span>
                  )}
                  {showDestination && b.companions && (
                    <span className="inline-flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                      <Users size={12} strokeWidth={2} aria-hidden="true" className="shrink-0" />
                      ผู้เดินทาง: {b.companions}
                    </span>
                  )}
                  {showDestination && b.editedByUsername && (
                    <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                      <Pencil size={12} strokeWidth={2} aria-hidden="true" className="shrink-0" />
                      แก้ไขโดยฝ่ายบริหาร ({b.editedByUsername})
                    </span>
                  )}
                  {showDestination && tripOrderByBookingId.get(b.bookingId) && (
                    <span className="flex items-start justify-between gap-1.5 rounded-lg bg-sky-50 p-2 text-xs leading-5 text-sky-800 dark:bg-sky-950/30 dark:text-sky-200">
                      <span className="flex items-start gap-1.5">
                        <Truck size={13} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
                        <span>
                          คนขับ: {tripOrderByBookingId.get(b.bookingId)!.driverName || "—"}
                          {tripOrderByBookingId.get(b.bookingId)!.bookingIds.length > 1 && (
                            <> (ร่วมเที่ยวกับอีก {tripOrderByBookingId.get(b.bookingId)!.bookingIds.length - 1} คำขอ)</>
                          )}
                        </span>
                      </span>
                      {canApprove && (
                        <button
                          type="button"
                          onClick={() => onEditTripOrder(tripOrderByBookingId.get(b.bookingId)!)}
                          className="shrink-0 rounded-full p-1 text-sky-700 transition-colors hover:bg-sky-100 dark:text-sky-300 dark:hover:bg-sky-900/40"
                          aria-label="แก้ไขใบสั่งงานเดินทาง"
                        >
                          <Pencil size={12} strokeWidth={2} aria-hidden="true" />
                        </button>
                      )}
                    </span>
                  )}
                  {b.department && (
                    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand-strong)]">
                      <Building2 size={14} strokeWidth={2} aria-hidden="true" className="shrink-0" />
                      {b.department}
                    </span>
                  )}
                  <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                    <span className="inline-flex items-center gap-1">
                      <Users size={12} strokeWidth={2} aria-hidden="true" className="shrink-0" />
                      {b.participants.toLocaleString("th-TH")}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Phone size={12} strokeWidth={2} aria-hidden="true" className="shrink-0" />
                      {b.contactPhone}
                    </span>
                    <span>{b.bookedByDisplayName || b.bookedByUsername}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {!cancelled && canApprove && b.approvalStatus === "pending" && (
                      <>
                        <label className="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-full border border-zinc-200 px-2 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
                          <input
                            type="checkbox"
                            checked={selectedBookingIds.has(b.bookingId)}
                            onChange={() => onToggleSelect(b)}
                            className="h-3.5 w-3.5 accent-[var(--brand)]"
                          />
                          เลือกจัดรถ
                        </label>
                        <button
                          type="button"
                          onClick={() => onReject(b)}
                          disabled={rejectingBookingId === b.bookingId}
                          className="inline-flex w-fit items-center gap-1 rounded-full border border-red-200 px-2 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:opacity-60 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/30"
                        >
                          {rejectingBookingId === b.bookingId ? (
                            <Loader2 size={12} strokeWidth={2} className="animate-spin" aria-hidden="true" />
                          ) : (
                            <X size={12} strokeWidth={2} aria-hidden="true" />
                          )}
                          ไม่อนุมัติ
                        </button>
                      </>
                    )}
                    {!cancelled && canApprove && showDestination && (
                      <button
                        type="button"
                        onClick={() => onEditBooking(b)}
                        className="inline-flex w-fit items-center gap-1 rounded-full border border-zinc-200 px-2 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      >
                        <Pencil size={12} strokeWidth={2} aria-hidden="true" />
                        แก้ไขข้อมูล
                      </button>
                    )}
                    {!cancelled && canCancelBooking(b, session) && (
                      <button
                        type="button"
                        onClick={() => onCancel(b)}
                        disabled={cancellingBookingId === b.bookingId}
                        className="inline-flex w-fit items-center gap-1 rounded-full border border-red-200 px-2 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:opacity-60 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/30"
                      >
                        {cancellingBookingId === b.bookingId ? (
                          <Loader2 size={12} strokeWidth={2} className="animate-spin" aria-hidden="true" />
                        ) : (
                          <Ban size={12} strokeWidth={2} aria-hidden="true" />
                        )}
                        ยกเลิก
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
        {/* ปุ่ม "ออกใบสั่งงานเดินทาง" ย้ายมาไว้ตรงนี้ (แถบท้ายหน้าต่างรายละเอียด
            วัน) ตามที่ขอ — เดิมอยู่เหนือปฏิทินด้านหลัง ซึ่งหน้าต่างนี้บังไว้
            พอดีตอนกำลังเลือกจัดรถอยู่ ต้องปิดหน้าต่างนี้ก่อนถึงจะกดได้ ย้ายมา
            ไว้ในหน้าต่างเดียวกันนี้แทน กดได้ทันทีโดยไม่ต้องปิดก่อน (ยังใช้
            selectedBookingIds ชุดเดียวกับที่ BookingDashboard เป็นเจ้าของ จึง
            อาจรวมรายการที่เลือกไว้จากวันอื่นก่อนหน้านี้ด้วยได้เหมือนเดิม) */}
        {canApprove && selectedBookingIds.size > 0 && (
          <div className="flex justify-end border-t border-zinc-100 px-5 py-3 dark:border-zinc-800">
            <button
              type="button"
              onClick={onOpenTripOrder}
              className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-br from-sky-600 to-sky-500 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-opacity hover:opacity-90"
            >
              <Truck size={14} strokeWidth={2} aria-hidden="true" />
              ออกใบสั่งงานเดินทาง ({selectedBookingIds.size.toLocaleString("th-TH")})
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
