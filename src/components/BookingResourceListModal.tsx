"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Ban, ImageOff, Loader2, Pencil, Plus, Power, Users, X } from "lucide-react";
import type { BookingResource, BookingResourceType } from "@/lib/booking";

// เหมือน ACTION_BUTTON ใน BookingDashboard.tsx ทุกประการ — คัดลอกมาเป็นของ
// ตัวเองแทนการ import ข้ามไฟล์ ตามธรรมเนียมของโค้ดฐานนี้ (เช่น
// STATUS_BADGE_CLASSES ที่ซ้ำกันระหว่าง BookingCalendar/BookingDashboard)
const ACTION_BUTTON =
  "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60";

/**
 * รายการรถ/ห้องประชุมในระบบ พร้อมปุ่มเพิ่ม/แก้ไข/เปิด-ปิดใช้งาน — เดิมแสดง
 * อยู่บนหน้า /booking/car และ /booking/room ตลอดเวลาให้ทุกคนเห็น ย้ายมาไว้
 * ในหน้าต่าง popup นี้แทนตามที่ขอ เพราะเป็นข้อมูลเชิงจัดการที่ไม่จำเป็นต้อง
 * โชว์ค้างให้ผู้จองทั่วไปเห็นตลอด (การเลือกรถตอนจองก็ตัดออกไปแล้วเช่นกัน —
 * ดู BookingFormModal) — คอมโพเนนต์นี้เรียกใช้เฉพาะตอน canManageResources
 * เป็นจริงเท่านั้น (ดูปุ่ม "จัดการข้อมูล..." ใน BookingDashboard ที่เปิดมัน)
 * จึงไม่ต้องรับ/เช็คสิทธิ์ซ้ำในนี้อีกชั้น.
 */
export default function BookingResourceListModal({
  typeLabel,
  type,
  resources,
  togglingResourceId,
  onAdd,
  onEdit,
  onToggleActive,
  onClose,
}: {
  typeLabel: string;
  type: BookingResourceType;
  resources: BookingResource[];
  togglingResourceId: string | null;
  onAdd: () => void;
  onEdit: (resource: BookingResource) => void;
  onToggleActive: (resource: BookingResource) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

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
        aria-labelledby="booking-resource-list-modal-title"
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-zinc-900"
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <h2
            id="booking-resource-list-modal-title"
            className="text-base font-semibold text-zinc-800 dark:text-zinc-100"
          >
            จัดการข้อมูล{typeLabel}
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
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onAdd}
              className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-br from-[var(--brand)] to-[var(--brand-2)] px-3 py-1.5 text-xs font-medium text-[var(--brand-contrast)] shadow-sm transition-opacity hover:opacity-90"
            >
              <Plus size={14} strokeWidth={2} aria-hidden="true" />
              เพิ่ม{typeLabel}ใหม่
            </button>
          </div>

          {resources.length === 0 ? (
            <p className="py-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
              ยังไม่มี{typeLabel}ในระบบ
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {resources.map((resource) => (
                <div
                  key={resource.resourceId}
                  className={`flex flex-col gap-2 rounded-xl border p-3 ${
                    resource.active
                      ? "border-zinc-200 dark:border-zinc-700"
                      : "border-zinc-200 bg-zinc-50 opacity-70 dark:border-zinc-800 dark:bg-zinc-950/40"
                  }`}
                >
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
                    // "รายละเอียดเพิ่มเติม" (textarea) เหมือน BookingDashboard เดิม
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
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => onEdit(resource)}
                      className={`${ACTION_BUTTON} border-zinc-200 text-zinc-600 hover:bg-zinc-50 focus-visible:outline-zinc-500 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800`}
                    >
                      <Pencil size={12} strokeWidth={2} aria-hidden="true" />
                      แก้ไข
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleActive(resource)}
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
      </div>
    </div>,
    document.body
  );
}
