"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Ban,
  Calendar,
  CalendarPlus,
  Car,
  DoorOpen,
  Loader2,
  LogOut,
  MapPin,
  Package,
  Pencil,
  Phone,
  Plus,
  Power,
  Users,
  Wrench,
} from "lucide-react";
import type { Role } from "@/lib/auth";
import { canCancelBooking, type Booking, type BookingResource, type BookingResourceType } from "@/lib/booking";
import BookingResourceFormModal from "@/components/BookingResourceFormModal";
import BookingFormModal from "@/components/BookingFormModal";

export interface BookingDashboardData {
  resources: BookingResource[];
  bookings: Booking[];
}
export type BookingLoadResult = BookingDashboardData | { error: string };

function isError(data: BookingLoadResult): data is { error: string } {
  return "error" in data;
}

const CARD =
  "rounded-2xl border border-emerald-900/10 bg-white shadow-[0_1px_2px_rgba(4,120,87,0.04),0_4px_16px_-4px_rgba(4,120,87,0.14)] dark:border-emerald-400/10 dark:bg-zinc-900 dark:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_4px_16px_-4px_rgba(0,0,0,0.45)]";
const ACTION_BUTTON =
  "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60";

/** "2026-08-25T14:30" (this app's storage format for
 * Booking.startTime/endTime — the raw <input type="datetime-local"> value,
 * local wall-clock with no timezone conversion, see lib/booking.ts) ->
 * "25/08/2026 14:30". Parsed by string slicing, not `new Date(...)`, so the
 * display never shifts by the viewer's or server's timezone — same
 * rationale as ManageDashboard's own dateOnly() helper. */
function formatDateTime(raw: string): string {
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return raw;
  const [, y, mo, d, h, mi] = m;
  return `${d}/${mo}/${y} ${h}:${mi}`;
}

/**
 * Top-level page for the vehicle / meeting-room booking feature. Every
 * logged-in account (any role) can reach this page, add/edit/deactivate
 * resources, and make bookings — see each API route's own comments. Car
 * and room bookings are kept as two clearly separate sections (a pill
 * switcher, not a merged generic-resource picker) per the hospital's
 * explicit request.
 */
export default function BookingDashboard({
  session,
  initial,
}: {
  session: { username: string; role: Role; department: string; isBootstrap: boolean };
  initial: BookingLoadResult;
}) {
  const router = useRouter();
  const [data, setData] = useState<BookingLoadResult>(initial);
  const [activeType, setActiveType] = useState<BookingResourceType>("car");
  const [resourceModal, setResourceModal] = useState<{ mode: "add" | "edit"; resource?: BookingResource } | null>(
    null
  );
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [togglingResourceId, setTogglingResourceId] = useState<string | null>(null);
  const [cancellingBookingId, setCancellingBookingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  const resources = isError(data) ? [] : data.resources;
  const bookings = isError(data) ? [] : data.bookings;

  // `resources`/`bookings` above are freshly re-derived from `data` on
  // every render (not stable references), so depending on `data` itself —
  // which *is* stable between renders — is the correct/equivalent
  // dependency and avoids the "changes every render" lint warning without
  // introducing a redundant extra useMemo layer just to memoize them too.
  const typeResources = useMemo(
    () => resources.filter((r) => r.type === activeType).slice().sort((a, b) => a.name.localeCompare(b.name, "th")),
    [data, activeType] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const activeTypeResources = useMemo(() => typeResources.filter((r) => r.active), [typeResources]);
  const typeBookings = useMemo(
    () =>
      bookings
        .filter((b) => b.resourceType === activeType)
        .slice()
        .sort((a, b) => (a.startTime < b.startTime ? 1 : -1)),
    [data, activeType] // eslint-disable-line react-hooks/exhaustive-deps
  );

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
      `ยืนยันยกเลิกการจอง "${booking.resourceName}"\nช่วง ${formatDateTime(booking.startTime)} - ${formatDateTime(booking.endTime)} ใช่หรือไม่?`
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

  const typeLabel = activeType === "car" ? "รถ" : "ห้องประชุม";

  return (
    <main className="flex w-full flex-1 justify-center bg-[var(--page-bg)] px-4 py-8 sm:px-6 lg:px-10">
      <div className="flex w-full max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--brand)] to-[var(--brand-2)] text-[var(--brand-contrast)] shadow-sm"
              aria-hidden="true"
            >
              <Calendar size={20} strokeWidth={2} />
            </span>
            <div>
              <h1 className="text-xl font-bold text-zinc-950 dark:text-zinc-50 sm:text-2xl">
                ระบบจองรถ / ห้องประชุม
              </h1>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                {session.username} · {session.role}
                {session.department ? ` · ${session.department}` : ""}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {session.role === "it" ? (
              <Link
                href="/manage/it"
                className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <Wrench size={16} strokeWidth={2} aria-hidden="true" />
                ระบบงาน IT
              </Link>
            ) : (
              <Link
                href="/manage"
                className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <Package size={16} strokeWidth={2} aria-hidden="true" />
                จัดการครุภัณฑ์
              </Link>
            )}
            <button
              type="button"
              onClick={logout}
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-700 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-red-900/50 dark:hover:bg-red-950/30 dark:hover:text-red-300"
            >
              <LogOut size={16} strokeWidth={2} aria-hidden="true" />
              ออกจากระบบ
            </button>
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
            {/* แยกเมนูการใช้งานระหว่างการจองรถ และจองห้องประชุม — a pill
                switcher, not a merged generic-resource picker, per the
                hospital's explicit request. */}
            <div className="inline-flex w-fit gap-1 rounded-full border border-zinc-200 bg-white p-1 dark:border-zinc-700 dark:bg-zinc-900">
              <button
                type="button"
                onClick={() => setActiveType("car")}
                className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  activeType === "car"
                    ? "bg-gradient-to-br from-[var(--brand)] to-[var(--brand-2)] text-[var(--brand-contrast)] shadow-sm"
                    : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                <Car size={16} strokeWidth={2} aria-hidden="true" />
                จองรถ
              </button>
              <button
                type="button"
                onClick={() => setActiveType("room")}
                className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  activeType === "room"
                    ? "bg-gradient-to-br from-[var(--brand)] to-[var(--brand-2)] text-[var(--brand-contrast)] shadow-sm"
                    : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                <DoorOpen size={16} strokeWidth={2} aria-hidden="true" />
                จองห้องประชุม
              </button>
            </div>

            {/* รายการ{typeLabel} */}
            <div className={`${CARD} flex flex-col gap-3 p-4`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                  {activeType === "car" ? (
                    <Car size={15} strokeWidth={2} aria-hidden="true" />
                  ) : (
                    <DoorOpen size={15} strokeWidth={2} aria-hidden="true" />
                  )}
                  รายการ{typeLabel}
                </div>
                <button
                  type="button"
                  onClick={() => setResourceModal({ mode: "add" })}
                  className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-br from-[var(--brand)] to-[var(--brand-2)] px-3 py-1.5 text-xs font-medium text-[var(--brand-contrast)] shadow-sm transition-opacity hover:opacity-90"
                >
                  <Plus size={14} strokeWidth={2} aria-hidden="true" />
                  เพิ่ม{typeLabel}ใหม่
                </button>
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
                        <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">{resource.detail}</p>
                      )}
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

              {typeBookings.length === 0 ? (
                <p className="py-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  ยังไม่มีการจอง{typeLabel}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-zinc-100 text-left text-xs font-medium text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
                        <th className="px-2 py-2">{typeLabel}</th>
                        <th className="px-2 py-2">ช่วงเวลา</th>
                        <th className="px-2 py-2">วัตถุประสงค์</th>
                        {activeType === "car" && <th className="px-2 py-2">ปลายทาง</th>}
                        <th className="px-2 py-2">ผู้เข้าร่วม</th>
                        <th className="px-2 py-2">ผู้จอง</th>
                        <th className="px-2 py-2">สถานะ</th>
                        <th className="px-2 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {typeBookings.map((booking) => {
                        const cancelled = booking.cancelledAt.trim() !== "";
                        return (
                          <tr
                            key={booking.bookingId}
                            className="border-b border-zinc-50 align-top last:border-0 dark:border-zinc-800/60"
                          >
                            <td className="px-2 py-2.5 font-medium text-zinc-800 dark:text-zinc-100">
                              {booking.resourceName}
                            </td>
                            <td className="px-2 py-2.5 whitespace-nowrap text-zinc-600 dark:text-zinc-300">
                              {formatDateTime(booking.startTime)}
                              <br />– {formatDateTime(booking.endTime)}
                            </td>
                            <td className="px-2 py-2.5 text-zinc-600 dark:text-zinc-300">{booking.purpose}</td>
                            {activeType === "car" && (
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
                              {cancelled ? (
                                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                                  ยกเลิกแล้ว
                                </span>
                              ) : (
                                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                                  ยืนยันแล้ว
                                </span>
                              )}
                            </td>
                            <td className="px-2 py-2.5 text-right">
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
          type={activeType}
          resource={resourceModal.resource}
          onClose={() => setResourceModal(null)}
          onSaved={handleResourceSaved}
        />
      )}
      {bookingModalOpen && (
        <BookingFormModal
          resourceType={activeType}
          resources={activeTypeResources}
          onClose={() => setBookingModalOpen(false)}
          onSaved={handleBookingSaved}
        />
      )}
    </main>
  );
}
