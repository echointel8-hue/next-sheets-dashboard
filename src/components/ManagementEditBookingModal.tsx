"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Loader2, Pencil, Save, X } from "lucide-react";
import type { Booking } from "@/lib/booking";

const INPUT_CLASS =
  "h-11 rounded-lg border border-zinc-200 bg-white px-3 text-base text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:disabled:bg-zinc-800/60 dark:disabled:text-zinc-500";

/**
 * ฝ่ายบริหาร/superadmin แก้ไขข้อมูลคำขอจองรถ "เท่าที่จำเป็น" — ตามที่
 * โรงพยาบาลขอไว้ในภายหลัง เป็นข้อยกเว้นเดียวที่จงใจไว้จาก "ข้อมูลคำขอเดิม
 * ไม่ถูกแก้ไข" — แก้ไขได้เฉพาะฟิลด์ที่ไม่กระทบตัวตนผู้จอง/ทรัพยากร/เวลาที่
 * ขอไว้ (วัตถุประสงค์ ปลายทาง ผู้เดินทาง จำนวนผู้โดยสาร เบอร์ติดต่อ) — ใคร
 * จอง จองอะไร จองเมื่อไหร่ ยังคงเดิมเสมอ ส่วนรถ/คนขับ/เวลาจริงเป็นหน้าที่ของ
 * ใบสั่งงานเดินทาง (TripOrderModal) ไม่ใช่ที่นี่ ทุกการแก้ไขจะถูกบันทึกและ
 * แสดงเป็น "แก้ไขโดยฝ่ายบริหาร" บนการ์ด/แถวของรายการจองนั้นเสมอ ไม่มีการ
 * แก้ไขแบบเงียบ
 */
export default function ManagementEditBookingModal({
  booking,
  onClose,
  onSaved,
}: {
  booking: Booking;
  onClose: () => void;
  onSaved: (booking: Booking) => void;
}) {
  const [purpose, setPurpose] = useState(booking.purpose);
  const [destination, setDestination] = useState(booking.destination);
  const [companions, setCompanions] = useState(booking.companions);
  const [participants, setParticipants] = useState(String(booking.participants));
  const [contactPhone, setContactPhone] = useState(booking.contactPhone);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // true เฉพาะตอนบันทึกไม่สำเร็จเพราะเซสชันหลุด (401) — ดูคอมเมนต์อธิบาย
  // เต็มๆ ที่ BookingFormModal.tsx ซึ่งเจอปัญหาเดียวกันนี้ก่อน
  const [sessionExpired, setSessionExpired] = useState(false);
  const firstInputRef = useRef<HTMLInputElement | null>(null);

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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
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
      setError("กรุณาระบุจำนวนผู้โดยสารให้ถูกต้อง");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/booking/bookings/${booking.bookingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          edit: {
            purpose: purpose.trim(),
            destination: destination.trim(),
            companions: companions.trim(),
            participants: participantsNum,
            contactPhone: contactPhone.trim(),
          },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          setSessionExpired(true);
          setError("เซสชันหมดอายุ หรือมีการเข้าสู่ระบบบัญชีนี้จากที่อื่น กรุณาเข้าสู่ระบบใหม่อีกครั้ง (ข้อมูลที่แก้ไขไว้จะหายไป)");
        } else {
          setError(json.error || "บันทึกการแก้ไขไม่สำเร็จ");
        }
        setSaving(false);
        return;
      }
      onSaved(json.booking as Booking);
    } catch {
      setError("บันทึกการแก้ไขไม่สำเร็จ กรุณาลองใหม่");
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
        aria-labelledby="management-edit-booking-modal-title"
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-zinc-900"
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <h2
            id="management-edit-booking-modal-title"
            className="flex items-center gap-2 text-base font-semibold text-zinc-800 dark:text-zinc-100"
          >
            <Pencil size={18} strokeWidth={2} className="shrink-0 text-[var(--brand-strong)]" aria-hidden="true" />
            แก้ไขข้อมูลการจอง ({booking.resourceName})
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
                      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- intentional hard navigation, same reasoning as BookingFormModal
                      window.location.href = "/login";
                    }}
                    className="ml-6 self-start text-sm font-medium text-red-700 underline underline-offset-2 hover:text-red-800 dark:text-red-300 dark:hover:text-red-200"
                  >
                    เข้าสู่ระบบใหม่
                  </button>
                )}
              </div>
            )}

            <p className="flex items-start gap-2 rounded-lg bg-sky-50 p-2.5 text-xs leading-5 text-sky-800 dark:bg-sky-950/30 dark:text-sky-200">
              <AlertTriangle size={14} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
              แก้ไขได้เฉพาะรายละเอียดคำขอเท่าที่จำเป็น — ผู้จอง วันเวลาที่ขอไว้ และรถที่จะใช้จริงจะไม่ถูกแก้ไขตรงนี้
              (ดูรถ/คนขับ/เวลาจริงได้ที่ใบสั่งงานเดินทาง) ระบบจะบันทึกไว้ว่าแก้ไขโดยฝ่ายบริหารเสมอ
            </p>

            <label className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-300">
              วัตถุประสงค์ / เหตุผลการใช้งาน
              <input
                ref={firstInputRef}
                type="text"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                disabled={saving}
                className={INPUT_CLASS}
              />
            </label>

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

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-300">
                จำนวนผู้โดยสาร
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
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-br from-[var(--brand)] to-[var(--brand-2)] px-4 py-2 text-sm font-medium text-[var(--brand-contrast)] shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {saving ? (
                  <Loader2 size={16} strokeWidth={2} className="animate-spin" aria-hidden="true" />
                ) : (
                  <Save size={16} strokeWidth={2} aria-hidden="true" />
                )}
                บันทึกการแก้ไข
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body
  );
}
