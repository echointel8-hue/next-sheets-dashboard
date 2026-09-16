"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Ban,
  Calendar,
  CalendarDays,
  CalendarPlus,
  Car,
  Check,
  DoorOpen,
  ImageOff,
  List,
  Loader2,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Power,
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

export interface BookingDashboardData {
  resources: BookingResource[];
  bookings: Booking[];
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
  const [approvingBookingId, setApprovingBookingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"calendar" | "list">("calendar");
  // เฉพาะการจองรถต้องมีขั้นตอนอนุมัติ — ห้องประชุมไม่มี (ยืนยันทันทีเหมือนเดิม)
  const canApprove = type === "car" && canApproveCarBooking(session);

  const resources = isError(data) ? [] : data.resources;
  const bookings = isError(data) ? [] : data.bookings;

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

  // Color each resource of the current type by when it was *created*
  // (createdAt, append-only) rather than by typeResources' own
  // alphabetical display order — the same "index-based assignment must
  // survive reordering/renaming" lesson as ReportSettings.actionColorOrder
  // in lib/sheets.ts: if colors were assigned by alphabetical position,
  // adding a resource that happens to sort earlier (or renaming one) would
  // silently reshuffle every other resource's color too. Built from every
  // resource of this type, active or not, so a cancelled booking against a
  // since-deactivated resource still shows a stable, decodable color.
  const resourceColorMap: Map<string, ActionColor> = useMemo(() => {
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

  async function handleApprovalDecision(booking: Booking, approvalStatus: "approved" | "rejected") {
    setApprovingBookingId(booking.bookingId);
    setActionError(null);
    try {
      const res = await fetch(`/api/booking/bookings/${booking.bookingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalStatus }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(json.error || "บันทึกผลการอนุมัติไม่สำเร็จ");
        return;
      }
      const updated = json.booking as Booking;
      setData((prev) =>
        isError(prev)
          ? prev
          : { ...prev, bookings: prev.bookings.map((b) => (b.bookingId === updated.bookingId ? updated : b)) }
      );
    } catch {
      setActionError("บันทึกผลการอนุมัติไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setApprovingBookingId(null);
    }
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
                  <button
                    type="button"
                    onClick={() => setBookingModalOpen(true)}
                    disabled={activeTypeResources.length === 0}
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
                  onApprovalDecision={handleApprovalDecision}
                  approvingBookingId={approvingBookingId}
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
                            <td className="px-2 py-2.5 text-zinc-600 dark:text-zinc-300">{booking.purpose}</td>
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
                              <div className="flex flex-wrap justify-end gap-1.5">
                                {!cancelled && canApprove && booking.approvalStatus === "pending" && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => handleApprovalDecision(booking, "approved")}
                                      disabled={approvingBookingId === booking.bookingId}
                                      className={`${ACTION_BUTTON} border-emerald-200 text-emerald-700 hover:bg-emerald-50 focus-visible:outline-emerald-600 dark:border-emerald-900/50 dark:text-emerald-300 dark:hover:bg-emerald-950/30`}
                                    >
                                      {approvingBookingId === booking.bookingId ? (
                                        <Loader2 size={12} strokeWidth={2} className="animate-spin" aria-hidden="true" />
                                      ) : (
                                        <Check size={12} strokeWidth={2} aria-hidden="true" />
                                      )}
                                      อนุมัติ
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleApprovalDecision(booking, "rejected")}
                                      disabled={approvingBookingId === booking.bookingId}
                                      className={`${ACTION_BUTTON} border-red-200 text-red-700 hover:bg-red-50 focus-visible:outline-red-600 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/30`}
                                    >
                                      <XIcon size={12} strokeWidth={2} aria-hidden="true" />
                                      ไม่อนุมัติ
                                    </button>
                                  </>
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
    </main>
    </AppShell>
  );
}
