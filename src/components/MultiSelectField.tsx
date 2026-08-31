"use client";

import { useState } from "react";
import MultiSelect from "@/components/MultiSelect";
import { joinMultiValue, splitMultiValue } from "@/lib/fields";

const OTHER_INPUT_CLASS =
  "h-11 rounded-lg border border-zinc-200 bg-white px-3 text-base text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:disabled:bg-zinc-800/60 dark:disabled:text-zinc-500";

/**
 * Checkbox-style multi-select for a single sheet cell that can genuinely
 * hold more than one answer (unlike คำนำหน้า/กลุ่มงาน/ประเภท, which stay
 * single-select native <select>s in EquipmentFormModal — those describe one
 * real-world fact, this one doesn't: "วัตถุประสงค์หลักในการใช้งานคอมพิวเตอร์"
 * is exactly the kind of question one person can have several true answers
 * to). The cell's stored text is a comma-joined list — the same shape a
 * Google Form checkbox question already writes into a sheet — so this reads
 * and writes plain strings; splitMultiValue/joinMultiValue is the only
 * place that convention lives.
 *
 * allowOther keeps working the same way it does for the single-select
 * fields: an extra "อื่นๆ (ระบุเอง)" checkbox reveals a free-text box, whose
 * text is appended into the joined list rather than replacing it — so
 * someone can pick two fixed options *and* add a custom one. A legacy value
 * that predates this option list (a token in the sheet that doesn't match
 * any fixed option) starts the free-text box pre-filled with that token
 * rather than silently dropping it.
 */
export default function MultiSelectField({
  label,
  options,
  allowOther,
  otherLabel = "อื่นๆ (ระบุเอง)",
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  options: string[];
  allowOther: boolean;
  otherLabel?: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const tokens = splitMultiValue(value, options);
  const knownSelected = tokens.filter((t) => options.includes(t));
  const customTokens = tokens.filter((t) => !options.includes(t));

  const [otherEnabled, setOtherEnabled] = useState(customTokens.length > 0);
  const [otherText, setOtherText] = useState(customTokens.join(", "));

  function commit(nextSelected: string[], nextOtherEnabled: boolean, nextOtherText: string) {
    const parts = [...nextSelected];
    const trimmed = nextOtherText.trim();
    if (nextOtherEnabled && trimmed) parts.push(trimmed);
    onChange(joinMultiValue(parts));
  }

  return (
    <div className="flex flex-col gap-1.5">
      <MultiSelect
        label={label}
        options={options.map((o) => ({ value: o }))}
        selected={knownSelected}
        onChange={(next) => commit(next, otherEnabled, otherText)}
        allLabel="— เลือก —"
        disabled={disabled}
      />
      {allowOther && (
        <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={otherEnabled}
            disabled={disabled}
            onChange={(e) => {
              const next = e.target.checked;
              setOtherEnabled(next);
              commit(knownSelected, next, otherText);
            }}
            className="h-4 w-4 rounded border-zinc-300 text-[var(--brand)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] dark:border-zinc-600"
          />
          {otherLabel}
        </label>
      )}
      {allowOther && otherEnabled && (
        <input
          type="text"
          value={otherText}
          disabled={disabled}
          onChange={(e) => {
            setOtherText(e.target.value);
            commit(knownSelected, otherEnabled, e.target.value);
          }}
          placeholder="ระบุ..."
          className={OTHER_INPUT_CLASS}
        />
      )}
    </div>
  );
}
