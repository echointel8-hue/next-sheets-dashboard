"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Loader2, Save, X } from "lucide-react";
import type { Driver } from "@/lib/booking";

const INPUT_CLASS =
  "h-11 rounded-lg border border-zinc-200 bg-white px-3 text-base text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:disabled:bg-zinc-800/60 dark:disabled:text-zinc-500";

/**
 * Add/edit form for one driver (คนขับรถ) — mirrors BookingResourceFormModal's
 * shape (same modal chrome, same mode="add"/"edit" split, same save-then-
 * onSaved callback), but far simpler: just a name and a phone number, no
 * photo/seat-count fields. Reachable only by an account granted the
 * "manageDrivers" permission — see canManageDrivers in lib/auth.ts and
 * /api/booking/drivers, which re-checks this server-side regardless of
 * whether BookingDashboard actually shows the button that opens this modal.
 */
export default function DriverFormModal({
  mode,
  driver,
  onClose,
  onSaved,
}: {
  mode: "add" | "edit";
  driver?: Driver;
  onClose: () => void;
  onSaved: (driver: Driver) => void;
}) {
  const [name, setName] = useState(driver?.name ?? "");
  const [phone, setPhone] = useState(driver?.phone ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      setError("กรุณากรอกชื่อคนขับ");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const url = mode === "add" ? "/api/booking/drivers" : `/api/booking/drivers/${driver!.driverId}`;
      const method = mode === "add" ? "POST" : "PATCH";
      const body = { name: name.trim(), phone: phone.trim() };
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
      onSaved(json.driver as Driver);
    } catch {
      setError("บันทึกไม่สำเร็จ กรุณาลองใหม่");
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
        aria-labelledby="driver-form-modal-title"
        className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-zinc-900"
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <h2 id="driver-form-modal-title" className="text-base font-semibold text-zinc-800 dark:text-zinc-100">
            {mode === "add" ? "เพิ่มคนขับรถใหม่" : "แก้ไขคนขับรถ"}
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
              ชื่อคนขับ
              <input
                ref={firstInputRef}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={saving}
                placeholder="เช่น นายสมชาย ใจดี"
                className={INPUT_CLASS}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-300">
              เบอร์ติดต่อ
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={saving}
                placeholder="เช่น 08x-xxx-xxxx"
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
