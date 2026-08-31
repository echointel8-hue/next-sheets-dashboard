"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Loader2, Save, X } from "lucide-react";
import {
  EQUIPMENT_TYPE_OPTIONS,
  findSelectFieldConfig,
  OTHER_OPTION_LABEL,
  OTHER_OPTION_VALUE,
  visibleFormHeaders,
  type FieldMap,
} from "@/lib/fields";
import MultiSelectField from "@/components/MultiSelectField";

const INPUT_CLASS =
  "h-11 rounded-lg border border-zinc-200 bg-white px-3 text-base text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:disabled:bg-zinc-800/60 dark:disabled:text-zinc-500";

export interface EquipmentFormResult {
  rowNumber: number;
  values: Record<string, string>;
  snapshotHash: string;
}

/**
 * Add/edit form for one equipment row, covering every column in the sheet
 * (not just the ones the public dashboard displays) — shared between
 * "เพิ่มครุภัณฑ์ใหม่" (mode="add", POST /api/manage/records) and "แก้ไข"
 * (mode="edit", PATCH /api/manage/records/[rowNumber]). No password step
 * here — /manage is already gated by a logged-in session (src/proxy.ts).
 */
export default function EquipmentFormModal({
  mode,
  headers,
  fields,
  rowNumber,
  initialValues,
  snapshotHash,
  readOnlyHeaders = [],
  onClose,
  onSaved,
}: {
  mode: "add" | "edit";
  headers: string[];
  /** Used to (a) find the ประทับเวลา/ประเภทครุภัณฑ์/สถานะ columns by role
   * rather than by literal header text, and (b) decide which PC-only or
   * Printer-only spec fields to show — see visibleFormHeaders(). */
  fields: FieldMap;
  rowNumber?: number;
  initialValues: Record<string, string>;
  snapshotHash?: string;
  /** Headers shown but not editable — e.g. an admin's own department on an
   * edit, since the server pins it to their session regardless of what's
   * submitted; disabling it here just avoids the confusing "I typed
   * something else and it didn't stick" experience. */
  readOnlyHeaders?: string[];
  onClose: () => void;
  onSaved: (result: EquipmentFormResult) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Headers currently showing the "อื่นๆ (ระบุเอง)" free-text box instead of
  // their dropdown — starts out including any header whose existing value
  // doesn't match one of its configured options (older data recorded
  // before that option list existed, or before it grew) so that value
  // stays visible/editable rather than silently disappearing behind a
  // dropdown that doesn't contain it.
  const [customHeaders, setCustomHeaders] = useState<Set<string>>(() => {
    const set = new Set<string>();
    for (const header of headers) {
      const cfg = findSelectFieldConfig(header);
      // Multi-select fields track their own "อื่นๆ" state internally
      // (MultiSelectField) — this Set is only consulted by the
      // single-select branch below.
      if (!cfg?.allowOther || cfg.multiple) continue;
      const v = (initialValues[header] ?? "").trim();
      if (v && !cfg.options.includes(v)) set.add(header);
    }
    return set;
  });

  // Recomputed on every render from the *live* values (not just
  // initialValues) so the PC/Printer-only fields appear or disappear as
  // soon as someone finishes typing/picking ประเภทครุภัณฑ์, without needing
  // a submit round-trip.
  const equipmentTypeValue = fields.equipmentType ? values[fields.equipmentType] ?? "" : "";
  const visibleHeaders = visibleFormHeaders(headers, fields, equipmentTypeValue);

  function isFieldReadOnly(header: string): boolean {
    if (fields.timestamp && header.trim() === fields.timestamp.trim()) return true;
    return readOnlyHeaders.includes(header);
  }
  const firstEditableIndex = visibleHeaders.findIndex((h) => !isFieldReadOnly(h));

  const dialogRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement | HTMLSelectElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    firstInputRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(
        mode === "add" ? "/api/manage/records" : `/api/manage/records/${rowNumber}`,
        {
          method: mode === "add" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            mode === "add" ? { values } : { values, expectedSnapshotHash: snapshotHash }
          ),
        }
      );
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "บันทึกไม่สำเร็จ");
        setSaving(false);
        return;
      }
      onSaved({ rowNumber: json.rowNumber, values: json.values, snapshotHash: json.snapshotHash });
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
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="equipment-form-modal-title"
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-zinc-900"
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <h2 id="equipment-form-modal-title" className="text-base font-semibold text-zinc-800 dark:text-zinc-100">
            {mode === "add" ? "เพิ่มครุภัณฑ์ใหม่" : `แก้ไขรายการ (แถวที่ ${rowNumber})`}
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
            {visibleHeaders.map((header, i) => {
              const readOnly = isFieldReadOnly(header);
              const isTimestamp = Boolean(fields.timestamp && header.trim() === fields.timestamp.trim());
              const isEquipmentType = Boolean(
                fields.equipmentType && header.trim() === fields.equipmentType.trim()
              );
              const currentValue = values[header] ?? "";

              // ประเภทครุภัณฑ์ is a fixed multiple-choice question on the
              // Google Form (see EQUIPMENT_TYPE_OPTIONS) — a <select> here
              // instead of free text guarantees the value always exactly
              // matches one of the 3 known types, which is what drives
              // which PC-only/Printer-only spec fields show below. A row
              // whose stored value doesn't match any known option (should
              // only happen for data older than this list) still keeps its
              // real value as an extra option rather than silently losing it.
              if (isEquipmentType) {
                const options = EQUIPMENT_TYPE_OPTIONS.includes(currentValue) || !currentValue
                  ? EQUIPMENT_TYPE_OPTIONS
                  : [currentValue, ...EQUIPMENT_TYPE_OPTIONS];
                return (
                  <label key={header} className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-300">
                    {header}
                    <select
                      ref={i === firstEditableIndex ? (el) => { firstInputRef.current = el; } : undefined}
                      value={currentValue}
                      onChange={(e) => setValues((prev) => ({ ...prev, [header]: e.target.value }))}
                      disabled={saving || readOnly}
                      className={INPUT_CLASS}
                    >
                      <option value="">— เลือกประเภทครุภัณฑ์ —</option>
                      {options.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              }

              // Fixed-choice fields (คำนำหน้า, กลุ่มงาน, วัตถุประสงค์การใช้งาน,
              // ประเภทเครื่องพิมพ์) — a dropdown keeps entries consistent
              // instead of everyone free-typing slightly different wording
              // for the same choice. A couple of these also offer "อื่นๆ
              // (ระบุเอง)" (see SelectFieldConfig.allowOther), which swaps in
              // a free-text box for cases the fixed list doesn't cover.
              const selectConfig = findSelectFieldConfig(header);
              if (selectConfig?.multiple) {
                // "วัตถุประสงค์หลักในการใช้งานคอมพิวเตอร์" — the one select
                // field whose real-world answer can genuinely be more than
                // one value, so it gets the checkbox multi-select instead
                // of the native <select> every other fixed-choice field
                // below uses. See MultiSelectField for the "อื่นๆ" handling.
                return (
                  <MultiSelectField
                    key={header}
                    label={header}
                    options={selectConfig.options}
                    allowOther={selectConfig.allowOther}
                    value={currentValue}
                    onChange={(next) => setValues((prev) => ({ ...prev, [header]: next }))}
                    disabled={saving || readOnly}
                  />
                );
              }
              if (selectConfig) {
                const isCustom = selectConfig.allowOther && customHeaders.has(header);
                const selectValue = isCustom
                  ? OTHER_OPTION_VALUE
                  : currentValue;
                const legacyValue =
                  !selectConfig.allowOther && currentValue && !selectConfig.options.includes(currentValue)
                    ? currentValue
                    : null;
                return (
                  <label key={header} className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-300">
                    {header}
                    <select
                      ref={i === firstEditableIndex ? (el) => { firstInputRef.current = el; } : undefined}
                      value={selectValue}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (selectConfig.allowOther && v === OTHER_OPTION_VALUE) {
                          setCustomHeaders((prev) => new Set(prev).add(header));
                          setValues((prev) => ({ ...prev, [header]: "" }));
                          return;
                        }
                        setCustomHeaders((prev) => {
                          if (!prev.has(header)) return prev;
                          const next = new Set(prev);
                          next.delete(header);
                          return next;
                        });
                        setValues((prev) => ({ ...prev, [header]: v }));
                      }}
                      disabled={saving || readOnly}
                      className={INPUT_CLASS}
                    >
                      <option value="">— เลือก —</option>
                      {selectConfig.options.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                      {legacyValue && <option value={legacyValue}>{legacyValue}</option>}
                      {selectConfig.allowOther && (
                        <option value={OTHER_OPTION_VALUE}>{OTHER_OPTION_LABEL}</option>
                      )}
                    </select>
                    {isCustom && (
                      <input
                        type="text"
                        value={currentValue}
                        onChange={(e) => setValues((prev) => ({ ...prev, [header]: e.target.value }))}
                        disabled={saving || readOnly}
                        placeholder="ระบุ..."
                        className={`${INPUT_CLASS} mt-1`}
                      />
                    )}
                  </label>
                );
              }

              // วันที่จัดซื้อ — a native date input gives a calendar picker
              // for free. A row's existing value only ever shows up here if
              // it's already exactly "YYYY-MM-DD" (what this picker itself
              // writes going forward); anything else the sheet has from
              // before this field existed as a date picker (e.g. "31/7/2026")
              // isn't guessable as day-first vs month-first without risking
              // silently swapping it wrong, so it's left as an untouched,
              // unmodified value — the box just shows blank until someone
              // picks a date, at which point it's saved cleanly from then on.
              const isDateField = Boolean(
                fields.purchaseDate && header.trim() === fields.purchaseDate.trim()
              );
              if (isDateField) {
                return (
                  <label key={header} className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-300">
                    {header}
                    <input
                      ref={i === firstEditableIndex ? (el) => { firstInputRef.current = el; } : undefined}
                      type="date"
                      value={currentValue}
                      onChange={(e) => setValues((prev) => ({ ...prev, [header]: e.target.value }))}
                      disabled={saving || readOnly}
                      className={INPUT_CLASS}
                    />
                  </label>
                );
              }

              return (
                <label key={header} className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-300">
                  {header}
                  <input
                    ref={i === firstEditableIndex ? (el) => { firstInputRef.current = el; } : undefined}
                    type="text"
                    value={currentValue}
                    onChange={(e) => setValues((prev) => ({ ...prev, [header]: e.target.value }))}
                    disabled={saving || readOnly}
                    placeholder={isTimestamp && mode === "add" ? "(บันทึกเวลาปัจจุบันอัตโนมัติ)" : undefined}
                    className={INPUT_CLASS}
                  />
                </label>
              );
            })}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="h-11 rounded-full border border-zinc-200 px-5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex h-11 items-center justify-center gap-2 rounded-full bg-[var(--brand)] px-5 text-sm font-medium text-[var(--brand-contrast)] transition-colors hover:bg-[var(--brand-strong)] disabled:opacity-60"
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
