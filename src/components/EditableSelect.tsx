"use client";

import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";

const ADD_NEW_VALUE = "__add_new_option__";

/**
 * <select> dropdown whose option list can grow at runtime — built for the
 * PC spec fields that used to be free text but really only take a handful
 * of recurring real-world values (ความจุ RAM, ความเร็ว RAM, ประเภทหน่วย
 * จัดเก็บ — see PC_ONLY_FIELD_HEADERS indices 6/7/3 in lib/fields.ts,
 * wired up in BulkEditSpecModal.tsx and EquipmentFormModal.tsx). Ships with
 * a sensible starting list (DEFAULT_SPEC_STANDARDS.ramCapacityOptions etc.
 * in lib/specEvaluation.ts) but, unlike the fixed SELECT_FIELD_CONFIGS
 * dropdowns elsewhere in the app (คำนำหน้า, กลุ่มงาน, ...), any account
 * filling in this field can add a brand-new value right here — "เพิ่ม
 * ตัวเลือกใหม่" saves it back to the shared list (via `onAddOption`, see
 * /api/manage/spec-options) so it shows up as a normal choice for everyone
 * from then on, instead of only ever being typed fresh each time.
 *
 * A value already on the record that isn't (yet) in `options` — an older
 * row, or one entered before this became a dropdown — is still shown/kept
 * as its own option rather than silently replaced or hidden, same
 * "never lose a legacy value" rule SelectFieldConfig follows elsewhere.
 */
export default function EditableSelect({
  value,
  onChange,
  options,
  onAddOption,
  placeholder = "— เลือก —",
  addLabel = "+ เพิ่มตัวเลือกใหม่…",
  newValuePlaceholder = "พิมพ์ตัวเลือกใหม่",
  disabled = false,
  className = "",
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  /** Persists `value` into the shared option list. Resolves to
   * `{ ok: true }` on success; on failure resolves to `{ ok: false, error }`
   * with a message worth actually showing (e.g. "the SpecStandards tab
   * doesn't exist yet — create it first") — the control stays in "adding"
   * mode with that message shown inline, rather than a generic "failed, try
   * again" that hides *why* and leaves someone guessing. A network hiccup
   * or a permission error never silently drops what the person just typed
   * either way. */
  onAddOption: (value: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  placeholder?: string;
  addLabel?: string;
  newValuePlaceholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function commitDraft() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    const result = await onAddOption(trimmed);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onChange(trimmed);
    setAdding(false);
    setDraft("");
  }

  if (adding) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex gap-1.5">
          <input
            id={id}
            type="text"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitDraft();
              }
            }}
            disabled={saving}
            placeholder={newValuePlaceholder}
            className={className}
          />
          <button
            type="button"
            onClick={commitDraft}
            disabled={saving || !draft.trim()}
            aria-label="เพิ่มตัวเลือกนี้"
            title="เพิ่มตัวเลือกนี้"
            className="flex h-11 shrink-0 items-center justify-center rounded-lg border border-[var(--brand)] bg-[var(--brand)]/10 px-3 text-[var(--brand-strong)] transition-colors hover:bg-[var(--brand)]/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-emerald-300"
          >
            {saving ? (
              <Loader2 size={14} strokeWidth={2} className="animate-spin" aria-hidden="true" />
            ) : (
              <Check size={14} strokeWidth={2} aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setDraft("");
              setError(null);
            }}
            disabled={saving}
            aria-label="ยกเลิกการเพิ่มตัวเลือก"
            title="ยกเลิก"
            className="flex h-11 shrink-0 items-center justify-center rounded-lg border border-zinc-200 px-3 text-zinc-500 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <X size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        {error && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <select
      id={id}
      value={value}
      onChange={(e) => {
        if (e.target.value === ADD_NEW_VALUE) {
          setAdding(true);
          setDraft("");
          return;
        }
        onChange(e.target.value);
      }}
      disabled={disabled}
      className={className}
    >
      <option value="">{placeholder}</option>
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
      {value && !options.includes(value) && <option value={value}>{value}</option>}
      <option value={ADD_NEW_VALUE}>{addLabel}</option>
    </select>
  );
}
