"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Loader2, Save, X } from "lucide-react";
import EditableSelect from "@/components/EditableSelect";
import type { SpecOptionLists } from "@/lib/sheets";

const INPUT_CLASS =
  "h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:disabled:bg-zinc-800/60 dark:disabled:text-zinc-500";

export type BulkFieldKey =
  | "brand"
  | "model"
  | "processor"
  | "ramType"
  | "ramCapacity"
  | "ramSpeed"
  | "storageType"
  | "storageCapacity";

export interface BulkEditResult {
  updated: { rowNumber: number; values: Record<string, string> }[];
  skipped: { rowNumber: number; reason: string }[];
}

const RAM_TYPE_CHOICES = ["DDR2", "DDR3", "DDR4", "DDR5"];

// The 8 fields this covers are exactly the คอมพิวเตอร์/โน้ตบุ๊ก-only spec
// columns (see PC_ONLY_FIELD_HEADERS in fields.ts / BULK_FIELD_HEADER_INDEX
// in the API route) — matches why the checkbox-select column that opens
// this modal only exists on the คอมพิวเตอร์/โน้ตบุ๊ก/All-in-One table.
const FIELD_CONFIG: { key: BulkFieldKey; label: string; options?: string[]; extensibleOptionsKey?: keyof SpecOptionLists }[] = [
  { key: "brand", label: "ยี่ห้อ" },
  { key: "model", label: "รุ่น" },
  { key: "processor", label: "หน่วยประมวลผล" },
  { key: "ramType", label: "ประเภท RAM", options: RAM_TYPE_CHOICES },
  // These four used to be free text — now an EditableSelect (see
  // extensibleOptionsKey below) whose choices live in SpecStandards and can
  // be extended right from the dropdown, unlike ramType's fixed list above.
  { key: "ramCapacity", label: "ความจุ RAM", extensibleOptionsKey: "ramCapacityOptions" },
  { key: "ramSpeed", label: "ความเร็ว RAM", extensibleOptionsKey: "ramSpeedOptions" },
  { key: "storageType", label: "ประเภทหน่วยจัดเก็บ", extensibleOptionsKey: "storageTypeOptions" },
  { key: "storageCapacity", label: "ความจุจัดเก็บ", extensibleOptionsKey: "storageCapacityOptions" },
];

/**
 * "แก้ไขพร้อมกันหลายรายการ" — lets IT set ยี่ห้อ/รุ่น/หน่วยประมวลผล/สเปก RAM
 * และหน่วยจัดเก็บ across every currently-selected คอมพิวเตอร์/โน้ตบุ๊ก row in
 * one save, instead of opening each row individually. Each field is
 * checkbox-gated ("เปลี่ยนค่านี้") rather than always-applied — leaving a
 * field unchecked means it's left completely alone on every selected row,
 * so an empty box is never mistaken for "clear this field on everyone".
 * Posts to PATCH /api/manage/it/records/bulk (a fixed 8-field allowlist —
 * see that route's own comments for why it doesn't take arbitrary header
 * keys from the client).
 */
export default function BulkEditSpecModal({
  rowNumbers,
  specOptions,
  onAddSpecOption,
  onClose,
  onSaved,
}: {
  rowNumbers: number[];
  /** Current choices for ความจุ RAM / ความเร็ว RAM / ประเภทหน่วยจัดเก็บ /
   * ความจุจัดเก็บ — see EditableSelect and /api/manage/spec-options. */
  specOptions: SpecOptionLists;
  /** Persists a newly-typed value into the shared list named by `key` —
   * see ITDashboard's addSpecOption, which PATCHes /api/manage/spec-options
   * and keeps this modal's specOptions prop in sync afterward. Resolves
   * `{ ok: false, error }` (never a bare boolean) so EditableSelect can show
   * the actual reason a save failed, not just "something went wrong". */
  onAddSpecOption: (key: keyof SpecOptionLists, value: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  onClose: () => void;
  /** Fired once, right after a successful save, so the caller can patch its
   * own row state immediately — the modal stays open afterward to show the
   * updated/skipped summary below. */
  onSaved: (result: BulkEditResult) => void;
}) {
  const [enabled, setEnabled] = useState<Partial<Record<BulkFieldKey, boolean>>>({});
  const [values, setValues] = useState<Partial<Record<BulkFieldKey, string>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkEditResult | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const anyEnabled = FIELD_CONFIG.some((f) => enabled[f.key]);

  async function handleSave() {
    if (!anyEnabled) {
      setError("กรุณาเลือกอย่างน้อย 1 ช่องที่ต้องการแก้ไข");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const fields: Partial<Record<BulkFieldKey, string>> = {};
      for (const f of FIELD_CONFIG) {
        if (enabled[f.key]) fields[f.key] = (values[f.key] ?? "").trim();
      }
      const res = await fetch("/api/manage/it/records/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowNumbers, fields }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "บันทึกไม่สำเร็จ");
        setSaving(false);
        return;
      }
      const bulkResult: BulkEditResult = { updated: json.updated ?? [], skipped: json.skipped ?? [] };
      setResult(bulkResult);
      onSaved(bulkResult);
    } catch {
      setError("บันทึกไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-edit-modal-title"
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-zinc-900"
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <h2 id="bulk-edit-modal-title" className="text-base font-semibold text-zinc-800 dark:text-zinc-100">
            แก้ไขพร้อมกัน ({rowNumbers.length.toLocaleString("th-TH")} รายการ)
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
          {!result ? (
            <div className="flex flex-col gap-4">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                ติ๊กเลือกเฉพาะช่องที่ต้องการเปลี่ยน — ค่าจะถูกตั้งเหมือนกันในทุกรายการที่เลือกไว้ ส่วนช่องที่ไม่ติ๊กจะไม่ถูกแตะต้องเลย
              </p>
              {error && (
                <p role="alert" className="flex items-start gap-2 text-sm text-red-700 dark:text-red-300">
                  <AlertTriangle size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
                  {error}
                </p>
              )}
              <div className="flex flex-col gap-3">
                {FIELD_CONFIG.map((f) => {
                  const isEnabled = Boolean(enabled[f.key]);
                  return (
                    <div key={f.key} className="flex flex-col gap-1">
                      <label className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-200">
                        <input
                          type="checkbox"
                          checked={isEnabled}
                          onChange={(e) =>
                            setEnabled((prev) => ({ ...prev, [f.key]: e.target.checked }))
                          }
                          disabled={saving}
                          className="h-4 w-4 rounded border-zinc-300"
                        />
                        เปลี่ยน{f.label}
                      </label>
                      {f.options ? (
                        <select
                          value={values[f.key] ?? ""}
                          onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                          disabled={saving || !isEnabled}
                          className={`${INPUT_CLASS} ml-6`}
                        >
                          <option value="">— เลือก —</option>
                          {f.options.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : f.extensibleOptionsKey ? (
                        <EditableSelect
                          value={values[f.key] ?? ""}
                          onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
                          options={specOptions[f.extensibleOptionsKey]}
                          onAddOption={(v) => onAddSpecOption(f.extensibleOptionsKey!, v)}
                          disabled={saving || !isEnabled}
                          className={`${INPUT_CLASS} ml-6 flex-1`}
                        />
                      ) : (
                        <input
                          type="text"
                          value={values[f.key] ?? ""}
                          onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                          disabled={saving || !isEnabled}
                          placeholder={`ค่าใหม่ของ${f.label}`}
                          className={`${INPUT_CLASS} ml-6`}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={saving}
                  className="h-11 rounded-full border border-zinc-200 px-5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || !anyEnabled}
                  className="flex h-11 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[var(--brand)] to-[var(--brand-2)] px-5 text-sm font-medium text-[var(--brand-contrast)] transition-colors hover:from-[var(--brand-strong)] disabled:opacity-60"
                >
                  {saving ? (
                    <Loader2 size={16} strokeWidth={2} className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Save size={16} strokeWidth={2} aria-hidden="true" />
                  )}
                  บันทึกการแก้ไข
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 size={16} strokeWidth={2} aria-hidden="true" />
                อัปเดตสำเร็จ {result.updated.length.toLocaleString("th-TH")} รายการ
              </p>
              {result.skipped.length > 0 && (
                <div className="flex flex-col gap-1.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                  <p className="flex items-center gap-1.5 font-medium">
                    <AlertTriangle size={13} strokeWidth={2} aria-hidden="true" />
                    ข้าม {result.skipped.length.toLocaleString("th-TH")} รายการ
                  </p>
                  <ul className="flex flex-col gap-0.5 pl-1">
                    {result.skipped.map((s) => (
                      <li key={s.rowNumber}>
                        แถวที่ {s.rowNumber}: {s.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="h-11 rounded-full bg-gradient-to-r from-[var(--brand)] to-[var(--brand-2)] px-5 text-sm font-medium text-[var(--brand-contrast)] transition-colors hover:from-[var(--brand-strong)]"
                >
                  ปิด
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
