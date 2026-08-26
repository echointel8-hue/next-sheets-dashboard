// Maps the raw Google Form response columns onto the fixed set of fields
// this dashboard displays. Pure/no external deps so it's safe to import
// from client components (unlike lib/sheets.ts, which pulls in googleapis).

export interface EquipmentRow {
  [header: string]: string;
}

export interface FieldMap {
  timestamp: string | null;
  department: string | null;
  equipmentType: string | null;
  position: string | null;
  // Full name is usually one combined form question, but some sheets split
  // title-prefix and ชื่อ-นามสกุล into two columns — support both shapes.
  fullNameHeader: string | null;
  titlePrefixHeader: string | null;
  nameHeader: string | null;
}

// Headers matching this are never a real data field — they're consent/legal
// notice text (Thai forms commonly bundle a PDPA consent question that
// *mentions* field names like "ชื่อ-นามสกุล" inside a long explanatory
// sentence, which would otherwise false-match the loose keyword patterns
// below). Exclude them up front so no field ever resolves to a consent box.
const NON_FIELD_HEADER = /ยินยอม|คำยินยอม|PDPA|พ\.?ร\.?บ\.?|ข้อมูลส่วนบุคคล|อนุญาตให้|รับทราบ/i;

function findExact(
  headers: string[],
  used: Set<string>,
  candidates: string[]
): string | null {
  for (const h of headers) {
    if (used.has(h) || NON_FIELD_HEADER.test(h)) continue;
    if (candidates.some((c) => c.trim() === h.trim())) {
      used.add(h);
      return h;
    }
  }
  return null;
}

function findPattern(
  headers: string[],
  used: Set<string>,
  pattern: RegExp
): string | null {
  // Collect every candidate rather than stopping at the first hit, then
  // prefer the shortest one — a real question label ("ชื่อ-นามสกุล") is
  // short; a consent paragraph that happens to mention the same words is
  // long. This is a backstop on top of NON_FIELD_HEADER, not a replacement
  // for it.
  const matches = headers.filter(
    (h) => !used.has(h) && !NON_FIELD_HEADER.test(h) && pattern.test(h)
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => a.length - b.length);
  const chosen = matches[0];
  used.add(chosen);
  return chosen;
}

/**
 * Resolves the sheet's actual column headers (which are the literal Google
 * Form question text) onto the fields this dashboard needs. Tries an exact
 * match against the expected label first, then falls back to a looser
 * keyword pattern so small wording differences don't break the mapping.
 */
export function resolveFields(headers: string[]): FieldMap {
  const used = new Set<string>();

  const timestamp =
    findExact(headers, used, ["ประทับเวลา"]) ??
    findPattern(headers, used, /ประทับเวลา|timestamp/i);

  const department =
    findExact(headers, used, [
      "ข้อมูลกลุ่มงาน / งานที่สังกัด",
      "ข้อมูลกลุ่มงาน/งานที่สังกัด",
    ]) ?? findPattern(headers, used, /กลุ่มงาน|สังกัด/i);

  const equipmentType =
    findExact(headers, used, ["ประเภทครุภัณฑ์"]) ??
    findPattern(headers, used, /ประเภท[\s\S]*ครุภัณฑ์/i);

  const position =
    findExact(headers, used, ["ตำแหน่งงาน"]) ??
    findPattern(headers, used, /ตำแหน่ง/i);

  const fullNameHeader =
    findExact(headers, used, [
      "คำนำหน้า+ชื่อ-นามสกุล (ผู้ใช้งานหลัก / ผู้รับผิดชอบครุภัณฑ์)",
    ]) ?? findPattern(headers, used, /คำนำหน้า[\s\S]*ชื่อ[\s\S]*นามสกุล/i);

  let titlePrefixHeader: string | null = null;
  let nameHeader: string | null = null;
  if (!fullNameHeader) {
    titlePrefixHeader = findPattern(headers, used, /คำนำหน้า/i);
    nameHeader = findPattern(
      headers,
      used,
      /ชื่อ[\s-]*นามสกุล|ชื่อ[\s-]*สกุล/i
    );
  }

  return {
    timestamp,
    department,
    equipmentType,
    position,
    fullNameHeader,
    titlePrefixHeader,
    nameHeader,
  };
}

/** Renders the display name from whichever shape the sheet uses. */
export function getFullName(row: EquipmentRow, fields: FieldMap): string {
  if (fields.fullNameHeader) {
    return (row[fields.fullNameHeader] ?? "").trim();
  }
  const parts = [
    fields.titlePrefixHeader ? row[fields.titlePrefixHeader] : "",
    fields.nameHeader ? row[fields.nameHeader] : "",
  ]
    .map((s) => (s ?? "").trim())
    .filter(Boolean);
  return parts.join(" ");
}

export type ColumnKey =
  | "timestamp"
  | "department"
  | "fullName"
  | "position"
  | "equipmentType";

// "position" is intentionally left out of this list — the table/card view no
// longer displays ตำแหน่งงาน. resolveFields() above still detects the
// column (fields.position stays populated) so getCellValue("position", ...)
// keeps working if a future change wants it back; only the display list and
// the unresolved-columns check operate on DISPLAY_COLUMNS.
export const DISPLAY_COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: "timestamp", label: "ประทับเวลา" },
  { key: "department", label: "ข้อมูลกลุ่มงาน / งานที่สังกัด" },
  {
    key: "fullName",
    label: "คำนำหน้า+ชื่อ-นามสกุล (ผู้ใช้งานหลัก / ผู้รับผิดชอบครุภัณฑ์)",
  },
  { key: "equipmentType", label: "ประเภทครุภัณฑ์" },
];

export function getCellValue(
  row: EquipmentRow,
  key: ColumnKey,
  fields: FieldMap
): string {
  if (key === "fullName") return getFullName(row, fields);
  const header = fields[key];
  return header ? (row[header] ?? "").trim() : "";
}

/** Which display columns couldn't be matched to a header in the sheet. */
export function unresolvedColumns(fields: FieldMap): ColumnKey[] {
  const missing: ColumnKey[] = [];
  for (const { key } of DISPLAY_COLUMNS) {
    if (key === "fullName") {
      if (!fields.fullNameHeader && !fields.nameHeader) missing.push(key);
    } else if (!fields[key]) {
      missing.push(key);
    }
  }
  return missing;
}
