"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Loader2, Save, Truck, Users, X } from "lucide-react";
import {
  formatBookingDateTime,
  type Booking,
  type BookingResource,
  type TripOrder,
} from "@/lib/booking";

const INPUT_CLASS =
  "h-11 rounded-lg border border-zinc-200 bg-white px-3 text-base text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:disabled:bg-zinc-800/60 dark:disabled:text-zinc-500";

// เวลาเริ่ม/สิ้นสุดแยกวันที่+ชั่วโมง+นาที เหมือน BookingFormModal ทุกประการ —
// คัดลอกชุดตัวช่วยเล็กๆ นี้มาเป็นชุดของตัวเองแทนการ import ข้ามไฟล์ ตาม
// รูปแบบที่โค้ดฐานนี้ใช้อยู่แล้ว (เช่น STATUS_BADGE_CLASSES ที่ซ้ำกันระหว่าง
// BookingCalendar/BookingDashboard)
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => pad2(i));
const MINUTE_OPTIONS = ["00", "30"] as const;
type MinuteOption = (typeof MINUTE_OPTIONS)[number];

function combineDateTime(date: string, hour: string, minute: string): string {
  return date ? `${date}T${hour}:${minute}` : "";
}

/** ช่วงเวลาเริ่มต้นของใบสั่งงาน — ครอบคลุมทุกคำขอที่เลือกไว้พอดี: เริ่มต้น
 * ปัดลงถึงครึ่งชั่วโมงก่อนหน้า (ไม่ตัดเวลาที่เร็วที่สุดออก) และสิ้นสุดปัดขึ้น
 * ถึงครึ่งชั่วโมงถัดไป (ไม่ตัดเวลาที่ช้าที่สุดออก) ฝ่ายบริหารยังปรับเปลี่ยน
 * ได้อิสระทั้งหมด นี่แค่ค่าเริ่มต้นที่สมเหตุสมผล. */
function defaultTripOrderParts(bookings: { startTime: string; endTime: string }[]): {
  startDate: string;
  startHour: string;
  startMinute: MinuteOption;
  endDate: string;
  endHour: string;
  endMinute: MinuteOption;
} {
  const starts = bookings.map((b) => new Date(b.startTime).getTime()).filter((t) => !Number.isNaN(t));
  const ends = bookings.map((b) => new Date(b.endTime).getTime()).filter((t) => !Number.isNaN(t));
  const now = new Date();
  const start = starts.length > 0 ? new Date(Math.min(...starts)) : now;
  const end = ends.length > 0 ? new Date(Math.max(...ends)) : new Date(now.getTime() + 60 * 60 * 1000);

  start.setSeconds(0, 0);
  const startMinutes = start.getMinutes();
  if (startMinutes !== 0 && startMinutes !== 30) {
    start.setMinutes(startMinutes < 30 ? 0 : 30);
  }
  end.setSeconds(0, 0);
  const endMinutes = end.getMinutes();
  if (endMinutes !== 0 && endMinutes !== 30) {
    end.setMinutes(endMinutes < 30 ? 30 : 0);
    if (endMinutes > 30) end.setHours(end.getHours() + 1);
  }

  return {
    startDate: `${start.getFullYear()}-${pad2(start.getMonth() + 1)}-${pad2(start.getDate())}`,
    startHour: pad2(start.getHours()),
    startMinute: start.getMinutes() === 30 ? "30" : "00",
    endDate: `${end.getFullYear()}-${pad2(end.getMonth() + 1)}-${pad2(end.getDate())}`,
    endHour: pad2(end.getHours()),
    endMinute: end.getMinutes() === 30 ? "30" : "00",
  };
}

/**
 * ใบสั่งงาน/ใบเดินทาง — วิธีเดียวที่ฝ่ายบริหาร/superadmin จะ "อนุมัติ" การจอง
 * รถได้ในระบบใหม่นี้ ระบุรถ + คนขับ + เวลารวม แล้วออกใบสั่งงานอ้างอิงคำขอจอง
 * เดิมหลายรายการพร้อมกัน (การเลือกมากกว่า 1 รายการ = ฟีเจอร์ "รวมเที่ยว/
 * คาร์พูล" ในตัว ไม่มีขั้นตอนรวมแยกต่างหาก) — ข้อมูลคำขอจองเดิมของผู้ขอ
 * (วัตถุประสงค์ ปลายทาง ผู้ร่วมเดินทาง ฯลฯ) จะไม่ถูกแก้ไขเลย ตามที่โรงพยาบาล
 * ขอไว้อย่างชัดเจน — ดู createTripOrder ใน lib/sheets.ts
 *
 * ใช้ได้สองโหมดจากคอมโพเนนต์เดียวกัน: สร้างใหม่ (ไม่ส่ง `editing`, เรียก
 * `onCreated` — POST /api/booking/trip-orders) หรือแก้ไขใบสั่งงานที่ออกไป
 * แล้ว (ส่ง `editing`, เรียก `onUpdated` แทน — PATCH
 * /api/booking/trip-orders/[tripOrderId]) — แก้ได้เฉพาะรถ/คนขับ/เวลา/
 * หมายเหตุ ("เท่าที่จำเป็น" ตามที่โรงพยาบาลขอ) รายการคำขอจองที่ครอบคลุมจะ
 * ไม่เปลี่ยนแปลงในโหมดแก้ไข (แสดงไว้ให้ดูอย่างเดียว เหมือนโหมดสร้างใหม่).
 */
export default function TripOrderModal({
  bookings,
  resources,
  editing,
  onClose,
  onCreated,
  onUpdated,
}: {
  /** โหมดสร้างใหม่: คำขอจองรถที่ยังรออนุมัติที่ถูกเลือกไว้ (อย่างน้อย 1
   * รายการ) — ทุกรายการต้องเป็นรถและสถานะ pending อยู่แล้ว. โหมดแก้ไข:
   * รายการคำขอที่ใบสั่งงานนี้ครอบคลุมอยู่แล้ว (แสดงผลอย่างเดียว ไม่เปลี่ยน
   * ได้ตรงนี้) — คัดกรองมาจากผู้เรียกใช้ทั้งสองกรณี. */
  bookings: Booking[];
  /** รถที่เปิดใช้งานอยู่ (ประเภท car) — ในโหมดแก้ไข ถ้ารถที่ถูกมอบหมายไว้เดิม
   * ไม่อยู่ในรายการนี้แล้ว (เช่น ถูกปิดใช้งานไปหลังออกใบสั่งงาน) คอมโพเนนต์นี้
   * จะเติมให้เองเพื่อให้ตัวเลือกเดิมยังแสดงถูกต้อง. */
  resources: BookingResource[];
  /** ใส่ค่านี้เพื่อเปิดในโหมดแก้ไขใบสั่งงานที่มีอยู่แล้ว — ไม่ใส่ = โหมดสร้างใหม่. */
  editing?: TripOrder;
  onClose: () => void;
  /** โหมดสร้างใหม่เท่านั้น */
  onCreated?: (result: { tripOrder: TripOrder; bookings: Booking[] }) => void;
  /** โหมดแก้ไขเท่านั้น */
  onUpdated?: (tripOrder: TripOrder) => void;
}) {
  const effectiveResources = useMemo(() => {
    if (editing && !resources.some((r) => r.resourceId === editing.resourceId)) {
      const placeholder: BookingResource = {
        resourceId: editing.resourceId,
        type: "car",
        name: `${editing.resourceName} (ปิดใช้งานแล้ว)`,
        detail: "",
        active: false,
        createdAt: "",
        createdByUsername: "",
        imageDataUrl: "",
        seatCount: 0,
      };
      return [placeholder, ...resources];
    }
    return resources;
  }, [resources, editing]);

  const [resourceId, setResourceId] = useState(editing?.resourceId ?? resources[0]?.resourceId ?? "");
  const defaultParts = useMemo(
    () =>
      editing
        ? defaultTripOrderParts([{ startTime: editing.startTime, endTime: editing.endTime }])
        : defaultTripOrderParts(bookings),
    [bookings, editing]
  );
  const [startDate, setStartDate] = useState(defaultParts.startDate);
  const [startHour, setStartHour] = useState(defaultParts.startHour);
  const [startMinute, setStartMinute] = useState<MinuteOption>(defaultParts.startMinute);
  const [endDate, setEndDate] = useState(defaultParts.endDate);
  const [endHour, setEndHour] = useState(defaultParts.endHour);
  const [endMinute, setEndMinute] = useState<MinuteOption>(defaultParts.endMinute);
  const startTime = combineDateTime(startDate, startHour, startMinute);
  const endTime = combineDateTime(endDate, endHour, endMinute);
  const [driverName, setDriverName] = useState(editing?.driverName ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstInputRef = useRef<HTMLSelectElement | null>(null);

  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const totalParticipants = bookings.reduce((sum, b) => sum + b.participants, 0);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!resourceId) {
      setError("กรุณาเลือกรถที่จะใช้");
      return;
    }
    if (!driverName.trim()) {
      setError("กรุณาระบุชื่อพนักงานขับรถ");
      return;
    }
    if (!startTime || !endTime) {
      setError("กรุณาระบุวันเวลาเริ่มต้นและสิ้นสุด");
      return;
    }
    if (startTime >= endTime) {
      setError("เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่มต้น");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (editing) {
        const res = await fetch(`/api/booking/trip-orders/${editing.tripOrderId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            resourceId,
            driverName: driverName.trim(),
            startTime,
            endTime,
            notes: notes.trim(),
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(json.error || "บันทึกการแก้ไขไม่สำเร็จ");
          setSaving(false);
          return;
        }
        onUpdated?.(json.tripOrder as TripOrder);
        return;
      }

      const res = await fetch("/api/booking/trip-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resourceId,
          driverName: driverName.trim(),
          startTime,
          endTime,
          notes: notes.trim(),
          bookingIds: bookings.map((b) => b.bookingId),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || "ออกใบสั่งงานไม่สำเร็จ");
        setSaving(false);
        return;
      }
      onCreated?.(json as { tripOrder: TripOrder; bookings: Booking[] });
    } catch {
      setError(editing ? "บันทึกการแก้ไขไม่สำเร็จ กรุณาลองใหม่" : "ออกใบสั่งงานไม่สำเร็จ กรุณาลองใหม่");
      setSaving(false);
    }
  }

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
        aria-labelledby="trip-order-modal-title"
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-zinc-900"
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <h2
            id="trip-order-modal-title"
            className="flex items-center gap-2 text-base font-semibold text-zinc-800 dark:text-zinc-100"
          >
            <Truck size={18} strokeWidth={2} className="shrink-0 text-[var(--brand-strong)]" aria-hidden="true" />
            {editing ? "แก้ไขใบสั่งงานเดินทาง" : "ออกใบสั่งงานเดินทาง"}
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
        <div className="overflow-y-auto px-5 py-4">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {error && (
              <p role="alert" className="flex items-start gap-2 text-sm text-red-700 dark:text-red-300">
                <AlertTriangle size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
                {error}
              </p>
            )}

            {/* รายการคำขอจองที่ถูกเลือกไว้ — แสดงเป็นการยืนยันเท่านั้น
                ข้อมูลของแต่ละคำขอจะไม่ถูกแก้ไข ใบสั่งงานนี้เป็นระเบียนแยก
                ต่างหากที่อ้างอิงคำขอเหล่านี้เท่านั้น ตามที่โรงพยาบาลขอ */}
            <div className="flex flex-col gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/60">
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                {editing
                  ? `คำขอจองที่ใบสั่งงานนี้ครอบคลุม (${bookings.length.toLocaleString("th-TH")} รายการ) — แก้ไขตรงนี้ไม่ได้`
                  : `คำขอจองที่จะรวมในใบสั่งงานนี้ (${bookings.length.toLocaleString("th-TH")} รายการ)`}
              </p>
              <ul className="flex flex-col gap-1.5">
                {bookings.map((b) => (
                  <li key={b.bookingId} className="text-xs leading-5 text-zinc-600 dark:text-zinc-300">
                    <span className="font-medium text-zinc-800 dark:text-zinc-100">
                      {formatBookingDateTime(b.startTime)} – {formatBookingDateTime(b.endTime)}
                    </span>{" "}
                    {b.department || b.bookedByDisplayName || b.bookedByUsername} — {b.purpose}
                    {b.destination && <> (ปลายทาง: {b.destination})</>}
                  </li>
                ))}
              </ul>
              <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                <Users size={12} strokeWidth={2} aria-hidden="true" className="shrink-0" />
                รวมผู้โดยสารตามคำขอ {totalParticipants.toLocaleString("th-TH")} คน
              </p>
            </div>

            <label className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-300">
              รถที่ใช้
              <select
                ref={firstInputRef}
                value={resourceId}
                onChange={(e) => setResourceId(e.target.value)}
                disabled={saving || effectiveResources.length === 0}
                className={INPUT_CLASS}
              >
                {effectiveResources.length === 0 && <option value="">ไม่มีรถที่เปิดใช้งาน</option>}
                {effectiveResources.map((r) => (
                  <option key={r.resourceId} value={r.resourceId}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-300">
              ชื่อพนักงานขับรถ
              <input
                type="text"
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
                disabled={saving}
                className={INPUT_CLASS}
              />
            </label>

            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-300">
                วันเวลาเริ่มต้น (รวม)
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    disabled={saving}
                    className={`${INPUT_CLASS} min-w-0 flex-1`}
                  />
                  <select
                    value={startHour}
                    onChange={(e) => setStartHour(e.target.value)}
                    disabled={saving}
                    aria-label="ชั่วโมงเริ่มต้น"
                    className={`${INPUT_CLASS} w-[4.5rem] shrink-0`}
                  >
                    {HOUR_OPTIONS.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                  <span className="flex items-center text-zinc-400" aria-hidden="true">
                    :
                  </span>
                  <select
                    value={startMinute}
                    onChange={(e) => setStartMinute(e.target.value as MinuteOption)}
                    disabled={saving}
                    aria-label="นาทีเริ่มต้น"
                    className={`${INPUT_CLASS} w-[4.5rem] shrink-0`}
                  >
                    {MINUTE_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-300">
                วันเวลาสิ้นสุด (รวม)
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    disabled={saving}
                    className={`${INPUT_CLASS} min-w-0 flex-1`}
                  />
                  <select
                    value={endHour}
                    onChange={(e) => setEndHour(e.target.value)}
                    disabled={saving}
                    aria-label="ชั่วโมงสิ้นสุด"
                    className={`${INPUT_CLASS} w-[4.5rem] shrink-0`}
                  >
                    {HOUR_OPTIONS.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                  <span className="flex items-center text-zinc-400" aria-hidden="true">
                    :
                  </span>
                  <select
                    value={endMinute}
                    onChange={(e) => setEndMinute(e.target.value as MinuteOption)}
                    disabled={saving}
                    aria-label="นาทีสิ้นสุด"
                    className={`${INPUT_CLASS} w-[4.5rem] shrink-0`}
                  >
                    {MINUTE_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <label className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-300">
              หมายเหตุ (ไม่บังคับ)
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={saving}
                className={INPUT_CLASS}
              />
            </label>

            <div className="mt-1 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="rounded-full border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={saving || effectiveResources.length === 0}
                className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-br from-[var(--brand)] to-[var(--brand-2)] px-4 py-2 text-sm font-medium text-[var(--brand-contrast)] shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {saving ? (
                  <Loader2 size={16} strokeWidth={2} className="animate-spin" aria-hidden="true" />
                ) : (
                  <Save size={16} strokeWidth={2} aria-hidden="true" />
                )}
                {editing ? "บันทึกการแก้ไข" : "ออกใบสั่งงาน"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body
  );
}
