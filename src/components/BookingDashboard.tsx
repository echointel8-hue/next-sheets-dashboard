"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Ban,
  Calendar,
  CalendarDays,
  CalendarPlus,
  Car,
  CheckCircle2,
  DoorOpen,
  List,
  Loader2,
  MapPin,
  Pencil,
  Phone,
  Settings,
  Truck,
  Users,
  X as XIcon,
} from "lucide-react";
import type { Role } from "@/lib/auth";
import { buildActionColorMap, actionColorVars, type ActionColor } from "@/lib/actionColors";
import {
  bookingColorMapKey,
  bookingStatusLabel,
  canApproveCarBooking,
  canCancelBooking,
  canEditBookingByManagement,
  carBookingDisplayName,
  formatBookingDateTime,
  isBookingCancelled,
  TRIP_ORDER_CHANGED_EVENT,
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
import BookingResourceListModal from "@/components/BookingResourceListModal";
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
// จุดสีในตารางรายการ (คอลัมน์แรก) สำหรับรถ — บอกสถานะแทนตัวตนรถ/เที่ยว
// เหมือนกับในปฏิทิน ดูคอมเมนต์เต็มที่ CAR_STATUS_DOT_CLASSES ใน
// BookingCalendar.tsx (คัดลอกมาตามธรรมเนียมเดิมของไฟล์นี้)
const CAR_STATUS_DOT_CLASSES: Partial<Record<ReturnType<typeof bookingStatusLabel>["tone"], string>> = {
  pending: "bg-amber-500 dark:bg-amber-400",
  approved: "bg-emerald-600 dark:bg-emerald-500",
  rejected: "bg-red-600 dark:bg-red-500",
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
  // popup รายการรถ/ห้องประชุม (BookingResourceListModal) — เดิมแสดงค้างอยู่
  // บนหน้าตลอดเวลาให้ทุกคนเห็น ย้ายมาซ่อนไว้หลังปุ่ม "จัดการข้อมูล..." ที่
  // เห็นได้เฉพาะ canManageResources เท่านั้นแทน ตามที่ขอ
  const [resourceListModalOpen, setResourceListModalOpen] = useState(false);
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [togglingResourceId, setTogglingResourceId] = useState<string | null>(null);
  const [cancellingBookingId, setCancellingBookingId] = useState<string | null>(null);
  const [rejectingBookingId, setRejectingBookingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // ข้อความยืนยันสำเร็จหลังออกใบสั่งงานเดินทาง — เดิมไม่มีเลย ปิดหน้าต่าง
  // TripOrderModal เงียบๆ อย่างเดียว ผู้ใช้จึงไม่แน่ใจว่าสั่งงานสำเร็จหรือไม่
  // ตามที่รายงาน ("ไม่แสดงข้อความหลังจากการสั่งงาน")
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
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
  // สิทธิ์ "แก้ไขข้อมูลการจอง" แยกออกมาจาก canApprove แล้ว (permission key
  // "editBookingData" — ดู canEditBookingByManagement ใน lib/booking.ts) ตาม
  // ที่ขอเพิ่มภายหลัง เพื่อให้เปิด/ปิดสิทธิ์นี้แยกจากสิทธิ์อนุมัติ/ไม่อนุมัติ/
  // ออกใบสั่งงานได้ต่อบัญชี — ปุ่ม "แก้ไขข้อมูล" (ManagementEditBookingModal)
  // ใช้ตัวนี้แทน canApprove โดยเฉพาะ ส่วนปุ่มอื่นๆ ทั้งหมด (เลือกจัดรถ/
  // ไม่อนุมัติ/ออกใบสั่งงาน/แก้ไขใบสั่งงาน) ยังใช้ canApprove เหมือนเดิม
  const canEditBooking = type === "car" && canEditBookingByManagement(session);

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

  /** ใบสั่งงานที่ยัง "มีผล" จริง — ตัดใบที่ทุกคำขอที่ครอบคลุมถูกยกเลิกไปหมด
   * แล้วออก ไม่งั้นรถคันนั้นจะค้างสถานะ "ไม่ว่าง" ตลอดไปในหน้าต่างสั่งงาน
   * เดินทาง (TripOrderModal's conflictingResourceIds) ทั้งที่ไม่มีใครใช้จริง
   * แล้ว — ใช้ `bookings` (ทั้งหมด ไม่ใช่ typeBookings) เพราะ TripOrder อ้างอิง
   * เฉพาะคำขอจองรถอยู่แล้วโดยธรรมชาติ (ห้องประชุมไม่มีใบสั่งงาน) หา booking
   * ไม่เจอ (ไม่ควรเกิด) ให้ถือว่ายังมีผลอยู่ไว้ก่อน ปลอดภัยกว่าการปล่อยให้
   * เลือกซ้ำโดยไม่ตั้งใจ */
  const activeTripOrders = useMemo(
    () =>
      tripOrders.filter((t) =>
        t.bookingIds.some((id) => {
          const b = bookings.find((bk) => bk.bookingId === id);
          return b ? !isBookingCancelled(b) : true;
        })
      ),
    // `tripOrders`/`bookings` are freshly re-derived from `data` on every
    // render (not stable references, same as typeResources/typeBookings
    // above) — depending on `data` itself (stable between renders) is the
    // correct/equivalent dependency here too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data]
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
  // Car no longer uses this at all — per the hospital's later, explicit
  // request ("ไม่ต้องมีสีกำกับรถแล้วครับ"), a car booking's color now
  // represents its *status* (pending/approved/rejected/cancelled) instead of
  // which car/trip it's against — see CAR_STATUS_DOT_CLASSES in
  // BookingCalendar.tsx (and its mirror below) which derive that directly
  // from bookingStatusLabel(booking).tone, no map lookup needed. Returns an
  // empty map for car so every resourceColorMap.get(...) call site simply
  // misses (harmless — those sites already branch on type/resourceType
  // before ever reading it for a car booking). Room bookings are unaffected
  // — still keyed by resource name, ordered by BookingResource.createdAt,
  // exactly as before.
  const resourceColorMap: Map<string, ActionColor> = useMemo(() => {
    if (type === "car") {
      return new Map();
    }
    const byCreatedAt = resources
      .filter((r) => r.type === type)
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((r) => r.name);
    return buildActionColorMap(byCreatedAt);
    // `resources` is freshly re-derived from `data` every render (see the
    // comment above typeResources); `data`/`type` are the real, stable
    // dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, type]);

  /** ดึงข้อมูลรถ/ห้อง + การจอง + ใบสั่งงานเดินทางทั้งหมดใหม่จากเซิร์ฟเวอร์ ผ่าน
   * client API เดียวกับที่ NotificationBell ใช้อยู่แล้ว (ไม่ใช่ฟังก์ชัน
   * server-only ที่ใช้ตอนโหลดหน้าแรกใน page.tsx) — best-effort ล้วนๆ ถ้าดึง
   * ไม่สำเร็จก็แค่คงข้อมูลเดิมไว้ก่อน ไม่ throw ให้หน้าใช้งานไม่ได้ ดูคอมเมนต์
   * ที่ useEffect ด้านล่างว่าใช้ทำอะไร */
  const refreshData = useCallback(async () => {
    try {
      const [resourcesRes, bookingsRes, tripOrdersRes] = await Promise.all([
        fetch("/api/booking/resources", { cache: "no-store" }),
        fetch("/api/booking/bookings", { cache: "no-store" }),
        fetch("/api/booking/trip-orders", { cache: "no-store" }),
      ]);
      if (!resourcesRes.ok || !bookingsRes.ok) return;
      const resourcesJson = await resourcesRes.json().catch(() => ({}));
      const bookingsJson = await bookingsRes.json().catch(() => ({}));
      const tripOrdersJson = tripOrdersRes.ok ? await tripOrdersRes.json().catch(() => ({})) : {};
      if (!Array.isArray(resourcesJson.resources) || !Array.isArray(bookingsJson.bookings)) return;
      setData({
        resources: resourcesJson.resources,
        bookings: bookingsJson.bookings,
        tripOrders: Array.isArray(tripOrdersJson.tripOrders) ? tripOrdersJson.tripOrders : [],
      });
    } catch {
      // best-effort — เน็ตสะดุดชั่วคราวแค่ไม่อัปเดตรอบนี้ ปรัชญาเดียวกับ
      // NotificationBell's poll()
    }
  }, []);

  // ฟัง TRIP_ORDER_CHANGED_EVENT (ดูคอมเมนต์ที่ประกาศไว้ใน lib/booking.ts) —
  // แก้บั๊ก "อนุมัติแล้วปฏิทินไม่อัปเดตทันที ต้องรีเฟรชเอง" กรณีที่การอนุมัติ
  // เกิดขึ้นผ่านป็อปอัปกระดิ่งแจ้งเตือน (NotificationBell.tsx) ซึ่งมี state
  // ของตัวเองแยกต่างหาก ไม่ได้แก้ `data` ของหน้านี้โดยตรง — เฉพาะรถเท่านั้น
  // (type === "car") เพราะ TripOrder มีความหมายกับการจองรถเท่านั้น ห้อง
  // ประชุมไม่มีใบสั่งงานเดินทางให้ต้องรีเฟรชตามอยู่แล้ว ส่วนการอนุมัติที่เกิด
  // จากหน้านี้เอง (handleTripOrderCreated/handleTripOrderUpdated ด้านล่าง)
  // ยังคงอัปเดต state ทันทีแบบเดิมโดยไม่ต้องรอ event นี้ — เร็วกว่า ไม่ต้อง
  // รอ round-trip ไปเซิร์ฟเวอร์อีกรอบ
  useEffect(() => {
    if (type !== "car") return;
    window.addEventListener(TRIP_ORDER_CHANGED_EVENT, refreshData);
    return () => window.removeEventListener(TRIP_ORDER_CHANGED_EVENT, refreshData);
  }, [type, refreshData]);

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
    setSuccessMessage(
      `อนุมัติสำเร็จ (${tripOrder.resourceName} · คนขับ: ${tripOrder.driverName || "—"}) — รายการจองที่เกี่ยวข้อง ${updatedBookings.length.toLocaleString("th-TH")} รายการปรับสถานะเป็น "อนุญาต" ในปฏิทินแล้ว`
    );
  }

  /** ผลจากการแก้ไขใบสั่งงานที่ออกไปแล้ว — แทนที่ TripOrder เดิมใน state ด้วย
   * ตัวที่แก้ไขแล้ว (ไม่ใช่ append ใหม่เหมือน handleTripOrderCreated) ปกติ
   * ไม่ต้องแตะ bookings เลย เพราะการแก้ไขใบสั่งงานไม่เปลี่ยนแถวการจองที่
   * ครอบคลุมอยู่เดิม (ดู updateTripOrder ใน lib/sheets.ts) — ยกเว้นตอนนี้มี
   * addedBookings ด้วยแล้ว (ตามที่ขอเพิ่มภายหลัง — เผื่อกรณีอนุมัติไปแล้วแต่มี
   * กลุ่มอื่นอยากไปด้วย) ซึ่งต้อง merge เข้า data.bookings เหมือนกับที่
   * handleTripOrderCreated ทำกับคำขอที่เพิ่งอนุมัติใหม่ทุกประการ (แค่ replace
   * ตัวเดิมด้วยตัวใหม่ที่ approvalStatus/tripOrderId เปลี่ยนแล้ว ไม่ได้
   * เปลี่ยนฟิลด์อื่นของคำขอเลย). */
  function handleTripOrderUpdated({ tripOrder, addedBookings }: { tripOrder: TripOrder; addedBookings: Booking[] }) {
    setData((prev) => {
      if (isError(prev)) return prev;
      const addedById = new Map(addedBookings.map((b) => [b.bookingId, b]));
      return {
        ...prev,
        tripOrders: prev.tripOrders.map((t) => (t.tripOrderId === tripOrder.tripOrderId ? tripOrder : t)),
        bookings: addedById.size > 0 ? prev.bookings.map((b) => addedById.get(b.bookingId) ?? b) : prev.bookings,
      };
    });
    setEditTripOrderTarget(null);
    if (addedBookings.length > 0) {
      setSuccessMessage(
        `บันทึกการแก้ไขสำเร็จ — เพิ่มคำขอใหม่เข้าใบสั่งงานนี้ ${addedBookings.length.toLocaleString("th-TH")} รายการ`
      );
    }
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

        {successMessage && (
          <div
            role="status"
            className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900 shadow-sm dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200"
          >
            <CheckCircle2 size={20} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
            <p className="flex-1 text-sm leading-6">{successMessage}</p>
            <button
              type="button"
              onClick={() => setSuccessMessage(null)}
              className="text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-300"
            >
              ปิด
            </button>
          </div>
        )}

        {!isError(data) && (
          <>
            {/* รายการ{typeLabel} — เดิมแสดงค้างไว้ตลอดให้ทุกคนเห็น ตอนนี้ซ่อน
                ไว้หลังปุ่มนี้แทน เห็นได้เฉพาะผู้มีสิทธิจัดการทรัพยากร
                (canManageResources) เท่านั้น ตามที่ขอ — เนื้อหาเดิมทั้งหมด
                ย้ายไปอยู่ใน BookingResourceListModal ซึ่งเปิดจากปุ่มนี้ */}
            {canManageResources && (
              <div className={`${CARD} flex flex-wrap items-center justify-between gap-2 p-4`}>
                <div className="flex items-center gap-1.5 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                  <TypeIcon size={15} strokeWidth={2} aria-hidden="true" />
                  ข้อมูล{typeLabel}ในระบบ
                </div>
                <button
                  type="button"
                  onClick={() => setResourceListModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  <Settings size={14} strokeWidth={2} aria-hidden="true" />
                  จัดการข้อมูล{typeLabel}
                </button>
              </div>
            )}

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
                      สั่งงานเดินทาง ({selectedBookingIds.size.toLocaleString("th-TH")})
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
                  // Legend รายชื่อทรัพยากรมีความหมายเฉพาะห้องประชุม — รถตอนนี้
                  // คีย์สีด้วย tripOrderId (ดูคอมเมนต์ที่ resourceColorMap
                  // ด้านบน) ซึ่งเป็น ID ไม่มีความหมายให้คนอ่าน โชว์เป็น legend
                  // ไม่ได้ ต้องซ่อนไว้สำหรับรถโดยเฉพาะ
                  showResourceLegend={type === "room"}
                  session={session}
                  onCancel={handleCancelBooking}
                  cancellingBookingId={cancellingBookingId}
                  showDestination={type === "car"}
                  canApprove={canApprove}
                  canEditBooking={canEditBooking}
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
                        const status = bookingStatusLabel(booking);
                        // รถ: จุดสีบอกสถานะ (เหมือนในปฏิทิน) แทนตัวตนรถ/เที่ยว
                        // เดิม — ห้องประชุมยังคงใช้สีระบุตัวตนทรัพยากรเดิม ดู
                        // คอมเมนต์เต็มที่ CAR_STATUS_DOT_CLASSES/
                        // resourceColorMap ด้านบน
                        const color = type === "car" ? undefined : resourceColorMap.get(bookingColorMapKey(booking));
                        const carDotClass = type === "car" && !cancelled ? CAR_STATUS_DOT_CLASSES[status.tone] : undefined;
                        // รถที่จัดสรรจริง (จากใบสั่งงาน) แทนข้อความ "รอ
                        // บริหารจัดสรร" เมื่อมีการออกใบสั่งงานแล้ว — ดู
                        // carBookingDisplayName ใน lib/booking.ts
                        const displayResourceName =
                          type === "car"
                            ? carBookingDisplayName(booking, tripOrderByBookingId.get(booking.bookingId))
                            : booking.resourceName;
                        return (
                          <tr
                            key={booking.bookingId}
                            className="border-b border-zinc-50 align-top last:border-0 dark:border-zinc-800/60"
                          >
                            <td className="px-2 py-2.5 font-medium text-zinc-800 dark:text-zinc-100">
                              <span className="inline-flex items-center gap-1.5">
                                {type === "car"
                                  ? carDotClass && (
                                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${carDotClass}`} aria-hidden="true" />
                                    )
                                  : color && (
                                      <span
                                        className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--seg-c)] dark:bg-[var(--seg-c-dark)]"
                                        style={actionColorVars(color)}
                                        aria-hidden="true"
                                      />
                                    )}
                                {displayResourceName}
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
                                    {/* ตัดชื่อรถออก — ตอนนี้แสดงอยู่แล้วที่ช่อง
                                        {typeLabel} ด้านซ้าย (displayResourceName
                                        ด้านบน) เหลือแค่คนขับตรงนี้ กันข้อมูลซ้ำซ้อน
                                        ตามที่ขอ */}
                                    คนขับ: {tripOrderByBookingId.get(booking.bookingId)!.driverName || "—"}
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
                                {!cancelled && canEditBooking && (
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

      {resourceListModalOpen && (
        <BookingResourceListModal
          typeLabel={typeLabel}
          type={type}
          resources={typeResources}
          togglingResourceId={togglingResourceId}
          onAdd={() => setResourceModal({ mode: "add" })}
          onEdit={(resource) => setResourceModal({ mode: "edit", resource })}
          onToggleActive={toggleResourceActive}
          onClose={() => setResourceListModalOpen(false)}
        />
      )}
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
          existingTripOrders={activeTripOrders}
          onClose={() => setTripOrderModalOpen(false)}
          onCreated={handleTripOrderCreated}
        />
      )}
      {editTripOrderTarget && (
        <TripOrderModal
          editing={editTripOrderTarget}
          bookings={typeBookings.filter((b) => b.tripOrderId === editTripOrderTarget.tripOrderId)}
          // คำขอจองรถรออนุมัติอื่นๆ ในวันเดียวกัน — ให้เพิ่มเข้าใบสั่งงานที่
          // อนุมัติไปแล้วนี้ได้เอง ตามที่ขอเพิ่มภายหลัง ("เผื่อในกรณีอนุมัติไป
          // แล้ว แต่มีกลุ่มที่ต้องการเดินทางไปด้วยจะได้สามารถแก้ไขและเพิ่ม
          // รายการใหม่เข้าไปได้") เหมือนกับที่ส่งให้โหมดสร้างใหม่ด้านบนทุก
          // ประการ (ไม่ต้องกันรายการที่เลือกไว้ใน selectedBookingIds ออก
          // เพราะโหมดแก้ไขนี้ไม่ได้ใช้ selectedBookingIds เลย)
          candidateBookings={typeBookings.filter((b) => b.approvalStatus === "pending" && !isBookingCancelled(b))}
          resources={activeTypeResources}
          existingTripOrders={activeTripOrders}
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
