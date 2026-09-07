// Automatic "สเปกต่ำกว่ามาตรฐานปัจจุบัน" evaluation for the IT dashboard.
// Pure/no external deps (like fields.ts) so it's safe to import from client
// components — the badge shown in ITDashboard.tsx computes this in the
// browser from data it already has, without a round-trip to the server.
//
// This is one of *two* ways the hospital asked to flag a below-standard
// machine (see MaintenanceLogEntry.manualSpecStatus in lib/sheets.ts for the
// other): this file's evaluateSpec() is the automatic side, comparing a
// machine's already-recorded RAM/storage spec columns against the
// SpecStandards the IT team configures; the manual side is IT's own
// per-visit judgment call, logged alongside it. Neither overrides the
// other — the dashboard shows both and lets a manual "ปกติ" call visually
// take precedence over an automatic flag that turns out to be a parsing
// false-positive (free-text spec columns are never perfectly clean).

import { PC_ONLY_FIELD_HEADERS, type EquipmentRow } from "./fields";

/** The minimum PC spec the hospital currently considers acceptable. Kept
 * here (not lib/sheets.ts) so this stays importable from client components —
 * lib/sheets.ts re-exports both for convenience since that's where the
 * Google Sheets read/write for it (getSpecStandards/updateSpecStandards)
 * lives. */
export interface SpecStandards {
  /** Minimum acceptable RAM capacity, in GB, as a string (e.g. "8") — kept
   * as a string like every other settings value here; parsed to a number
   * only where it's actually compared, below. */
  minRamCapacityGb: string;
  /** Minimum acceptable RAM generation: "DDR2" | "DDR3" | "DDR4" | "DDR5". */
  minRamType: string;
  /** "true" | "false" — when "true", a machine whose storage type doesn't
   * mention SSD/NVMe counts as below standard. */
  requireSsd: string;
}

export const DEFAULT_SPEC_STANDARDS: SpecStandards = {
  minRamCapacityGb: "8",
  minRamType: "DDR4",
  requireSsd: "false",
};

const RAM_TYPE_RANK: Record<string, number> = {
  DDR: 1,
  DDR2: 2,
  DDR3: 3,
  DDR4: 4,
  DDR5: 5,
};

/** Pulls the first "DDRn" (or bare "DDR") token out of a free-text RAM-type
 * cell such as "DDR4 SO-DIMM" or "DDR3L 1600MHz" — case-insensitive, tolerant
 * of a trailing letter like the L in DDR3L. Returns null when nothing
 * DDR-shaped is found, so the caller can treat it as "unknown" instead of a
 * false failure. */
function parseRamTypeRank(raw: string): number | null {
  const match = raw.toUpperCase().match(/DDR\s*([2-5])?/);
  if (!match) return null;
  const generation = match[1] ? `DDR${match[1]}` : "DDR";
  return RAM_TYPE_RANK[generation] ?? null;
}

/** Pulls the first number out of a free-text RAM-capacity cell such as
 * "16GB", "16 GB", "16384 MB", or just "16" — assumed to already be GB
 * unless the text explicitly says MB, since every real-world answer here is
 * a GB figure written a dozen different ways. Returns null when no number
 * is found. */
function parseRamCapacityGb(raw: string): number | null {
  const text = raw.toUpperCase();
  const match = text.match(/([\d.]+)\s*(GB|MB)?/);
  if (!match) return null;
  const value = parseFloat(match[1]);
  if (Number.isNaN(value)) return null;
  return match[2] === "MB" ? value / 1024 : value;
}

function hasSsd(raw: string): boolean {
  return /SSD|NVME|M\.2/i.test(raw);
}

export interface SpecEvaluationInput {
  ramType: string;
  ramCapacity: string;
  storageType: string;
}

export interface SpecEvaluationResult {
  belowStandard: boolean;
  reasons: string[];
  /** True when there wasn't enough data (a blank or unparseable spec cell)
   * to make a confident call. Shown as its own "ไม่ทราบ" state in the
   * dashboard rather than silently reading as "ผ่านมาตรฐาน" — a blank spec
   * column should never quietly look fine. */
  unknown: boolean;
}

/** Compares one machine's already-recorded spec strings against the
 * hospital's configured SpecStandards. Free-text spec columns (this is a
 * Google Form, not a structured inventory system) mean parsing is
 * best-effort — see parseRamCapacityGb/parseRamTypeRank/hasSsd — so this
 * deliberately reports `unknown` rather than guessing when a cell doesn't
 * parse, instead of ever silently marking an unparseable machine as
 * passing. */
export function evaluateSpec(input: SpecEvaluationInput, standards: SpecStandards): SpecEvaluationResult {
  const reasons: string[] = [];
  let unknown = false;

  const minRamGb = parseFloat(standards.minRamCapacityGb);
  const actualRamGb = parseRamCapacityGb(input.ramCapacity);
  if (actualRamGb === null) {
    unknown = true;
  } else if (!Number.isNaN(minRamGb) && actualRamGb < minRamGb) {
    reasons.push(`RAM ${actualRamGb}GB ต่ำกว่ามาตรฐาน (ต้องการ ${standards.minRamCapacityGb}GB ขึ้นไป)`);
  }

  const minRamRank = RAM_TYPE_RANK[standards.minRamType.trim().toUpperCase()] ?? null;
  const actualRamRank = parseRamTypeRank(input.ramType);
  if (actualRamRank === null) {
    unknown = true;
  } else if (minRamRank !== null && actualRamRank < minRamRank) {
    reasons.push(`ประเภท RAM ต่ำกว่ามาตรฐาน (ต้องการ ${standards.minRamType} ขึ้นไป)`);
  }

  if (standards.requireSsd.trim().toLowerCase() === "true") {
    if (!input.storageType.trim()) {
      unknown = true;
    } else if (!hasSsd(input.storageType)) {
      reasons.push("หน่วยจัดเก็บข้อมูลไม่ใช่ SSD/NVMe");
    }
  }

  return { belowStandard: reasons.length > 0, reasons, unknown };
}

function findHeader(headers: string[], candidate: string): string | null {
  const target = candidate.trim();
  return headers.find((h) => h.trim() === target) ?? null;
}

function cell(row: EquipmentRow, headers: string[], candidate: string): string {
  const header = findHeader(headers, candidate);
  return header ? (row[header] ?? "").trim() : "";
}

/** Convenience wrapper for callers that have a raw sheet row + its header
 * list rather than already-extracted spec strings — resolves the PC spec
 * headers the same trim-equality way ITDashboard's spec columns do (see
 * PC_ONLY_FIELD_HEADERS indices 3/5/6: storage type, RAM type, RAM
 * capacity). Only meaningful for PC/Notebook/AIO rows — a printer row has no
 * RAM/storage columns to evaluate. */
export function evaluateRowSpec(row: EquipmentRow, headers: string[], standards: SpecStandards): SpecEvaluationResult {
  return evaluateSpec(
    {
      ramType: cell(row, headers, PC_ONLY_FIELD_HEADERS[5]),
      ramCapacity: cell(row, headers, PC_ONLY_FIELD_HEADERS[6]),
      storageType: cell(row, headers, PC_ONLY_FIELD_HEADERS[3]),
    },
    standards
  );
}
