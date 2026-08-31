"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export interface MultiSelectOption {
  value: string;
  /** Display text — defaults to `value` when omitted. */
  label?: string;
  count?: number;
}

/**
 * Checkbox-list dropdown — the shared multi-select control behind every
 * "choose one or more" picker in the app: the public dashboard's and
 * /manage's filter rows (combine totals across several departments or
 * equipment types at once), and MultiSelectField below (a form field whose
 * real-world answer can be more than one value, e.g. "ใช้งานได้หลายเหตุผล").
 * `selected` is a plain string[] rather than a Set so callers can keep it
 * in ordinary useState without extra plumbing.
 */
export default function MultiSelect({
  label,
  options,
  selected,
  onChange,
  allLabel = "ทั้งหมด",
  disabled = false,
  className = "",
}: {
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Text shown on the trigger when nothing is selected. */
  allLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // Escape should close only this dropdown, not any dialog it happens to
      // sit inside. A surrounding modal (EquipmentFormModal) closes itself on
      // Escape via a capture-phase listener on `document` — capture always
      // runs before bubble, so a same-target `document` listener here would
      // lose that race no matter the registration order. Listening on
      // `window` with capture:true wins it unconditionally, since `window`
      // precedes `document` in the capture path; stopPropagation then keeps
      // the event from ever reaching the modal's handler.
      e.stopPropagation();
      e.preventDefault();
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  function toggle(value: string) {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  }

  const summary =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? selected[0])
        : `เลือกแล้ว ${selected.length.toLocaleString("th-TH")} รายการ`;

  return (
    <div ref={rootRef} className={`relative flex flex-col gap-1 text-sm text-zinc-500 dark:text-zinc-400 ${className}`}>
      {label}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-11 items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-left text-base text-zinc-900 transition-colors hover:border-zinc-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:border-zinc-600 dark:disabled:bg-zinc-800/60 dark:disabled:text-zinc-500"
      >
        <span className="truncate">{summary}</span>
        <ChevronDown
          size={16}
          strokeWidth={2}
          className={`shrink-0 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {open && !disabled && (
        <div
          role="listbox"
          aria-multiselectable="true"
          className="absolute top-full left-0 z-20 mt-1 max-h-72 w-full min-w-[16rem] overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
        >
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mb-1 flex w-full items-center rounded-md px-2.5 py-1.5 text-sm text-zinc-500 transition-colors hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-700/60"
            >
              ล้างตัวเลือก
            </button>
          )}
          {options.map((opt) => {
            const isSelected = selected.includes(opt.value);
            return (
              <label
                key={opt.value}
                role="option"
                aria-selected={isSelected}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-700/60"
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    isSelected
                      ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--brand-contrast)]"
                      : "border-zinc-300 dark:border-zinc-600"
                  }`}
                  aria-hidden="true"
                >
                  {isSelected && <Check size={12} strokeWidth={3} />}
                </span>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={isSelected}
                  onChange={() => toggle(opt.value)}
                />
                <span className="flex-1 break-words">{opt.label ?? opt.value}</span>
                {typeof opt.count === "number" && (
                  <span className="shrink-0 text-xs text-zinc-400">({opt.count.toLocaleString("th-TH")})</span>
                )}
              </label>
            );
          })}
          {options.length === 0 && <p className="px-2.5 py-1.5 text-sm text-zinc-400">ไม่มีตัวเลือก</p>}
        </div>
      )}
    </div>
  );
}
