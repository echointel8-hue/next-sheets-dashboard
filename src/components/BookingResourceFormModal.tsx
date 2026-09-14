"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Loader2, Save, X } from "lucide-react";
import type { BookingResource, BookingResourceType } from "@/lib/booking";

const INPUT_CLASS =
  "h-11 rounded-lg border border-zinc-200 bg-white px-3 text-base text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:disabled:bg-zinc-800/60 dark:disabled:text-zinc-500";

/**
 * Add/edit form for one bookable resource (vehicle or meeting room).
 * mode="add" always creates against a fixed `type` (the tab the "+" button
 * was clicked from — see BookingDashboard); mode="edit" only ever touches
 * name/detail, never type (a resource's type is permanent — changing car
 * <-> room after bookings already exist against it wouldn't make sense).
 * Reachable by any logged-in account — see /api/booking/resources.
 */
export default function BookingResourceFormModal({
  mode,
  type,
  resource,
  onClose,
  onSaved,
}: {
  mode: "add" | "edit";
  type: BookingResourceType;
  resource?: BookingResource;
  onClose: () => void;
  onSaved: (resource: BookingResource) => void;
}) {
  const [name, setName] = useState(resource?.name ?? "");
  const [detail, setDetail] = useState(resource?.detail ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
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
    if (!name.trim()) {
      setError("กรุณากรอกชื่อ");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const url = mode === "add" ? "/api/booking/resources" : `/api/booking/resources/${resource!.resourceId}`;
      const method = mode === "add" ? "POST" : "PATCH";
      const body =
        mode === "add" ? { type, name: name.trim(), detail: detail.trim() } : { name: name.trim(), detail: detail.trim() };
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || "บันทึกไม่สำเร็จ กรุณาลองใหม่");
        setSaving(false);
        return;
      }
      onSaved(json.resource as BookingResource);
    } catch {
      setError("บันทึกไม่สำเร็จ กรุณาลองใหม่");
      setSaving(false);
    }
  }

  const typeLabel = type === "car" ? "รถ" : "ห้องประชุม";

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
        aria-labelledby="booking-resource-form-modal-title"
        className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-zinc-900"
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <h2 id="booking-resource-form-modal-title" className="text-base font-semibold text-zinc-800 dark:text-zinc-100">
            {mode === "add" ? `เพิ่ม${typeLabel}ใหม่` : `แก้ไข${typeLabel}`}
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
            <label className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-300">
              ชื่อ{typeLabel}
              <input
                ref={firstInputRef}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={saving}
                placeholder={type === "car" ? "เช่น รถตู้ ทะเบียน กข-1234" : "เช่น ห้องประชุมชั้น 2"}
                className={INPUT_CLASS}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-300">
              รายละเอียดเพิ่มเติม
              <textarea
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                disabled={saving}
                rows={3}
                placeholder={type === "car" ? "เช่น จำนวนที่นั่ง, หมายเหตุ" : "เช่น ความจุห้อง, อุปกรณ์ที่มี"}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-base text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
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
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-br from-[var(--brand)] to-[var(--brand-2)] px-4 py-2 text-sm font-medium text-[var(--brand-contrast)] shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {saving ? (
                  <Loader2 size={16} strokeWidth={2} className="animate-spin" aria-hidden="true" />
                ) : (
                  <Save size={16} strokeWidth={2} aria-hidden="true" />
                )}
                บันทึก
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body
  );
}
