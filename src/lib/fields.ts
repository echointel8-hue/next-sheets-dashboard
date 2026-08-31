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
  // เลขครุภัณฑ์โรงพยาบาล / เลขพัสดุ — คอลัมน์เดียวใช้ร่วมกันทุกประเภทครุภัณฑ์
  // (ไม่ได้แยกตามประเภทเหมือน ยี่ห้อ/รุ่น) ไม่ต้อง merge
  assetNumber: string | null;
  // วันที่จัดซื้อ — used only so EquipmentFormModal can render a native
  // <input type="date"> (calendar picker) for this one field instead of
  // a plain text box.
  purchaseDate: string | null;
  // สถานที่ / จุดติดตั้งอุปกรณ์ — shown in the /manage table next to
  // ยี่ห้อ/รุ่น, per the hospital's request.
  installLocation: string | null;
  position: string | null;
  // Full name is usually one combined form question, but some sheets split
  // title-prefix and ชื่อ-นามสกุล into two columns — support both shapes.
  fullNameHeader: string | null;
  titlePrefixHeader: string | null;
  nameHeader: string | null;
  // Soft-delete ("จำหน่าย") status column — not part of the original Google
  // Form, added later by the sheet owner for the /manage dispose feature.
  // null when the sheet doesn't have this column yet; everything treats
  // that as "every row is active" rather than failing.
  status: string | null;
  // The Google Form asks "ยี่ห้อ"/"รุ่น" as a *separate* question per
  // equipment type (branching logic), so the sheet ends up with one column
  // per type meaning the same thing — e.g. "ยี่ห้อ (System Manufacturer) -
  // C" for PC/Notebook and "... - P" for Printer. Every row only has one
  // of them filled in (whichever branch the submitter saw), so these are
  // kept as a list of candidate headers rather than a single one — see
  // getMergedValue() for how a row's actual value is picked out of the list.
  brand: string[];
  model: string[];
}

// Headers matching this are never a real data field — they're consent/legal
// notice text (Thai forms commonly bundle a PDPA consent question that
// *mentions* field names like "ชื่อ-นามสกุล" inside a long explanatory
// sentence, which would otherwise false-match the loose keyword patterns
// below). Exclude them up front so no field ever resolves to a consent box.
const NON_FIELD_HEADER = /ยินยอม|คำยินยอม|PDPA|พ\.?ร\.?บ\.?|ข้อมูลส่วนบุคคล|อนุญาตให้|รับทราบ/i;

/** True for the PDPA consent/policy question — never a real data field, so
 * the /manage add/edit form (EquipmentFormModal) hides it entirely rather
 * than offering an input for it. */
export function isConsentHeader(header: string): boolean {
  return NON_FIELD_HEADER.test(header);
}

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

/** Like findExact, but collects *every* matching header instead of
 * stopping at the first — for fields the Google Form splits into one
 * column per equipment type (see FieldMap.brand/model). */
function findAllExact(
  headers: string[],
  used: Set<string>,
  candidates: string[]
): string[] {
  const found: string[] = [];
  for (const h of headers) {
    if (used.has(h) || NON_FIELD_HEADER.test(h)) continue;
    if (candidates.some((c) => c.trim() === h.trim())) {
      used.add(h);
      found.push(h);
    }
  }
  return found;
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

  const assetNumber =
    findExact(headers, used, ["เลขครุภัณฑ์โรงพยาบาล / เลขพัสดุ"]) ??
    findPattern(headers, used, /เลขครุภัณฑ์|เลขพัสดุ/i);

  const purchaseDate =
    findExact(headers, used, ["วันที่จัดซื้อ"]) ??
    findPattern(headers, used, /วันที่จัดซื้อ|วันที่ซื้อ/i);

  const installLocation =
    findExact(headers, used, ["สถานที่ / จุดติดตั้งอุปกรณ์"]) ??
    findPattern(headers, used, /สถานที่[\s\S]*จุดติดตั้ง|จุดติดตั้ง/i);

  const position =
    findExact(headers, used, ["ตำแหน่งงาน"]) ??
    findPattern(headers, used, /ตำแหน่ง/i);

  const status =
    findExact(headers, used, ["สถานะ", "สถานะครุภัณฑ์"]) ??
    findPattern(headers, used, /^สถานะ/i);

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

  // "- C" (คอมพิวเตอร์/โน้ตบุ๊ก) และ "- P" (เครื่องพิมพ์) เป็นคนละคอลัมน์ในชีต
  // แต่ความหมายเดียวกัน — ชื่อคอลัมน์เต็มมาจากการสำรวจชีตจริงของโรงพยาบาล
  const brand = findAllExact(headers, used, [
    "ยี่ห้อ (System Manufacturer) - C",
    "ยี่ห้อ (System Manufacturer) - P",
  ]);

  const model = findAllExact(headers, used, [
    "รุ่น (System Model) - C",
    "รุ่น (System Model) - P",
  ]);

  return {
    timestamp,
    department,
    equipmentType,
    assetNumber,
    purchaseDate,
    installLocation,
    position,
    fullNameHeader,
    titlePrefixHeader,
    nameHeader,
    status,
    brand,
    model,
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

/** Picks the first non-empty value across a set of headers that all mean
 * the same thing but live in different sheet columns depending on
 * equipment type (see FieldMap.brand/model) — each row only has one of
 * them filled in, so there's no real ambiguity to resolve. */
export function getMergedValue(row: EquipmentRow, headers: string[]): string {
  for (const h of headers) {
    const v = (row[h] ?? "").trim();
    if (v) return v;
  }
  return "";
}

/** "ยี่ห้อ / รุ่น" combined into a single display string (e.g. "Dell /
 * OptiPlex 3090") — used only in /manage, to avoid spending two columns on
 * fields that are already split per equipment type. Falls back to
 * whichever half is present if the other is blank. */
export function getBrandModel(row: EquipmentRow, fields: FieldMap): string {
  const brand = getMergedValue(row, fields.brand);
  const model = getMergedValue(row, fields.model);
  if (brand && model) return `${brand} / ${model}`;
  return brand || model;
}

// Exact header text confirmed against the live Google Form/Sheet (survey
// done by hand — see project notes) — these control which spec fields
// src/components/EquipmentFormModal.tsx shows for each equipment type. The
// Google Form only ever asks the "- C" (คอมพิวเตอร์/โน้ตบุ๊ก) questions OR
// the "- P" (เครื่องพิมพ์) questions depending on branch, never both — so a
// row is either a PC/Notebook row or a Printer row, and the edit form
// should only expose the half that actually applies to that row.
export const PC_ONLY_FIELD_HEADERS = [
  "ยี่ห้อ (System Manufacturer) - C",
  "รุ่น (System Model) - C",
  "หน่วยประมวลผล (Processor)",
  "ประเภทของหน่วยจัดเก็บข้อมูล (Storage Type)",
  "ขนาดความจุรวมของพื้นที่จัดเก็บข้อมูล (Capacity)",
  "ประเภทของ RAM (RAM Type)",
  "ความจุของ RAM (RAM Capacity)",
  "ความเร็วของ RAM (RAM Speed)",
  "วัตถุประสงค์หลักในการใช้งานคอมพิวเตอร์ของคุณคืออะไร?",
];

export const PRINTER_ONLY_FIELD_HEADERS = [
  "ยี่ห้อ (System Manufacturer) - P",
  "รุ่น (System Model) - P",
  "ประเภทเครื่องพิมพ์",
];

// The Google Form's "ประเภทครุภัณฑ์" question is multiple-choice with
// exactly these options (kept in sync with the live sheet by hand — see
// project notes), so the /manage add/edit form offers the same fixed
// choices rather than a free-text box: typing the wrong wording there
// would silently hide the spec fields someone needs (see
// classifyEquipmentType). All-in-One counts as a PC for field-visibility
// purposes — it uses the same "- C" spec columns as Desktop/Notebook.
export const EQUIPMENT_TYPE_OPTIONS = [
  "ชุดคอมพิวเตอร์ตั้งโต๊ะ (Desktop PC)",
  "คอมพิวเตอร์พกพา (Notebook / Laptop)",
  "คอมพิวเตอร์แบบ All-in-One (AIO)",
  "เครื่องพิมพ์ / ปริ้นเตอร์ (Printer)",
];

// Fixed choice-lists for the other /manage form fields the hospital wants
// as dropdowns instead of free text, to keep entries consistent. Kept in
// sync with the actual Google Form choices by hand (there's no live API
// access from this dev environment to read them automatically).
export const TITLE_PREFIX_OPTIONS = ["นาย", "นางสาว", "นาง"];

export const DEPARTMENT_OPTIONS = [
  "กลุ่มงานการแพทย์",
  "กลุ่มงานการแพทย์แผนไทยและการแพทย์ทางเลือก",
  "กลุ่มงานจิตเวชและยาเสพติด",
  "กลุ่มงานทันตกรรม",
  "กลุ่มงานเทคนิคการแพทย์",
  "กลุ่มงานบริการด้านปฐมภูมิและองค์รวม",
  "กลุ่มงานบริหารทั่วไป",
  "กลุ่มงานประกันสุขภาพและกลุ่มงานสุขภาพดิจิทัล",
  "กลุ่มงานพยาบาล",
  "กลุ่มงานเภสัชกรรมและคุ้มครองผู้บริโภค",
  "กลุ่มงานรังสีวิทยา",
  "กลุ่มงานเวชกรรมฟื้นฟู",
  "งานการพยาบาลผู้ป่วยคลอด",
  "งานการพยาบาลผู้ป่วยนอก",
  "งานการพยาบาลผู้ป่วยใน",
  "งานการพยาบาลผู้ป่วยอุบัติเหตุฉุกเฉินและนิติเวช",
  "งานการพยาบาลหน่วยควบคุมการติดเชื้อและจ่ายกลาง",
  "งานแผนงานและยุทธศาสตร์และงานสื่อสารองค์กร",
];

export const COMPUTER_USAGE_OPTIONS = [
  "งานสำนักงานทั่วไป: เอกสาร, นำเสนอ, Excel พื้นฐาน, ประชุมออนไลน์ (Word, PPT, Zoom)",
  "งานประมวลผล / ข้อมูลหนัก: Excel ขั้นสูง (Macro/VBA), วิเคราะห์ข้อมูล, ฐานข้อมูล (Power BI, SQL)",
  "งานกราฟิก 2D / สื่อ: ออกแบบภาพ, ตกแต่งรูป, ทำสื่อสิ่งพิมพ์/โซเชียล (Photoshop, Illustrator, Canva)",
  "งานตัดต่อ / 3D / วิศวกรรม: ตัดต่อวิดีโอ, ขึ้นโมเดล 3D, เขียนแบบ (Premiere Pro, Maya, AutoCAD)",
  "งานพัฒนาระบบ / โปรแกรมเมอร์: เขียนโค้ด, Compile โปรแกรม, รัน Server/VM (VS Code, Docker)",
];

export const PRINTER_TYPE_OPTIONS = [
  "เครื่องพิมพ์เลเซอร์ (Laser Printer) - ขาวดำ",
  "เครื่องพิมพ์อิงค์เจ็ท/อิงค์แทงค์ (Inkjet / Ink Tank) - สี",
  "เครื่องพิมพ์ดอทแมทริกซ์ (Dot Matrix / หัวเข็ม) - ใช้พิมพ์กระดาษคาร์บอน/ใบเสร็จ",
  "เครื่องพิมพ์ความร้อน (Sticker Printer) - ใช้พิมพ์สติ๊กเกอร์ยา/ความร้อน",
  "เครื่องพิมพ์มัลติฟังก์ชัน (All-in-One: พิมพ์/สแกน/ถ่ายเอกสาร)",
];

/** Sentinel select-option value for "อื่นๆ (ระบุเอง)" — never itself saved
 * as the field's value; picking it just switches EquipmentFormModal to
 * show a free-text box instead. Deliberately not a plausible real answer
 * so it can never collide with actual data. */
export const OTHER_OPTION_VALUE = "__other__";
export const OTHER_OPTION_LABEL = "อื่นๆ (ระบุเอง)";

export interface SelectFieldConfig {
  /** Exact header text (matched via trim-equality) this applies to. */
  header: string;
  options: string[];
  /** Whether "อื่นๆ (ระบุเอง)" + a free-text fallback is offered. Off for
   * คำนำหน้า/กลุ่มงาน — those lists are meant to be exhaustive, so a
   * mismatch is more likely a wording drift worth catching than a genuine
   * new value (a legacy value not in the list is still preserved as an
   * extra option rather than silently dropped — see EquipmentFormModal). */
  allowOther: boolean;
}

export const SELECT_FIELD_CONFIGS: SelectFieldConfig[] = [
  { header: "คำนำหน้า", options: TITLE_PREFIX_OPTIONS, allowOther: false },
  { header: "ข้อมูลกลุ่มงาน / งานที่สังกัด", options: DEPARTMENT_OPTIONS, allowOther: false },
  {
    header: "วัตถุประสงค์หลักในการใช้งานคอมพิวเตอร์ของคุณคืออะไร?",
    options: COMPUTER_USAGE_OPTIONS,
    allowOther: true,
  },
  { header: "ประเภทเครื่องพิมพ์", options: PRINTER_TYPE_OPTIONS, allowOther: true },
];

/** Looks up the dropdown config for a header, if any — null means it stays
 * a plain text input. */
export function findSelectFieldConfig(header: string): SelectFieldConfig | null {
  const trimmed = header.trim();
  return SELECT_FIELD_CONFIGS.find((c) => c.header.trim() === trimmed) ?? null;
}

function headerIn(header: string, candidates: string[]): boolean {
  const trimmed = header.trim();
  return candidates.some((c) => c.trim() === trimmed);
}

/** True when a "ประเภทครุภัณฑ์" value looks like a printer. Matched loosely
 * (contains, not exact-string) so a historic row whose value doesn't
 * exactly match EQUIPMENT_TYPE_OPTIONS (e.g. predates this list) still
 * classifies correctly. */
export function isPrinterEquipmentType(value: string): boolean {
  return /เครื่องพิมพ์|ปริ้นเตอร์|printer/i.test(value);
}

/** "pc" | "printer" | null (nothing selected yet) — null means the
 * /manage form shows *neither* half of the PC/Printer-only spec fields,
 * so a blank "เพิ่มครุภัณฑ์ใหม่" starts out showing only the fields common
 * to every equipment type until the person actually picks a type. */
export function classifyEquipmentType(value: string): "pc" | "printer" | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return isPrinterEquipmentType(trimmed) ? "printer" : "pc";
}

/**
 * Which of a sheet's headers the /manage add/edit form should show, given
 * the row's current (possibly in-progress) "ประเภทครุภัณฑ์" value: every
 * header except the PDPA consent question, the สถานะ column (changed only
 * via the dedicated "จำหน่าย" action — never worth free-typing), and
 * whichever half of the PC/Printer-only spec fields doesn't apply (both
 * halves stay hidden until a type is actually picked). Order is preserved
 * from the sheet.
 */
export function visibleFormHeaders(
  headers: string[],
  fields: FieldMap,
  equipmentTypeValue: string
): string[] {
  const kind = classifyEquipmentType(equipmentTypeValue);
  return headers.filter((h) => {
    if (isConsentHeader(h)) return false;
    if (fields.status && h.trim() === fields.status.trim()) return false;
    if (headerIn(h, PC_ONLY_FIELD_HEADERS)) return kind === "pc";
    if (headerIn(h, PRINTER_ONLY_FIELD_HEADERS)) return kind === "printer";
    return true;
  });
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
    // Display-only label — shown as the table/card header. Kept distinct
    // from the header-matching patterns above (which still match against
    // the sheet's actual, longer Google Form question text) so this can
    // read cleanly without touching how the column is resolved.
    key: "fullName",
    label: "ผู้ใช้งาน / ผู้รับผิดชอบครุภัณฑ์",
  },
  { key: "equipmentType", label: "ประเภทครุภัณฑ์" },
];

const REDACTED_SURNAME = "xxxx";

/**
 * Masks the surname in a "title [+firstname] surname" string, e.g.
 * "นาย สมชาย ใจดี" -> "นาย สมชาย xxxx" or "นายสมชาย ใจดี" -> "นายสมชาย xxxx".
 * The surname is always the LAST space-separated token — some sheets have a
 * space between the title prefix and the first name, some don't, but the
 * surname is consistently last either way. Splitting on the *last* space
 * (not the first) keeps everything before it — title, and first name if
 * present — intact, and only masks that final token. A value with no space
 * doesn't fit that shape (e.g. a first-name-only entry), so it's left as-is
 * rather than guessed at.
 */
export function redactSurname(fullName: string): string {
  const trimmed = fullName.trim();
  const spaceIndex = trimmed.lastIndexOf(" ");
  if (spaceIndex === -1) return trimmed;
  return `${trimmed.slice(0, spaceIndex)} ${REDACTED_SURNAME}`;
}

// Values written into the status column — STATUS_DISPOSED by the /manage
// "จำหน่าย" action and STATUS_DELETED by the bootstrap-only "ลบรายการ"
// action (src/lib/sheets.ts setEquipmentStatus), everything else (including
// blank, for rows predating this column) treated as active.
export const STATUS_ACTIVE = "ใช้งาน";
export const STATUS_DISPOSED = "จำหน่ายแล้ว";
export const STATUS_DELETED = "ลบแล้ว";

/** True only when the status column exists and is explicitly "จำหน่ายแล้ว" —
 * a sheet with no status column yet, or a row with a blank/other value,
 * counts as active. */
export function isDisposed(row: EquipmentRow, fields: FieldMap): boolean {
  if (!fields.status) return false;
  return (row[fields.status] ?? "").trim() === STATUS_DISPOSED;
}

/** True only when the status column exists and is explicitly "ลบแล้ว" — set
 * only by the bootstrap superadmin's "ลบ" action. A deleted row is never
 * removed from the sheet (status is the only thing that changes), so it can
 * still be recovered by editing that one cell directly if needed — only the
 * app's own UI/API treats it as gone. */
export function isDeleted(row: EquipmentRow, fields: FieldMap): boolean {
  if (!fields.status) return false;
  return (row[fields.status] ?? "").trim() === STATUS_DELETED;
}

/** True when a row should be excluded from any listing or report —
 * disposed OR deleted. Prefer this over isDisposed alone anywhere the
 * question is "should this row be counted/shown at all". */
export function isHidden(row: EquipmentRow, fields: FieldMap): boolean {
  return isDisposed(row, fields) || isDeleted(row, fields);
}

export function getCellValue(
  row: EquipmentRow,
  key: ColumnKey,
  fields: FieldMap
): string {
  // Redacted here (not in getFullName) so getFullName stays available as
  // the raw accessor — getCellValue is what's actually wired into the
  // table/card display, so this is the one place that needs to mask PII.
  if (key === "fullName") return redactSurname(getFullName(row, fields));
  const header = fields[key];
  return header ? (row[header] ?? "").trim() : "";
}

/** เลขครุภัณฑ์ (assetNumber), shown stacked above the name in the public
 * dashboard's fullName cell — not its own DISPLAY_COLUMNS column, so a
 * sheet without this header just shows the name alone. */
export function getAssetNumber(row: EquipmentRow, fields: FieldMap): string {
  return fields.assetNumber ? (row[fields.assetNumber] ?? "").trim() : "";
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
