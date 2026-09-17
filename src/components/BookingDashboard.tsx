"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Ban,
  Calendar,
  CalendarDays,
  CalendarPlus,
  Car,
  DoorOpen,
  ImageOff,
  List,
  Loader2,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Power,
  Truck,
  Users,
  X as XIcon,
} from "lucide-react";
import type { Role } from "@/lib/auth";
import { buildActionColorMap, actionColorVars, type ActionColor } from "@/lib/actionColors";
import {
  bookingStatusLabel,
  canApproveCarBooking,
  canCancelBooking,
  formatBookingDateTime,
  isBookingCancelled,
  type Booking,
  type BookingResource,
  type BookingResourceType,
  type TripOrder,
} from "@/lib/booking";
import {
  canAccessItDashboardClient,
  canManageBookingResourcesClient,
  canManageUsersClient,
  roleLabelFor,
} from "@/lib/roleLabel";
import type { PermissionKey } from "@/lib/permissions";
import AppShell from "@/components/AppShell";
import BookingResourceFormModal from "@/components/BookingResourceFormModal";
import BookingFormModal from "@/components/BookingFormModal";
import BookingCalendar from "@/components/BookingCalendar";
import TripOrderModal from "@/components/TripOrderModal";
import ManagementEditBookingModal from "@/components/ManagementEditBookingModal";

export interface BookingDashboardData {
  resources: BookingResource[];
  bookings: Booking[];
  tripOrders: TripOrder[];
}
export type BookingLoadResult = BookingDashboardData | { error: string };

function isError(data: BookingLoadResult): data is { error: string } {
  return "error" in data;
}

const CARD =
  "rounded-2xl border border-emerald-900/10 bg-gradient-to-b from-white to-emerald-50 shadow-[0_1px_2px_rgba(4,120,87,0.04),0_4px_16px_-4px_rgba(4,120,87,0.14)] dark:border-emerald-400/10 dark:from-zinc-900 dark:to-zinc-900 dark:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_4px_16px_-4px_rgba(0,0,0,0.45)]";
const ACTION_BUTTON =
  "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60";
// Tone -> badge classes for bookingStatusLabel's four tones — shared shape
// with BookingCalendar's own copy of this mapping (small enough, and this
// codebase's existing convention, to duplicate rather than share a
// constant across the two files).
const STATUS_BADGE_CLASSES: Record<ReturnType<typeof bookingStatusLabel>["tone"], string> = {
  cancelled: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  pending: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  approved: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  rejected: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
};

/**
 * Top-level page for one half of the vehicle / meeting-room booking
 * feature — /booking/car and /booking/room are now genuinely separate
 * pages/menu items (not a combined page with an internal car/room
 * switcher), each rendering this same component pinned to its own `type`,
 * per the hospital's explicit request. Every logged-in account (any role)
 * can make a booking; only managing the resource list itself
 * (add/edit/toggle-active — see canManageBookingResourcesClient) is
 * restricted to the "it" role and the bootstrap superadmin account.
 */
export default function BookingDashboard({
  session,
  initial,
  type,
}: {
  session: {
    username: string;
    displayName: string;
    role: Role;
    department: string;
    isBootstrap: boolean;
    extraPermissions?: PermissionKey[];
    revokedPermissions?: PermissionKey[];
  };
  initial: BookingLoadResult;
  /** Fixed for the lifetime of this page — set by whichever route rendered
   * it (/booking/car or /booking/room), never changed client-side. */
  type: BookingResourceType;
}) {
  const [data, setData] = useState<BookingLoadResult>(initial);
  const canManageResources = canManageBookingResourcesClient(
    session.role,
    session.isBootstrap,
    session.extraPermissions,
    session.revokedPermissions
  );
  const [resourceModal, setResourceModal] = useState<{ mode: "add" | "edit"; resource?: BookingResource } | null>(
    null
  );
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [togglingResourceId, setTogglingResourceId] = useState<string | null>(null);
  const [cancellingBookingId, setCancellingBookingId] = useState<string | null>(null);
  const [rejectingBookingId, setRejectingBookingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"calendar" | "list">("calendar");
  // รายการจองรถที่ "รออนุมัติ" ที่ถูกเลือกไว้เพื่อรวมออกใบสั่งงานเดียวกัน —
  // เลือกได้มากกว่า 1 รายการ นั่นคือฟีเจอร์ "รวมเที่ยว/คาร์พูล" ในตัว ไม่มี
  // ขั้นตอนรวมแยกต่างหาก ดู TripOrderModal ที่ถูกเปิดจาก tripOrderModalOpen
  const [selectedBookingIds, setSelectedBookingIds] = useState<Set<string>>(new Set());
  const [tripOrderModalOpen, setTripOrderModalOpen] = useState(false);
  // "แก้ไขข้อมูลเท่าที่จำเป็น" โดยฝ่ายบริหาร — ข้อยกเว้นเดียวจาก "ข้อมูลคำขอ
  // เดิมไม่ถูกแก้ไข" ตามที่โรงพยาบาลขอเพิ่มภายหลัง ดู ManagementEditBookingModal
  const [editBookingTarget, setEditBookingTarget] = useState<Booking | null>(null);
  // แก้ไขใบสั่งงานเดินทางที่ออกไปแล้ว (รถ/คนขับ/เวลา/หมายเหตุ) — ใช้
  // TripOrderModal ตัวเดียวกับตอนสร้างใหม่ แต่ในโหมดแก้ไข (ส่ง editing prop)
  const [editTripOrderTarget, setEditTripOrderTarget] = useState<TripOrder | null>(null);
  // เฉพาะการจองรถต้องมีขั้นตอนอนุมัติ — ห้องประชุมไม่มี (ยืนยันทันทีเหมือนเดิม)
  const canApprove = type === "car" && canApproveCarBooking(session);

  const resources = isError(data) ? [] : data.resources;
  const bookings = isError(data) ? [] : data.bookings;
  const tripOrders = isError(data) ? [] : data.tripOrders;

  // `resources`/`bookings` above are freshly re-derived from `data` on
  // every render (not stable references), so depending on `data` itself —
  // which *is* stable between renders — is the correct/equivalent
  // dependency and avoids the "changes every render" lint warning without
  // introducing a redundant extra useMemo layer just to memoize them too.
  const typeResources = useMemo(
    () => resources.filter((r) => r.type === type).slice().sort((a, b) => a.name.localeCompare(b.name, "th")),
    [data, type] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const activeTypeResources = useMemo(() => typeResources.filter((r) => r.active), [typeResources]);
  const typeBookings = useMemo(
    () =>
      bookings
        .filter((b) => b.resourceType === type)
        .slice()
        .sort((a, b) => (a.startTime < b.startTime ? 1 : -1)),
    [data, type] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Booking.bookingId -> the TripOrder that dispatched it — every booking
  // covers at most one TripOrder (createTripOrder validates "pending" up
  // front, so a booking can never be picked up by two), so a plain Map is
  // enough. Used to show "คนขับ: ..." on an approved car booking without
  // ever having edited the booking row itself.
  const tripOrderByBookingId: Map<string, TripOrder> = useMemo(() => {
    const map = new Map<string, TripOrder>();
    for (const t of tripOrders) {
      for (const bookingId of t.bookingIds) map.set(bookingId, t);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const selectedBookings = useMemo(
    () => typeBookings.filter((b) => selectedBookingIds.has(b.bookingId)),
    [typeBookings, selectedBookingIds]
  );

  // Color each resource of the current type by when it was *created*
  // (createdAt, append-only) rather than by typeResources' own
  // alphabetical display order — the same "index-based assignment must
  // survive reordering/renaming" lesson as ReportSettings.actionColorOrder
  // in lib/sheets.ts: if colors were assigned by alphabetical position,
  // adding a resource that happens to sort earlier (or renaming one) would
  // silently reshuffle every other resource's color too. Built from every
  // resource of this type, active or not, so a cancelled booking against a
  // since-deactivated resource still shows a stable, decodable color.
  //
  // Car only ever gets an empty map now (deliberately, not just a
  // did-nothing branch) — a car booking no longer records which real car
  // resource it's against (see PENDING_CAR_RESOURCE_NAME in
  // lib/booking.ts), so every car booking would share the exact same
  // placeholder resourceName and this map's per-resource legend/coloring
  // would be pure noise (a legend listing every car in the fleet, none of
  // which any booking could ever actually be colored by) — better to show
  // none at all than a misleading one. Room bookings still pick a real
  // resource up front, so this is entirely unchanged for them.
  const resourceColorMap: Map<string, ActionColor> = useMemo(() => {
    if (type === "car") return new Map();
    const byCreatedAt = resources
      .filter((r) => r.type === type)
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((r) => r.name);
    return buildActionColorMap(byCreatedAt);
    // `resources` is freshly re-derived from `data` every render (see the
    // comment above typeResources); `data`/`type` are the real,
    // stable dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, type]);

  function handleResourceSaved(resource: BookingResource) {
    setData((prev) => {
      if (isError(prev)) return prev;
      const exists = prev.resources.some((r) => r.resourceId === resource.resourceId);
      const nextResources = exists
        ? prev.resources.map((r) => (r.resourceId === resource.resourceId ? resource : r))
        : [...prev.resources, resource];
      return { ...prev, resources: nextResources };
    });
    setResourceModal(null);
  }

  function handleBookingSaved(booking: Booking) {
    setData((prev) => (isError(prev) ? prev : { ...prev, bookings: [...prev.bookings, booking] }));
    setBookingModalOpen(false);
  }

  async function toggleResourceActive(resource: BookingResource) {
    setTogglingResourceId(resource.resourceId);
    setActionError(null);
    try {
      const res = await fetch(`/api/booking/resources/${resource.resourceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !resource.active }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(json.error || "บันทึกไม่สำเร็จ");
        return;
      }
      handleResourceSaved(json.resource as BookingResource);
    } catch {
      setActionError("บันทึกไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setTogglingResourceId(null);
    }
  }

  async function handleCancelBooking(booking: Booking) {
    const confirmed = window.confirm(
      `ยืนยันยกเลิกการจอง "${booking.resourceName}"\nช่วง ${formatBookingDateTime(booking.startTime)} - ${formatBookingDateTime(booking.endTime)} ใช่หรือไม่?`
    );
    if (!confirmed) return;

    setCancellingBookingId(booking.bookingId);
    setActionError(null);
    try {
      const res = await fetch(`/api/booking/bookings/${booking.bookingId}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(json.error || "ยกเลิกไม่สำเร็จ");
        return;
      }
      const cancelled = json.booking as Booking;
      setData((prev) =>
        isError(prev)
          ? prev
          : { ...prev, bookings: prev.bookings.map((b) => (b.bookingId === cancelled.bookingId ? cancelled : b)) }
      );
    } catch {
      setActionError("ยกเลิกไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setCancellingBookingId(null);
    }
  }

  /** Rejects a pending car booking outright — single click, no TripOrder
   * involved. "Approving" is handled entirely by handleTripOrderCreated
   * below now — see PATCH /api/booking/bookings/[bookingId]'s doc comment
   * for why this endpoint no longer accepts approvalStatus: "approved". */
  async function handleReject(booking: Booking) {
    setRejectingBookingId(booking.bookingId);
    setActionError(null);
    try {
      const res = await fetch(`/api/booking/bookings/${booking.bookingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalStatus: "rejected" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(json.error || "บันทึกผลการไม่อนุมัติไม่สำเร็จ");
        return;
      }
      const updated = json.booking as Booking;
      setData((prev) =>
        isError(prev)
          ? prev
          : { ...prev, bookings: prev.bookings.map((b) => (b.bookingId === updated.bookingId ? updated : b)) }
      );
      setSelectedBookingIds((prev) => {
        if (!prev.has(updated.bookingId)) return prev;
        const next = new Set(prev);
        next.delete(updated.bookingId);
        return next;
      });
    } catch {
      setActionError("บันทึกผลการไม่อนุมัติไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setRejectingBookingId(null);
    }
  }

  function toggleBookingSelection(booking: Booking) {
    setSelectedBookingIds((prev) => {
      const next = new Set(prev);
      if (next.has(booking.bookingId)) next.delete(booking.bookingId);
      else next.add(booking.bookingId);
      return next;
    });
  }

  /** Merges the newly-dispatched TripOrder + its updated (now "approved")
   * bookings into local state — the bookings' own fields never changed,
   * only approvalStatus/tripOrderId, same as what createTripOrder actually
   * wrote server-side. */
  function handleTripOrderCreated({ tripOrder, bookings: updatedBookings }: { tripOrder: TripOrder; bookings: Booking[] }) {
    setData((prev) => {
      if (isError(prev)) return prev;
      const updatedById = new Map(updatedBookings.map((b) => [b.bookingId, b]));
      return {
        ...prev,
        tripOrders: [...prev.tripOrders, tripOrder],
        bookings: prev.bookings.map((b) => updatedById.get(b.bookingId) ?? b),
      };
    });
    setSelectedBookingIds(new Set());
    setTripOrderModalOpen(false);
  }

  /** ผลจากการแก้ไขใบสั่งงานที่ออกไปแล้ว — แทนที่ TripOrder เดิมใน state ด้วย
   * ตัวที่แก้ไขแล้ว (ไม่ใช่ append ใหม่เหมือน handleTripOrderCreated) และไม่
   * ต้องแตะ bookings เลย เพราะการแก้ไขใบสั่งงานไม่เปลี่ยนแถวการจองที่ครอบคลุม
   * อยู่ (ดู updateTripOrder ใน lib/sheets.ts). */
  function handleTripOrderUpdated(updated: TripOrder) {
    setData((prev) =>
      isError(prev)
        ? prev
        : { ...prev, tripOrders: prev.tripOrders.map((t) => (t.tripOrderId === updated.tripOrderId ? updated : t)) }
    );
    setEditTripOrderTarget(null);
  }

  function handleManagementEditSaved(updated: Booking) {
    setData((prev) =>
      isError(prev) ? prev : { ...prev, bookings: prev.bookings.map((b) => (b.bookingId === updated.bookingId ? updated : b)) }
    );
    setEditBookingTarget(null);
  }

  const typeLabel = type === "car" ? "รถ" : "ห้องประชุม";
  const TypeIcon = type === "car" ? Car : DoorOpen;

  return (
    <AppShell
      roleLabel={roleLabelFor(session.role, session.department, session.isBootstrap)}
      username={session.username}
      displayName={session.displayName}
      canAccessManage={session.role !== "it"}
      canManageUsers={canManageUsersClient(
        session.role,
        session.isBootstrap,
        session.extraPermissions,
        session.revokedPermissions
      )}
      canAccessIt={canAccessItDashboardClient(
        session.role,
        session.isBootstrap,
        session.extraPermissions,
        session.revokedPermissions
      )}
      canApproveBookings={canApproveCarBooking(session)}
    >
    <main className="flex w-full flex-1 justify-center px-4 py-8 sm:px-6 lg:px-10">
      <div className="flex w-full max-w-6xl flex-col gap-6">
        <header className="flex items-center gap-3">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--brand)] to-[var(--brand-2)] text-[var(--brand-contrast)] shadow-sm"
            aria-hidden="true"
          >
            <TypeIcon size={20} strokeWidth={2} />
          </span>
          <div>
            <h1 className="text-xl font-bold text-zinc-950 dark:text-zinc-50 sm:text-2xl">
              ระบบจอง{typeLabel}
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {session.displayName || session.username} · {session.role}
              {session.department ? ` · ${session.department}` : ""}
            </p>
          </div>
        </header>

        {isError(data) && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-900 shadow-sm dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
          >
            <AlertTriangle size={22} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
            <p className="flex-1 text-base leading-7">{data.error}</p>
          </div>
        )}

        {actionError && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-900 shadow-sm dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
          >
            <AlertTriangle size={20} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
            <p className="flex-1 text-sm leading-6">{actionError}</p>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="text-xs font-medium text-red-700 hover:underline dark:text-red-300"
            >
              ปิด
            </button>
          </div>
        )}

        {!isError(data) && (
          <>
            {/* รายการ{typeLabel} */}
            <div className={`${CARD} flex flex-col gap-3 p-4`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                  <TypeIcon size={15} strokeWidth={2} aria-hidden="true" />
                  รายการ{typeLabel}
                </div>
                {canManageResources && (
                  <button
                    type="button"
                    onClick={() => setResourceModal({ mode: "add" })}
                    className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-br from-[var(--brand)] to-[var(--brand-2)] px-3 py-1.5 text-xs font-medium text-[var(--brand-contrast)] shadow-sm transition-opacity hover:opacity-90"
                  >
                    <Plus size={14} strokeWidth={2} aria-hidden="true" />
                    เพิ่ม{typeLabel}ใหม่
                  </button>
                )}
              </div>

              {typeResources.length === 0 ? (
                <p className="py-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  ยังไม่มี{typeLabel}ในระบบ
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {typeResources.map((resource) => (
                    <div
                      key={resource.resourceId}
                      className={`flex flex-col gap-2 rounded-xl border p-3 ${
                        resource.active
                          ? "border-zinc-200 dark:border-zinc-700"
                          : "border-zinc-200 bg-zinc-50 opacity-70 dark:border-zinc-800 dark:bg-zinc-950/40"
                      }`}
                    >
                      {/* รูปภาพ — ให้ผู้จองได้พิจารณาก่อนตัดสินใจจอง (ที่นี่
                          และอีกครั้งในตัวเลือกตอนจอง — ดู BookingFormModal) */}
                      <div className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800">
                        {resource.imageDataUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- data: URL from the sheet, not a static/remote asset next/image can optimize
                          <img
                            src={resource.imageDataUrl}
                            alt={resource.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <ImageOff size={22} strokeWidth={1.5} className="text-zinc-300 dark:text-zinc-600" aria-hidden="true" />
                        )}
                      </div>
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                          {resource.name}
                        </span>
                        {!resource.active && (
                          <span className="shrink-0 rounded-full bg-zinc-200 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                            ปิดใช้งาน
                          </span>
                        )}
                      </div>
                      {resource.detail && (
                        // whitespace-pre-line: เก็บการขึ้นบรรทัดใหม่ตามที่ผู้ดูแลพิมพ์ไว้ในช่อง
                        // "รายละเอียดเพิ่มเติม" (textarea) — ก่อนหน้านี้ <p> ปกติจะยุบทุกบรรทัด
                        // รวมเป็นย่อหน้าเดียว ทำให้ข้อความที่แยกบรรทัด/หัวข้อย่อยอ่านยาก
                        <p className="whitespace-pre-line text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
                          {resource.detail}
                        </p>
                      )}
                      {type === "car" && !!resource.seatCount && (
                        <span className="inline-flex w-fit items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                          <Users size={12} strokeWidth={2} aria-hidden="true" className="shrink-0" />
                          {resource.seatCount.toLocaleString("th-TH")} ที่นั่ง
                        </span>
                      )}
                      {canManageResources && (
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => setResourceModal({ mode: "edit", resource })}
                            className={`${ACTION_BUTTON} border-zinc-200 text-zinc-600 hover:bg-zinc-50 focus-visible:outline-zinc-500 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800`}
                          >
                            <Pencil size={12} strokeWidth={2} aria-hidden="true" />
                            แก้ไข
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleResourceActive(resource)}
                            disabled={togglingResourceId === resource.resourceId}
                            className={
                              resource.active
                                ? `${ACTION_BUTTON} border-amber-200 text-amber-700 hover:bg-amber-50 focus-visible:outline-amber-600 dark:border-amber-900/50 dark:text-amber-300 dark:hover:bg-amber-950/30`
                                : `${ACTION_BUTTON} border-emerald-200 text-emerald-700 hover:bg-emerald-50 focus-visible:outline-emerald-600 dark:border-emerald-900/50 dark:text-emerald-300 dark:hover:bg-emerald-950/30`
                            }
                          >
                            {togglingResourceId === resource.resourceId ? (
                              <Loader2 size={12} strokeWidth={2} className="animate-spin" aria-hidden="true" />
                            ) : resource.active ? (
                              <Ban size={12} strokeWidth={2} aria-hidden="true" />
                            ) : (
                              <Power size={12} strokeWidth={2} aria-hidden="true" />
                            )}
                            {resource.active ? "ปิดใช้งาน" : "เปิดใช้งาน"}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* รายการจอง{typeLabel} */}
            <div className={`${CARD} flex flex-col gap-3 p-4`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                  <Calendar size={15} strokeWidth={2} aria-hidden="true" />
                  รายการจอง{typeLabel}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {/* ปฏิทิน/รายการ — สถานะการจองแสดงเป็นปฏิทินเป็นค่าเริ่มต้น
                      ตามที่ขอ (เห็นวันและช่วงเวลาที่จองพร้อมสีแยกตามทรัพยากร)
                      คงมุมมองตารางเดิมไว้เป็นทางเลือกสำหรับดูรายละเอียดรวด
                      เดียวทั้งหมด — ไม่ตัดของเดิมออก แค่เพิ่มมุมมองใหม่ */}
                  <div className="inline-flex gap-0.5 rounded-full border border-zinc-200 bg-white p-0.5 dark:border-zinc-700 dark:bg-zinc-900">
                    <button
                      type="button"
                      onClick={() => setViewMode("calendar")}
                      aria-pressed={viewMode === "calendar"}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                        viewMode === "calendar"
                          ? "bg-gradient-to-br from-[var(--brand)] to-[var(--brand-2)] text-[var(--brand-contrast)]"
                          : "text-zinc-500 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
                      }`}
                    >
                      <CalendarDays size={13} strokeWidth={2} aria-hidden="true" />
                      ปฏิทิน
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode("list")}
                      aria-pressed={viewMode === "list"}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                        viewMode === "list"
                          ? "bg-gradient-to-br from-[var(--brand)] to-[var(--brand-2)] text-[var(--brand-contrast)]"
                          : "text-zinc-500 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
                      }`}
                    >
                      <List size={13} strokeWidth={2} aria-hidden="true" />
                      รายการ
                    </button>
                  </div>
                  {/* เฉพาะมุมมอง "รายการ" (ตาราง) เท่านั้น — มุมมอง "ปฏิทิน" ย้าย
                      ปุ่มนี้ไปไว้ในหน้าต่างรายละเอียดวัน (DayDetailModal) แทน
                      แล้ว ตามที่ขอ เพราะปุ่มตรงนี้ถูกหน้าต่างนั้นบังไว้พอดี
                      ตอนกำลังเลือกจัดรถอยู่ ต้องปิดก่อนถึงจะกดได้ */}
                  {canApprove && viewMode === "list" && selectedBookingIds.size > 0 && (
                    <button
                      type="button"
                      onClick={() => setTripOrderModalOpen(true)}
                      className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-br from-sky-600 to-sky-500 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-opacity hover:opacity-90"
                    >
                      <Truck size={14} strokeWidth={2} aria-hidden="true" />
                      ออกใบสั่งงานเดินทาง ({selectedBookingIds.size.toLocaleString("th-TH")})
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setBookingModalOpen(true)}
                    // ห้องประชุมยังต้องมีอย่างน้อย 1 ห้องที่เปิดใช้งานอยู่
                    // จึงจะจองได้ (เลือกทรัพยากรเจาะจงเหมือนเดิม) — รถไม่ต้อง
                    // มีให้เลือกล่วงหน้าอีกต่อไปแล้ว จึงจองได้เสมอไม่ว่าจะมี
                    // รถในระบบหรือไม่ (ดูคอมเมนต์ใน BookingFormModal.tsx)
                    disabled={type === "room" && activeTypeResources.length === 0}
                    className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-br from-[var(--brand)] to-[var(--brand-2)] px-3 py-1.5 text-xs font-medium text-[var(--brand-contrast)] shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    <CalendarPlus size={14} strokeWidth={2} aria-hidden="true" />
                    จอง{typeLabel}ใหม่
                  </button>
                </div>
              </div>

              {typeBookings.length === 0 ? (
                <p className="py-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  ยังไม่มีการจอง{typeLabel}
                </p>
              ) : viewMode === "calendar" ? (
                <BookingCalendar
                  typeLabel={typeLabel}
                  bookings={typeBookings}
                  resourceColorMap={resourceColorMap}
                  session={session}
                  onCancel={handleCancelBooking}
                  cancellingBookingId={cancellingBookingId}
                  showDestination={type === "car"}
                  canApprove={canApprove}
                  onReject={handleReject}
                  rejectingBookingId={rejectingBookingId}
                  selectedBookingIds={selectedBookingIds}
                  onToggleSelect={toggleBookingSelection}
                  tripOrderByBookingId={tripOrderByBookingId}
                  onEditBooking={setEditBookingTarget}
                  onEditTripOrder={setEditTripOrderTarget}
                  onOpenTripOrder={() => setTripOrderModalOpen(true)}
                  onClearSelection={() => setSelectedBookingIds(new Set())}
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-zinc-100 text-left text-xs font-medium text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
                        <th className="px-2 py-2">{typeLabel}</th>
                        <th className="px-2 py-2">ช่วงเวลา</th>
                        <th className="px-2 py-2">วัตถุประสงค์</th>
                        {type === "car" && <th className="px-2 py-2">ปลายทาง</th>}
                        <th className="px-2 py-2">ผู้เข้าร่วม</th>
                        <th className="px-2 py-2">ผู้จอง</th>
                        <th className="px-2 py-2">สถานะ</th>
                        <th className="px-2 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {typeBookings.map((booking) => {
                        const cancelled = isBookingCancelled(booking);
                        const color = resourceColorMap.get(booking.resourceName);
                        const status = bookingStatusLabel(booking);
                        return (
                          <tr
                            key={booking.bookingId}
                            className="border-b border-zinc-50 align-top last:border-0 dark:border-zinc-800/60"
                          >
                            <td className="px-2 py-2.5 font-medium text-zinc-800 dark:text-zinc-100">
                              <span className="inline-flex items-center gap-1.5">
                                {color && (
                                  <span
                                    className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--seg-c)] dark:bg-[var(--seg-c-dark)]"
                                    style={actionColorVars(color)}
                                    aria-hidden="true"
                                  />
                                )}
                                {booking.resourceName}
                              </span>
                            </td>
                            <td className="px-2 py-2.5 whitespace-nowrap text-zinc-600 dark:text-zinc-300">
                              {formatBookingDateTime(booking.startTime)}
                              <br />– {formatBookingDateTime(booking.endTime)}
                            </td>
                            <td className="px-2 py-2.5 text-zinc-600 dark:text-zinc-300">
                              {booking.purpose}
                              {booking.editedByUsername && (
                                <span
                                  className="ml-1 inline-flex items-center gap-0.5 text-xs text-amber-700 dark:text-amber-400"
                                  title={`แก้ไขโดยฝ่ายบริหาร (${booking.editedByUsername})`}
                                >
                                  <Pencil size={11} strokeWidth={2} aria-hidden="true" />
                                </span>
                              )}
                            </td>
                            {type === "car" && (
                              <td className="px-2 py-2.5 text-zinc-600 dark:text-zinc-300">
                                {booking.destination && (
                                  <span className="inline-flex items-center gap-1">
                                    <MapPin size={12} strokeWidth={2} aria-hidden="true" className="shrink-0" />
                                    {booking.destination}
                                  </span>
                                )}
                              </td>
                            )}
                            <td className="px-2 py-2.5 text-zinc-600 dark:text-zinc-300">
                              <span className="inline-flex items-center gap-1">
                                <Users size={12} strokeWidth={2} aria-hidden="true" className="shrink-0" />
                                {booking.participants.toLocaleString("th-TH")}
                              </span>
                            </td>
                            <td className="px-2 py-2.5 text-zinc-600 dark:text-zinc-300">
                              <div>{booking.bookedByDisplayName || booking.bookedByUsername}</div>
                              <div className="mt-0.5 inline-flex items-center gap-1 text-xs text-zinc-400 dark:text-zinc-500">
                                <Phone size={11} strokeWidth={2} aria-hidden="true" className="shrink-0" />
                                {booking.contactPhone}
                              </div>
                            </td>
                            <td className="px-2 py-2.5">
                              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASSES[status.tone]}`}>
                                {status.text}
                              </span>
                            </td>
                            <td className="px-2 py-2.5 text-right">
                              <div className="flex flex-wrap items-center justify-end gap-1.5">
                                {!cancelled && canApprove && booking.approvalStatus === "pending" && (
                                  <>
                                    <label className={`${ACTION_BUTTON} cursor-pointer border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800`}>
                                      <input
                                        type="checkbox"
                                        checked={selectedBookingIds.has(booking.bookingId)}
                                        onChange={() => toggleBookingSelection(booking)}
                                        className="h-3.5 w-3.5 accent-[var(--brand)]"
                                      />
                                      เลือกจัดรถ
                                    </label>
                                    <button
                                      type="button"
                                      onClick={() => handleReject(booking)}
                                      disabled={rejectingBookingId === booking.bookingId}
                                      className={`${ACTION_BUTTON} border-red-200 text-red-700 hover:bg-red-50 focus-visible:outline-red-600 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/30`}
                                    >
                                      {rejectingBookingId === booking.bookingId ? (
                                        <Loader2 size={12} strokeWidth={2} className="animate-spin" aria-hidden="true" />
                                      ) : (
                                        <XIcon size={12} strokeWidth={2} aria-hidden="true" />
                                      )}
                                      ไม่อนุมัติ
                                    </button>
                                  </>
                                )}
                                {!cancelled && tripOrderByBookingId.get(booking.bookingId) && (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 px-2 py-1 text-xs font-medium text-sky-700 dark:border-sky-900/50 dark:text-sky-300">
                                    <Truck size={12} strokeWidth={2} aria-hidden="true" className="shrink-0" />
                                    {/* รถจริงที่ได้รับมอบหมาย + คนขับ — ดูคอมเมนต์เดียวกันใน
                                        BookingCalendar.tsx สำหรับเหตุผลที่ต้องแสดงตรงนี้แทน */}
                                    {tripOrderByBookingId.get(booking.bookingId)!.resourceName} ·{" "}
                                    {tripOrderByBookingId.get(booking.bookingId)!.driverName || "—"}
                                    {canApprove && (
                                      <button
                                        type="button"
                                        onClick={() => setEditTripOrderTarget(tripOrderByBookingId.get(booking.bookingId)!)}
                                        className="rounded-full p-0.5 text-sky-700 transition-colors hover:bg-sky-100 dark:text-sky-300 dark:hover:bg-sky-900/40"
                                        aria-label="แก้ไขใบสั่งงานเดินทาง"
                                      >
                                        <Pencil size={11} strokeWidth={2} aria-hidden="true" />
                                      </button>
                                    )}
                                  </span>
                                )}
                                {!cancelled && canApprove && type === "car" && (
                                  <button
                                    type="button"
                                    onClick={() => setEditBookingTarget(booking)}
                                    className={`${ACTION_BUTTON} border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800`}
                                  >
                                    <Pencil size={12} strokeWidth={2} aria-hidden="true" />
                                    แก้ไขข้อมูล
                                  </button>
                                )}
                                {!cancelled && canCancelBooking(booking, session) && (
                                  <button
                                    type="button"
                                    onClick={() => handleCancelBooking(booking)}
                                    disabled={cancellingBookingId === booking.bookingId}
                                    className={`${ACTION_BUTTON} border-red-200 text-red-700 hover:bg-red-50 focus-visible:outline-red-600 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/30`}
                                  >
                                    {cancellingBookingId === booking.bookingId ? (
                                      <Loader2 size={12} strokeWidth={2} className="animate-spin" aria-hidden="true" />
                                    ) : (
                                      <Ban size={12} strokeWidth={2} aria-hidden="true" />
                                    )}
                                    ยกเลิก
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {resourceModal && (
        <BookingResourceFormModal
          mode={resourceModal.mode}
          type={type}
          resource={resourceModal.resource}
          onClose={() => setResourceModal(null)}
          onSaved={handleResourceSaved}
        />
      )}
      {bookingModalOpen && (
        <BookingFormModal
          resourceType={type}
          resources={activeTypeResources}
          onClose={() => setBookingModalOpen(false)}
          onSaved={handleBookingSaved}
        />
      )}
      {tripOrderModalOpen && (
        <TripOrderModal
          bookings={selectedBookings}
          // คำขอจองรถรออนุมัติอื่นๆ ที่ยังไม่ถูกเลือกไว้แต่แรก — ส่งทั้งหมด
          // ไปให้ TripOrderModal เอง กรองเหลือเฉพาะวันเดียวกัน (ดูคอมเมนต์ที่
          // prop นั้น) ไม่ต้องกรองซ้ำที่นี่
          candidateBookings={typeBookings.filter(
            (b) => b.approvalStatus === "pending" && !isBookingCancelled(b) && !selectedBookingIds.has(b.bookingId)
          )}
          resources={activeTypeResources}
          onClose={() => setTripOrderModalOpen(false)}
          onCreated={handleTripOrderCreated}
        />
      )}
      {editTripOrderTarget && (
        <TripOrderModal
          editing={editTripOrderTarget}
          bookings={typeBookings.filter((b) => b.tripOrderId === editTripOrderTarget.tripOrderId)}
          resources={activeTypeResources}
          onClose={() => setEditTripOrderTarget(null)}
          onUpdated={handleTripOrderUpdated}
        />
      )}
      {editBookingTarget && (
        <ManagementEditBookingModal
          booking={editBookingTarget}
          onClose={() => setEditBookingTarget(null)}
          onSaved={handleManagementEditSaved}
        />
      )}
    </main>
    </AppShell>
  );
}
