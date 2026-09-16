"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ImageOff, Info, Loader2, Save, X } from "lucide-react";
import { isOverSeatCapacity, type Booking, type BookingResource, type BookingResourceType } from "@/lib/booking";

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
 * BookingDashboard). A room booking confirms immediately on save; a car
 * booking is accepted the same way but starts out "pending" a superadmin's
 * approval (see the note shown below the resource picker when
 * resourceType is "car") — the only reason a save itself can fail either
 * way is a time conflict re-checked server-side (POST
 * /api/booking/bookings), surfaced here as a plain error message so the
 * person can pick another time/resource and try again. Also warns (but
 * doesn't block — per the hospital's explicit choice) when the entered
 * participant count exceeds the selected car's seat count.
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
  const [participants, setParticipants] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLSelectElement | null>(null);

  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);

  // Live photo preview of whichever resource is currently selected, so the
  // booker can look at what they're about to book before confirming — per
  // the hospital's explicit request.
  const selectedResource = useMemo(
    () => resources.find((r) => r.resourceId === resourceId),
    [resources, resourceId]
  );

  // Non-blocking — per the hospital's explicit choice, exceeding the
  // selected car's seat count only warns, it never stops the booking.
  const participantsNum = Number(participants);
  const overSeatCapacity =
    !!selectedResource &&
    Number.isFinite(participantsNum) &&
    isOverSeatCapacity(selectedResource, participantsNum);

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
    if (!resourceId) {
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
          resourceId,
          startTime,
          endTime,
          purpose: purpose.trim(),
          destination: resourceType === "car" ? destination.trim() : "",
          participants: participantsNum,
          contactPhone: contactPhone.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || "จองไม่สำเร็จ กรุณาลองใหม่");
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
              <p role="alert" className="flex items-start gap-2 text-sm text-red-700 dark:text-red-300">
                <AlertTriangle size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
                {error}
              </p>
            )}
            {resources.length === 0 ? (
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
                    {resourceType === "car" && !!selectedResource?.seatCount && (
                      <p className="mt-0.5 leading-5">{selectedResource.seatCount.toLocaleString("th-TH")} ที่นั่ง</p>
                    )}
                  </div>
                </div>
                {resourceType === "car" && (
                  <p className="flex items-start gap-2 rounded-lg bg-sky-50 p-2.5 text-xs leading-5 text-sky-800 dark:bg-sky-950/30 dark:text-sky-200">
                    <Info size={15} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
                    การจองรถต้องได้รับการอนุมัติจากบริหาร ก่อน จึงจะถือว่ายืนยันการจอง
                  </p>
                )}
              </>
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
              {overSeatCapacity && (
                <p className="flex items-start gap-2 text-xs leading-5 text-amber-700 dark:text-amber-400 sm:col-span-2">
                  <AlertTriangle size={14} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
                  จำนวนผู้โดยสารมากกว่าจำนวนที่นั่งของ{selectedResource?.name} ({selectedResource?.seatCount.toLocaleString("th-TH")} ที่นั่ง) — ยังจองได้ แต่กรุณาตรวจสอบอีกครั้ง
                </p>
              )}
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
                disabled={saving || resources.length === 0}
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
