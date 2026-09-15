"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ImageOff, Loader2, Save, Upload, X } from "lucide-react";
import {
  MAX_RESOURCE_IMAGE_DATA_URL_LENGTH,
  isValidResourceImageDataUrl,
  type BookingResource,
  type BookingResourceType,
} from "@/lib/booking";

const INPUT_CLASS =
  "h-11 rounded-lg border border-zinc-200 bg-white px-3 text-base text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:disabled:bg-zinc-800/60 dark:disabled:text-zinc-500";

/** Longest edge a resized photo is allowed to keep, in pixels — shrunk
 * further below if the resulting JPEG still doesn't fit under
 * MAX_RESOURCE_IMAGE_DATA_URL_LENGTH once base64-encoded. */
const MAX_IMAGE_DIMENSION = 900;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("อ่านไฟล์ไม่สำเร็จ"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("ไฟล์นี้ไม่ใช่รูปภาพที่รองรับ"));
    img.src = src;
  });
}

/** Resizes + re-compresses a photo client-side (canvas → JPEG) so it fits
 * under MAX_RESOURCE_IMAGE_DATA_URL_LENGTH before it's ever sent to the
 * server — Google Sheets caps a single cell at ~50,000 characters, so a
 * phone photo straight out of a camera (often several MB) has to shrink by
 * two-plus orders of magnitude. Steps dimension and JPEG quality down
 * together across a bounded number of attempts rather than looping
 * indefinitely. */
async function resizeImageToDataUrl(file: File): Promise<string> {
  const original = await readFileAsDataUrl(file);
  const img = await loadImage(original);

  let dimension = MAX_IMAGE_DIMENSION;
  for (let attempt = 0; attempt < 6; attempt++) {
    const scale = Math.min(1, dimension / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("ไม่สามารถประมวลผลรูปภาพนี้ได้");
    ctx.drawImage(img, 0, 0, width, height);

    for (const quality of [0.82, 0.65, 0.5, 0.35]) {
      const out = canvas.toDataURL("image/jpeg", quality);
      if (out.length <= MAX_RESOURCE_IMAGE_DATA_URL_LENGTH) return out;
    }
    dimension = Math.round(dimension * 0.7);
  }
  throw new Error("รูปภาพนี้มีรายละเอียดสูงเกินไป — กรุณาลองรูปอื่นหรือถ่ายภาพใหม่แบบไม่ซูม");
}

/**
 * Add/edit form for one bookable resource (vehicle or meeting room).
 * mode="add" always creates against a fixed `type` (the tab the "+" button
 * was clicked from — see BookingDashboard); mode="edit" only ever touches
 * name/detail/photo, never type (a resource's type is permanent — changing
 * car <-> room after bookings already exist against it wouldn't make
 * sense). Reachable only by the "it" role or the bootstrap superadmin
 * account — see canManageBookingResources in lib/auth.ts and
 * /api/booking/resources, which re-checks this server-side regardless of
 * whether BookingDashboard actually shows the button that opens this modal.
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
  // "" while empty (not "0") so the field doesn't default to a misleading
  // 0-seat car before the user has typed anything — only meaningful for
  // type "car", see lib/booking.ts's BookingResource.seatCount comment.
  const [seatCount, setSeatCount] = useState(resource?.seatCount ? String(resource.seatCount) : "");
  const [imageDataUrl, setImageDataUrl] = useState(resource?.imageDataUrl ?? "");
  const [imageProcessing, setImageProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // lets picking the same file twice re-fire onChange
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("กรุณาเลือกไฟล์รูปภาพ");
      return;
    }
    setImageProcessing(true);
    setError(null);
    try {
      const resized = await resizeImageToDataUrl(file);
      setImageDataUrl(resized);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ประมวลผลรูปภาพไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setImageProcessing(false);
    }
  }

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
    if (!isValidResourceImageDataUrl(imageDataUrl)) {
      setError("รูปภาพมีขนาดใหญ่เกินไป กรุณาลองรูปอื่น");
      return;
    }
    const seatCountNum = seatCount.trim() ? Number(seatCount) : 0;
    if (type === "car" && (!Number.isFinite(seatCountNum) || seatCountNum < 0)) {
      setError("กรุณาระบุจำนวนที่นั่งให้ถูกต้อง");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const url = mode === "add" ? "/api/booking/resources" : `/api/booking/resources/${resource!.resourceId}`;
      const method = mode === "add" ? "POST" : "PATCH";
      const body =
        mode === "add"
          ? { type, name: name.trim(), detail: detail.trim(), imageDataUrl, seatCount: seatCountNum }
          : { name: name.trim(), detail: detail.trim(), imageDataUrl, seatCount: seatCountNum };
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
                placeholder={type === "car" ? "เช่น หมายเหตุอื่น ๆ" : "เช่น ความจุห้อง, อุปกรณ์ที่มี"}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-base text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              />
            </label>
            {/* จำนวนที่นั่ง — เฉพาะรถ ใช้เทียบกับจำนวนผู้โดยสารตอนจอง เพื่อ
                แจ้งเตือนเมื่อจำนวนผู้เดินทางเกินที่นั่งที่มี (ดู BookingFormModal) */}
            {type === "car" && (
              <label className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-300">
                จำนวนที่นั่ง
                <input
                  type="number"
                  min={0}
                  value={seatCount}
                  onChange={(e) => setSeatCount(e.target.value)}
                  disabled={saving}
                  placeholder="เช่น 6"
                  className={INPUT_CLASS}
                />
              </label>
            )}
            <div className="flex flex-col gap-1.5 text-sm text-zinc-600 dark:text-zinc-300">
              รูปภาพ{typeLabel}
              <p className="text-xs font-normal text-zinc-400 dark:text-zinc-500">
                ให้ผู้จองเห็นก่อนตัดสินใจจอง — ระบบจะย่อ/บีบอัดรูปให้อัตโนมัติ
              </p>
              <div className="flex items-center gap-3">
                <div className="flex h-20 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800">
                  {imageProcessing ? (
                    <Loader2 size={18} strokeWidth={2} className="animate-spin text-zinc-400" aria-hidden="true" />
                  ) : imageDataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- data: URL preview, not a static/remote asset next/image can optimize
                    <img src={imageDataUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <ImageOff size={18} strokeWidth={1.5} className="text-zinc-300 dark:text-zinc-600" aria-hidden="true" />
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    disabled={saving || imageProcessing}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={saving || imageProcessing}
                    className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    <Upload size={13} strokeWidth={2} aria-hidden="true" />
                    {imageDataUrl ? "เปลี่ยนรูป" : "อัปโหลดรูป"}
                  </button>
                  {imageDataUrl && (
                    <button
                      type="button"
                      onClick={() => setImageDataUrl("")}
                      disabled={saving || imageProcessing}
                      className="text-xs font-medium text-red-600 hover:underline disabled:opacity-60 dark:text-red-400"
                    >
                      ลบรูป
                    </button>
                  )}
                </div>
              </div>
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
                disabled={saving || imageProcessing}
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
