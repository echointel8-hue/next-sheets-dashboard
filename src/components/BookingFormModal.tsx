"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ImageOff, Info, Loader2, Save, X } from "lucide-react";
import type { Booking, BookingResource, BookingResourceType } from "@/lib/booking";

const INPUT_CLASS =
  "h-11 rounded-lg border border-zinc-200 bg-white px-3 text-base text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:disabled:bg-zinc-800/60 dark:disabled:text-zinc-500";

// วันเวลาเริ่มต้น/สิ้นสุด แยกเป็น 3 ช่องอิสระ (วันที่ + ชั่วโมง + นาที)
// แทน input type="datetime-local" ตัวเดียว เพราะตัวเลือกนาทีของ picker
// เนทีฟยังเลื่อนดูได้ทุกนาที (00-59) ต่อให้ตั้ง step ไว้แล้วก็ตาม — step
// ควบคุมแค่ความถูกต้องตอน submit ไม่ได้จำกัดรายการที่แสดงใน picker เอง.
// ช่องนาทีจึงต้องเป็น <select> ที่มีแค่ 2 ตัวเลือก (00/30) ตรงๆ ตามที่ขอ
// ส่วนชั่วโมงยังเป็น <select> 24 ตัวเลือกให้เลือกได้อิสระเหมือนเดิม.
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => pad2(i));
const MINUTE_OPTIONS = ["00", "30"] as const;
type MinuteOption = (typeof MINUTE_OPTIONS)[number];

function dateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** ค่าเริ่มต้นของฟอร์มจองใหม่ — วันเวลาปัจจุบัน ปัดนาทีขึ้นเป็นครึ่งชั่วโมง
 * ถัดไป (ไม่ปัดย้อนไปเป็นอดีต) และสิ้นสุดห่างจากเริ่มต้น 1 ชั่วโมง —
 * ผู้จองยังปรับเปลี่ยนได้ตามต้องการทั้งหมด นี่แค่ลดการต้องเลือกวันที่/เวลา
 * จากศูนย์ทุกครั้ง ตามที่ขอ. */
function defaultBookingParts(): {
  startDate: string;
  startHour: string;
  startMinute: MinuteOption;
  endDate: string;
  endHour: string;
  endMinute: MinuteOption;
} {
  const start = new Date();
  start.setSeconds(0, 0);
  const minutes = start.getMinutes();
  if (minutes !== 0 && minutes !== 30) {
    start.setMinutes(minutes + (minutes < 30 ? 30 - minutes : 60 - minutes));
  }
  const end = new Date(start);
  end.setHours(end.getHours() + 1);

  return {
    startDate: dateStr(start),
    startHour: pad2(start.getHours()),
    startMinute: start.getMinutes() === 30 ? "30" : "00",
    endDate: dateStr(end),
    endHour: pad2(end.getHours()),
    endMinute: end.getMinutes() === 30 ? "30" : "00",
  };
}

/** ประกอบวันที่/ชั่วโมง/นาทีทั้ง 3 ช่องกลับเป็นสตริงเดียวรูปแบบเดียวกับที่
 * ระบบใช้ทุกที่ ("YYYY-MM-DDTHH:MM") — ว่างถ้ายังเลือกวันที่ไม่ครบ. */
function combineDateTime(date: string, hour: string, minute: string): string {
  return date ? `${date}T${hour}:${minute}` : "";
}

/**
 * New-booking form, scoped to one resource type at a time (car or room —
 * kept as separate menus per the hospital's explicit request, see
 * BookingDashboard). A room booking confirms immediately on save and still
 * requires picking a specific room up front, exactly as before — the room
 * picker + photo preview + seat/capacity warning below are all room-only
 * now. A car booking is accepted without choosing any specific vehicle at
 * all and starts out "pending" a superadmin's approval — per a later,
 * explicit hospital request, which car (and driver) gets used is entirely
 * management's decision, made only when they dispatch it via a TripOrder
 * (see TripOrderModal), so there's nothing resource-specific for the
 * requester to pick here anymore (see PENDING_CAR_RESOURCE_NAME in
 * lib/booking.ts for what gets recorded on the booking row instead, and
 * POST /api/booking/bookings for the server-side branch on resourceType
 * that makes resourceId optional only for a car booking). The only reason
 * a save itself can fail is a time conflict re-checked server-side — that
 * check only ever applies to a room booking (a car may overlap another car
 * booking by design, see hasBookingConflict's doc comment in lib/booking.ts)
 * — surfaced here as a plain error message so the person can pick another
 * time/room and try again.
 */
export default function BookingFormModal({
  resourceType,
  resources,
  preselectedResourceId,
  onClose,
  onSaved,
}: {
  resourceType: BookingResourceType;
  /** Active resources of this type only — an inactive resource isn't
   * choosable for a new booking (see BookingDashboard's filtering). */
  resources: BookingResource[];
  preselectedResourceId?: string;
  onClose: () => void;
  onSaved: (booking: Booking) => void;
}) {
  const [resourceId, setResourceId] = useState(preselectedResourceId ?? resources[0]?.resourceId ?? "");
  const defaultParts = defaultBookingParts();
  const [startDate, setStartDate] = useState(defaultParts.startDate);
  const [startHour, setStartHour] = useState(defaultParts.startHour);
  const [startMinute, setStartMinute] = useState<MinuteOption>(defaultParts.startMinute);
  const [endDate, setEndDate] = useState(defaultParts.endDate);
  const [endHour, setEndHour] = useState(defaultParts.endHour);
  const [endMinute, setEndMinute] = useState<MinuteOption>(defaultParts.endMinute);
  // ค่ารวมรูปแบบ "YYYY-MM-DDTHH:MM" เดิม — ใช้กับ validation/ส่ง API ด้านล่าง
  // เหมือนเดิมทุกจุด ไม่ต้องแตะโค้ดส่วนอื่นที่อ้างอิง startTime/endTime.
  const startTime = combineDateTime(startDate, startHour, startMinute);
  const endTime = combineDateTime(endDate, endHour, endMinute);
  const [purpose, setPurpose] = useState("");
  const [destination, setDestination] = useState("");
  const [companions, setCompanions] = useState("");
  const [participants, setParticipants] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // true เฉพาะตอนที่การจองไม่สำเร็จเพราะเซสชันหลุด (401 จาก proxy.ts) — ไม่ใช่
  // ทุกข้อผิดพลาด แยกไว้เพื่อแสดงปุ่ม "เข้าสู่ระบบใหม่" เพิ่มเติมใต้ข้อความ
  // เท่านั้นในกรณีนี้ กรณีอื่น (เช่น กรอกข้อมูลไม่ครบ) ไม่เกี่ยวกับการเข้าสู่
  // ระบบเลย ไม่ควรมีปุ่มนี้. สาเหตุที่พบได้บ่อย: กรอกฟอร์มนี้นานเกิน 5 นาที
  // (เซสชันหมดอายุแบบ idle — ดู SESSION_TTL_MS ใน lib/auth.ts) เพราะการพิมพ์
  // ในฟอร์มไม่ได้ยิง request ไปเซิร์ฟเวอร์เลยจนกว่าจะกดยืนยัน หรือมีการ
  // เข้าสู่ระบบบัญชีเดียวกันจากที่อื่นระหว่างนั้น (เตะเซสชันเดิมออกทันที
  // ตามกติกา 1 บัญชีต่อ 1 เซสชัน).
  const [sessionExpired, setSessionExpired] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLSelectElement | null>(null);

  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);

  // Live photo preview of whichever room is currently selected, so the
  // booker can look at what they're about to book before confirming — per
  // the hospital's explicit request. Room only now — a car booking never
  // has a selected resource at all (see the doc comment above), so the old
  // seat-capacity warning that compared participants against a selected
  // car's seatCount has nothing left to compare against and is gone too
  // (isOverSeatCapacity is now only ever meaningful for a resource this
  // form no longer lets a car booker pick).
  const selectedResource = useMemo(
    () => (resourceType === "room" ? resources.find((r) => r.resourceId === resourceId) : undefined),
    [resourceType, resources, resourceId]
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const typeLabel = resourceType === "car" ? "รถ" : "ห้องประชุม";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // เฉพาะห้องประชุมเท่านั้นที่ยังต้องเลือกทรัพยากรเจาะจง — รถไม่ต้องเลือก
    // ล่วงหน้าแล้ว (ดูคอมเมนต์บนสุดของไฟล์นี้)
    if (resourceType === "room" && !resourceId) {
      setError(`กรุณาเลือก${typeLabel}`);
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
    if (!purpose.trim()) {
      setError("กรุณาระบุวัตถุประสงค์ / เหตุผลการใช้งาน");
      return;
    }
    if (!contactPhone.trim()) {
      setError("กรุณาระบุเบอร์ติดต่อผู้จอง");
      return;
    }
    const participantsNum = Number(participants);
    if (!participants.trim() || !Number.isFinite(participantsNum) || participantsNum < 0) {
      setError("กรุณาระบุจำนวนผู้โดยสาร/ผู้เข้าร่วมให้ถูกต้อง");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/booking/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resourceType,
          // "" for a car booking — the server only requires/uses resourceId
          // for a room booking now (see POST /api/booking/bookings).
          resourceId: resourceType === "room" ? resourceId : "",
          startTime,
          endTime,
          purpose: purpose.trim(),
          destination: resourceType === "car" ? destination.trim() : "",
          companions: resourceType === "car" ? companions.trim() : "",
          participants: participantsNum,
          contactPhone: contactPhone.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          setSessionExpired(true);
          setError("เซสชันหมดอายุ หรือมีการเข้าสู่ระบบบัญชีนี้จากที่อื่น กรุณาเข้าสู่ระบบใหม่อีกครั้ง (ข้อมูลที่กรอกไว้ในฟอร์มนี้จะหายไป)");
        } else {
          setError(json.error || "จองไม่สำเร็จ กรุณาลองใหม่");
        }
        setSaving(false);
        return;
      }
      onSaved(json.booking as Booking);
    } catch {
      setError("จองไม่สำเร็จ กรุณาลองใหม่");
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
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-form-modal-title"
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-zinc-900"
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <h2 id="booking-form-modal-title" className="text-base font-semibold text-zinc-800 dark:text-zinc-100">
            จอง{typeLabel}
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
              <div role="alert" className="flex flex-col gap-1.5">
                <p className="flex items-start gap-2 text-sm text-red-700 dark:text-red-300">
                  <AlertTriangle size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
                  {error}
                </p>
                {sessionExpired && (
                  <button
                    type="button"
                    onClick={() => {
                      // Hard navigation, ไม่ใช้ router.push() — เหตุผลเดียวกับ
                      // LoginForm/AppShell: ปิดหน้าต่างนี้ค้างกลางทางไม่ได้เลย
                      // เพราะเซสชันหลุดไปแล้วจริงๆ
                      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- intentional hard navigation, see comment above
                      window.location.href = "/login";
                    }}
                    className="ml-6 self-start text-sm font-medium text-red-700 underline underline-offset-2 hover:text-red-800 dark:text-red-300 dark:hover:text-red-200"
                  >
                    เข้าสู่ระบบใหม่
                  </button>
                )}
              </div>
            )}
            {resourceType === "room" ? (
              resources.length === 0 ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  ยังไม่มี{typeLabel}ที่เปิดให้จอง — เพิ่ม{typeLabel}ก่อน
                </p>
              ) : (
                <>
                  <label className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-300">
                    {typeLabel}
                    <select
                      ref={firstInputRef}
                      value={resourceId}
                      onChange={(e) => setResourceId(e.target.value)}
                      disabled={saving}
                      className={INPUT_CLASS}
                    >
                      {resources.map((r) => (
                        <option key={r.resourceId} value={r.resourceId}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {/* พรีวิวรูปของ{typeLabel}ที่เลือกอยู่ — ให้ผู้จองได้พิจารณา
                      ภาพก่อนตัดสินใจจอง ตามที่ขอ */}
                  <div className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-2.5 dark:border-zinc-700 dark:bg-zinc-800/60">
                    <div className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md bg-zinc-100 dark:bg-zinc-800">
                      {selectedResource?.imageDataUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- data: URL from the sheet, not a static/remote asset next/image can optimize
                        <img
                          src={selectedResource.imageDataUrl}
                          alt={selectedResource.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <ImageOff size={16} strokeWidth={1.5} className="text-zinc-300 dark:text-zinc-600" aria-hidden="true" />
                      )}
                    </div>
                    <div className="min-w-0 text-xs text-zinc-500 dark:text-zinc-400">
                      {selectedResource?.detail ? (
                        // whitespace-pre-line: คงการขึ้นบรรทัดใหม่ตามที่พิมพ์ไว้ในช่อง
                        // "รายละเอียดเพิ่มเติม" เช่นเดียวกับที่การ์ดรายการทรัพยากรใน
                        // BookingDashboard ทำ — ดูคอมเมนต์ที่นั่นสำหรับรายละเอียดปัญหา
                        <p className="whitespace-pre-line leading-5">{selectedResource.detail}</p>
                      ) : (
                        <p className="italic">ไม่มีรายละเอียดเพิ่มเติม</p>
                      )}
                    </div>
                  </div>
                </>
              )
            ) : (
              // การจองรถ — ไม่มีการเลือกรถล่วงหน้าอีกต่อไป (ตามที่ขอ) —
              // ฝ่ายบริหารเป็นผู้จัดสรรรถและคนขับให้ตอนอนุมัติ/ออกใบสั่งงาน
              // เดินทางแทน (ดู TripOrderModal) — แจ้งให้ผู้จองทราบตรงนี้แทน
              // ตัวเลือกรถเดิม
              <p className="flex items-start gap-2 rounded-lg bg-sky-50 p-2.5 text-xs leading-5 text-sky-800 dark:bg-sky-950/30 dark:text-sky-200">
                <Info size={15} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
                ไม่ต้องเลือกรถล่วงหน้า — ฝ่ายบริหารจะเป็นผู้จัดสรรรถและคนขับให้หลังจากอนุมัติคำขอนี้แล้ว
              </p>
            )}
            {/* วันที่ + ชั่วโมง (อิสระ) + นาที (00/30 เท่านั้น) แยกเป็นคนละ
                ช่อง — คนละแถวเสมอ (ไม่แบ่ง 2 คอลัมน์) เพราะแต่ละฝั่งมี 3
                ช่องย่อยรวมกันแล้วค่อนข้างกว้าง ใส่ 2 ฝั่งเคียงกันในโมดัลนี้
                จะแคบเกินไป */}
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-300">
                วันเวลาเริ่มต้น
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
                วันเวลาสิ้นสุด
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
              วัตถุประสงค์ / เหตุผลการใช้งาน
              <input
                type="text"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                disabled={saving}
                className={INPUT_CLASS}
              />
            </label>
            {resourceType === "car" && (
              <label className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-300">
                ปลายทาง
                <input
                  type="text"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  disabled={saving}
                  className={INPUT_CLASS}
                />
              </label>
            )}
            {resourceType === "car" && (
              <label className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-300">
                ผู้เดินทาง (ไม่บังคับ)
                <input
                  type="text"
                  value={companions}
                  onChange={(e) => setCompanions(e.target.value)}
                  disabled={saving}
                  placeholder="เช่น ชื่อผู้เดินทาง คั่นด้วยจุลภาค"
                  className={INPUT_CLASS}
                />
              </label>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-300">
                {resourceType === "car" ? "จำนวนผู้โดยสาร" : "จำนวนผู้เข้าร่วม"}
                <input
                  type="number"
                  min={0}
                  value={participants}
                  onChange={(e) => setParticipants(e.target.value)}
                  disabled={saving}
                  className={INPUT_CLASS}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-300">
                เบอร์ติดต่อผู้จอง
                <input
                  type="tel"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  disabled={saving}
                  className={INPUT_CLASS}
                />
              </label>
            </div>
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
                // ห้องประชุมยังต้องมีอย่างน้อย 1 ห้องให้เลือกจึงจะจองได้ —
                // รถไม่ต้องมีให้เลือกแล้ว (ดูคอมเมนต์บนสุดของไฟล์)
                disabled={saving || (resourceType === "room" && resources.length === 0)}
                className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-br from-[var(--brand)] to-[var(--brand-2)] px-4 py-2 text-sm font-medium text-[var(--brand-contrast)] shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {saving ? (
                  <Loader2 size={16} strokeWidth={2} className="animate-spin" aria-hidden="true" />
                ) : (
                  <Save size={16} strokeWidth={2} aria-hidden="true" />
                )}
                ยืนยันการจอง
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body
  );
}
