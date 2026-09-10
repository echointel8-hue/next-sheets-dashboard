import { randomUUID } from "crypto";
import { google } from "googleapis";
import { redactSurname, resolveFields, type EquipmentRow, type FieldMap } from "@/lib/fields";
import type { Role } from "@/lib/auth";
import { DEFAULT_SPEC_STANDARDS, type SpecStandards } from "@/lib/specEvaluation";
import { getLatestMaintenanceLogByAsset, type MaintenanceLogEntry } from "@/lib/maintenanceLog";

export type { EquipmentRow, FieldMap };
// Re-exported so existing callers can keep importing these types (and the
// spec-standards defaults) from lib/sheets, where the Google Sheets
// read/write for them lives — the definitions themselves live in the pure
// lib/specEvaluation.ts / lib/maintenanceLog.ts modules so those stay safely
// importable from client components (see each file's top comment). Server
// code should generally still prefer importing the read/write functions
// (getSpecStandards, getMaintenanceLog, etc.) from here.
export { DEFAULT_SPEC_STANDARDS, getLatestMaintenanceLogByAsset };
export type { SpecStandards, MaintenanceLogEntry };

// Each record pairs a row's data with its 1-based row number in the sheet
// (data row index + 2, accounting for the header row at row 1). This is the
// only stable identifier available — the sheet has no ID column of its own,
// since it's raw Google Form responses appended in submission order. The
// row-number identifies which physical sheet row an edit-back write targets.
export interface EquipmentRecord {
  rowNumber: number;
  data: EquipmentRow;
}

export interface SheetSnapshot {
  tab: string;
  headers: string[];
  rows: EquipmentRecord[];
  fields: FieldMap;
  fetchedAt: string;
}

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`ไม่พบตัวแปรสภาพแวดล้อม ${name} (ตรวจสอบไฟล์ .env.local)`);
  }
  return value;
}

function sheetsAuth() {
  const clientEmail = getEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = getEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n");

  return new google.auth.GoogleAuth({
    credentials: {
      client_email: clientEmail,
      private_key: privateKey,
    },
    // Read+write — the /manage area (add/edit/dispose equipment, manage
    // users) writes cells back, appends new rows, and appends to the
    // EditLog tab. The service account must be re-shared on the sheet as
    // Editor (not just Viewer) for this to work — a Viewer-shared sheet
    // will fail write calls with 403.
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

/**
 * Reads equipment data from the configured Google Sheet using a service
 * account. Set GOOGLE_SHEET_TAB in .env.local if your tab isn't "Sheet1".
 */
export async function getEquipmentData(): Promise<SheetSnapshot> {
  const spreadsheetId = getEnv("GOOGLE_SHEET_ID");
  const tab = process.env.GOOGLE_SHEET_TAB?.trim() || "Sheet1";
  const clientEmail = getEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");

  const sheets = google.sheets({ version: "v4", auth: sheetsAuth() });

  let values: string[][] | undefined;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tab}!A1:Z2000`,
    });
    values = res.data.values as string[][] | undefined;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Unable to parse range")) {
      throw new Error(
        `ไม่พบแท็บชื่อ "${tab}" ในสเปรดชีต — ตั้งค่า GOOGLE_SHEET_TAB ใน .env.local ให้ตรงกับชื่อแท็บจริง`
      );
    }
    if (message.includes("The caller does not have permission") || message.includes("403")) {
      throw new Error(
        `ไม่มีสิทธิ์เข้าถึงสเปรดชีต — เปิดสเปรดชีตแล้วแชร์ให้กับ ${clientEmail} (สิทธิ์ Editor เพื่อรองรับการแก้ไข)`
      );
    }
    throw new Error(`เชื่อมต่อ Google Sheets ไม่สำเร็จ: ${message}`);
  }

  if (!values || values.length === 0) {
    return {
      tab,
      headers: [],
      rows: [],
      fields: resolveFields([]),
      fetchedAt: new Date().toISOString(),
    };
  }

  const [headerRow, ...dataRows] = values;
  const headers = headerRow.map((h) => (h ?? "").toString().trim());

  const rows: EquipmentRecord[] = dataRows
    .map((r, i) => ({ r, rowNumber: i + 2 })) // +2: row 1 is the header, data starts at row 2
    .filter(({ r }) => r.some((cell) => (cell ?? "").toString().trim() !== ""))
    .map(({ r, rowNumber }) => {
      const row: EquipmentRow = {};
      headers.forEach((h, i) => {
        row[h || `column_${i + 1}`] = (r[i] ?? "").toString();
      });
      return { rowNumber, data: row };
    });

  const fields = resolveFields(headers);

  // Redact the responsible-person surname here, server-side, before this
  // data ever leaves the server. getCellValue() in fields.ts also masks it
  // again for display, but that alone still lets the true surname reach the
  // browser inside the page's RSC payload (visible via view-source or
  // devtools even though the rendered UI shows "xxxx"). Doing it on the raw
  // row means the real surname is never sent over the wire at all.
  //
  // The one exception is the /manage area: its routes call
  // getEquipmentDataUnredacted() below instead, after verifying a logged-in
  // session (src/lib/auth.ts) — never through this function or the public
  // /api/sheets route.
  const nameHeaderToRedact = fields.fullNameHeader ?? fields.nameHeader;
  if (nameHeaderToRedact) {
    for (const record of rows) {
      if (record.data[nameHeaderToRedact]) {
        record.data[nameHeaderToRedact] = redactSurname(record.data[nameHeaderToRedact]);
      }
    }
  }

  return {
    tab,
    headers,
    rows,
    fields,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Like getEquipmentData(), but skips the surname redaction — the raw values
 * exactly as they appear in the sheet. Only call this from a /manage route
 * that has already verified a logged-in session (src/lib/auth.ts); never
 * expose it through an unauthenticated endpoint.
 */
export async function getEquipmentDataUnredacted(): Promise<SheetSnapshot> {
  const spreadsheetId = getEnv("GOOGLE_SHEET_ID");
  const tab = process.env.GOOGLE_SHEET_TAB?.trim() || "Sheet1";
  const clientEmail = getEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");

  const sheets = google.sheets({ version: "v4", auth: sheetsAuth() });

  let values: string[][] | undefined;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tab}!A1:Z2000`,
    });
    values = res.data.values as string[][] | undefined;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("The caller does not have permission") || message.includes("403")) {
      throw new Error(
        `ไม่มีสิทธิ์เข้าถึงสเปรดชีต — เปิดสเปรดชีตแล้วแชร์ให้กับ ${clientEmail} (สิทธิ์ Editor)`
      );
    }
    throw new Error(`เชื่อมต่อ Google Sheets ไม่สำเร็จ: ${message}`);
  }

  if (!values || values.length === 0) {
    return { tab, headers: [], rows: [], fields: resolveFields([]), fetchedAt: new Date().toISOString() };
  }

  const [headerRow, ...dataRows] = values;
  const headers = headerRow.map((h) => (h ?? "").toString().trim());

  const rows: EquipmentRecord[] = dataRows
    .map((r, i) => ({ r, rowNumber: i + 2 }))
    .filter(({ r }) => r.some((cell) => (cell ?? "").toString().trim() !== ""))
    .map(({ r, rowNumber }) => {
      const row: EquipmentRow = {};
      headers.forEach((h, i) => {
        row[h || `column_${i + 1}`] = (r[i] ?? "").toString();
      });
      return { rowNumber, data: row };
    });

  return { tab, headers, rows, fields: resolveFields(headers), fetchedAt: new Date().toISOString() };
}

/**
 * Writes a full row of values back to the sheet at the given row number, in
 * header order. Used by the /manage routes only, after the caller has
 * verified a logged-in session and (for an admin session) that the row's
 * department matches the session's own department.
 */
export async function updateEquipmentRow(
  rowNumber: number,
  headers: string[],
  values: Record<string, string>
): Promise<void> {
  const spreadsheetId = getEnv("GOOGLE_SHEET_ID");
  const tab = process.env.GOOGLE_SHEET_TAB?.trim() || "Sheet1";
  const sheets = google.sheets({ version: "v4", auth: sheetsAuth() });

  const orderedValues = headers.map((h) => values[h] ?? "");
  const lastColLetter = columnLetter(headers.length);

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tab}!A${rowNumber}:${lastColLetter}${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [orderedValues] },
  });
}

export type EditLogAction =
  | "แก้ไข"
  // Distinguishes the narrow "it"-role correction (installLocation /
  // responsible-person only, from /manage/it/report) from a regular
  // admin/superadmin edit in the audit trail — see
  // /api/manage/it/records/[rowNumber] for the only place this is used.
  | "แก้ไข (IT)"
  | "เพิ่มใหม่"
  | "จำหน่าย"
  | "ยกเลิกการจำหน่าย"
  | "ลบรายการ"
  | "จัดการผู้ใช้"
  | "เข้าสู่ระบบสำเร็จ"
  | "เข้าสู่ระบบล้มเหลว"
  | "ออกจากระบบ";

/** Appends one row to the EditLog tab — header row (created ahead of time
 * by the sheet owner, not by this app; see the project setup notes) must be:
 * เวลา | การกระทำ | ผู้ทำรายการ | กลุ่มงาน | แถวที่ | คอลัมน์ | ค่าเดิม | ค่าใหม่
 * rowNumber/column are blank for row-level actions (เพิ่มใหม่/จำหน่าย) or
 * user-management actions that don't target one equipment column. */
export async function appendEditLog(entry: {
  timestamp: string;
  action: EditLogAction;
  actor: string;
  department: string;
  rowNumber?: number;
  column?: string;
  oldValue: string;
  newValue: string;
}): Promise<void> {
  const spreadsheetId = getEnv("GOOGLE_SHEET_ID");
  const logTab = process.env.GOOGLE_SHEET_EDIT_LOG_TAB?.trim() || "EditLog";
  const sheets = google.sheets({ version: "v4", auth: sheetsAuth() });

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${logTab}!A1`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[
        entry.timestamp,
        entry.action,
        entry.actor,
        entry.department,
        entry.rowNumber != null ? String(entry.rowNumber) : "",
        entry.column ?? "",
        entry.oldValue,
        entry.newValue,
      ]],
    },
  });
}

// ---------------------------------------------------------------------------
// Users tab — accounts for the /manage area. Only a password hash is ever
// stored here (see src/lib/auth.ts hashPassword/verifyPassword); superadmins
// manage rows through the /manage/users UI, not by hand-editing the sheet.
// Header row (created ahead of time by the sheet owner): Username |
// PasswordHash | Role | Department | DisplayName | Active
// ---------------------------------------------------------------------------

export interface UserRecord {
  rowNumber: number;
  username: string;
  passwordHash: string;
  role: Role;
  department: string;
  displayName: string;
  active: boolean;
}

/** Parses the Role column's raw text, defaulting to the most restrictive
 * role ("admin") for anything unrecognized — e.g. a blank cell, or a typo
 * hand-edited into the sheet — rather than silently granting broader
 * access than intended. */
function parseRole(raw: string): Role {
  const trimmed = raw.trim();
  if (trimmed === "superadmin") return "superadmin";
  if (trimmed === "it") return "it";
  return "admin";
}

function parseActive(raw: string): boolean {
  const v = raw.trim().toUpperCase();
  // Blank counts as active — a Users tab where nobody bothered filling in
  // the Active column shouldn't silently lock everyone out.
  return v !== "N" && v !== "NO" && v !== "FALSE" && v !== "0";
}

function getUsersTab(): string {
  return process.env.GOOGLE_SHEET_USERS_TAB?.trim() || "Users";
}

export async function getUsers(): Promise<UserRecord[]> {
  const spreadsheetId = getEnv("GOOGLE_SHEET_ID");
  const usersTab = getUsersTab();
  const sheets = google.sheets({ version: "v4", auth: sheetsAuth() });

  let values: string[][] | undefined;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${usersTab}!A2:F1000`, // skip header row (row 1)
    });
    values = res.data.values as string[][] | undefined;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Unable to parse range")) {
      throw new Error(
        `ไม่พบแท็บชื่อ "${usersTab}" ในสเปรดชีต — สร้างแท็บนี้ก่อน (ดูรายละเอียดใน README) หรือตั้งค่า GOOGLE_SHEET_USERS_TAB ให้ตรงกับชื่อแท็บจริง`
      );
    }
    throw new Error(`อ่านรายชื่อผู้ใช้ไม่สำเร็จ: ${message}`);
  }

  return (values ?? [])
    .map((r, i) => ({ r, rowNumber: i + 2 }))
    .filter(({ r }) => (r[0] ?? "").toString().trim() !== "")
    .map(({ r, rowNumber }) => ({
      rowNumber,
      username: (r[0] ?? "").toString().trim(),
      passwordHash: (r[1] ?? "").toString().trim(),
      role: parseRole((r[2] ?? "").toString()),
      department: (r[3] ?? "").toString().trim(),
      displayName: (r[4] ?? "").toString().trim(),
      active: parseActive((r[5] ?? "").toString()),
    }));
}

export async function addUser(user: {
  username: string;
  passwordHash: string;
  role: Role;
  department: string;
  displayName: string;
}): Promise<void> {
  const spreadsheetId = getEnv("GOOGLE_SHEET_ID");
  const usersTab = getUsersTab();
  const sheets = google.sheets({ version: "v4", auth: sheetsAuth() });

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${usersTab}!A1`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[
        user.username,
        user.passwordHash,
        user.role,
        user.department,
        user.displayName,
        "Y",
      ]],
    },
  });
}

/** Updates the row for `username` (only the fields present in `updates`).
 * Looks the row up by scanning getUsers() rather than trusting a cached row
 * number, since the Users tab is small and can be hand-edited (e.g. an
 * emergency Active=N) between calls. */
export async function updateUser(
  username: string,
  updates: Partial<Pick<UserRecord, "passwordHash" | "role" | "department" | "displayName" | "active">>
): Promise<UserRecord> {
  const users = await getUsers();
  const existing = users.find((u) => u.username === username);
  if (!existing) {
    throw new Error(`ไม่พบผู้ใช้ "${username}" ในแท็บ ${getUsersTab()}`);
  }
  const merged: UserRecord = { ...existing, ...updates };

  const spreadsheetId = getEnv("GOOGLE_SHEET_ID");
  const usersTab = getUsersTab();
  const sheets = google.sheets({ version: "v4", auth: sheetsAuth() });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${usersTab}!A${merged.rowNumber}:F${merged.rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        merged.username,
        merged.passwordHash,
        merged.role,
        merged.department,
        merged.displayName,
        merged.active ? "Y" : "N",
      ]],
    },
  });

  return merged;
}

// ---------------------------------------------------------------------------
// ReportSettings tab — the handful of fixed text pieces that appear on a
// printed report (see /manage/it) but change independently of the app's
// code: the org name, a report's title, and who signs as "ผู้รับทราบ" on
// the maintenance form. Stored as plain key/value rows (Key | Value,
// starting row 2) rather than one column per setting, so adding a new
// setting later never means widening the sheet.
//
// This tab is NOT created by this app — like Users/EditLog, the sheet
// owner creates it by hand (see project setup notes) before anyone edits
// settings through /manage/it. Reading gracefully falls back to
// DEFAULT_REPORT_SETTINGS when the tab doesn't exist yet (or a key isn't
// in it) so the report generator still works with sensible text out of
// the box; only *writing* an edited value requires the tab to actually
// exist, and fails with a clear "create it first" message if it doesn't.
// ---------------------------------------------------------------------------

export interface ReportSettings {
  orgName: string;
  maintenanceFormTitle: string;
  fiscalYearLabel: string;
  acknowledgerName: string;
  acknowledgerPosition: string;
  acknowledgerDepartment: string;
  /** Font size (in pt — the unit print layouts are conventionally sized
   * in, unlike on-screen px/rem) for the printed form's general body text:
   * the "ข้อมูลครุภัณฑ์ที่ดำเนินการบำรุงรักษา" section heading, and the
   * วันที่ดำเนินการ/ช่วงเวลา/ผู้ดำเนินการ + signature block below the
   * table — i.e. everything on the page that ISN'T the header (see
   * printHeaderFontSizePt below, its own separate control) or the
   * equipment table itself (see printTableFontSizePx, likewise separate).
   * Shown in the settings UI as just "ขนาดตัวอักษรภาพรวม" now that all
   * three areas have their own control. Stored as a string, same
   * plain-text handling as every other field here — parsed with a
   * fallback at render time (see MaintenanceReportBuilder's
   * printBodyFontSizePt) so a blank or hand-edited non-numeric cell never
   * breaks the page. */
  printFontSizePt: string;
  /** Font size (in pt) for the printed form's header block: หน่วยงาน,
   * ชื่อแบบฟอร์ม, ปีงบประมาณ, and (when set) กลุ่มงาน — all four lines
   * share this one size rather than each having its own control; หน่วยงาน
   * /ชื่อแบบฟอร์ม stay bold and ปีงบประมาณ/กลุ่มงาน stay regular weight,
   * same as before, only the size became adjustable. Kept separate from
   * printFontSizePt (the rest of the page's body text) since a hospital
   * wanting a more prominent — or more compact — header shouldn't have to
   * resize the whole form to do it. Stored as a string, same plain-text
   * handling as every other field here — parsed with a fallback at
   * render time (see MaintenanceReportBuilder's printHeaderFontSizePt) so
   * a blank or hand-edited non-numeric cell never breaks the page. */
  printHeaderFontSizePt: string;
  /** Base font size (in px, not pt — the equipment table's columns are
   * laid out in px so its three internal sizes can stay in fixed
   * proportion to each other, see below) for the printed equipment table:
   * the ลำดับ/รายการครุภัณฑ์/ผู้รับผิดชอบครุภัณฑ์ columns sit at exactly
   * this size, while the smaller sub-details (หมายเลขครุภัณฑ์, the
   * ยี่ห้อ/รุ่น and กลุ่มงาน sub-lines, การดำเนินการ checkboxes, and
   * ผลการตรวจสอบโดย IT checkboxes) are derived from it at render time
   * (see MaintenanceReportBuilder's printTableFontSizePx) so raising or
   * lowering this one number scales the whole table together instead of
   * needing five separate settings. Kept separate from printFontSizePt
   * above (and from the table entirely on purpose) since this table was
   * originally, and still needs to stay, small enough to keep the whole
   * printed list on one page — too large a value here risks the table
   * spilling onto a second page for a report with many selected items.
   * Stored as a string, same plain-text handling as every other field
   * here. */
  printTableFontSizePx: string;
  /** Letter-spacing (in px — CSS letter-spacing accepts the same units as
   * font-size, and px keeps this consistent with printTableFontSizePx
   * rather than mixing in yet another unit) applied to the whole printed
   * form at once — header, table, and body text together — via the
   * print-area container's own inline style (see
   * MaintenanceReportBuilder's print-area div), same "whole page" scope
   * the now-removed printFontFamily setting used to have. A small
   * positive value can help a dense Thai form breathe a bit; a small
   * negative value can claw back a bit of horizontal room. Stored as a
   * string, same plain-text handling as every other field here — parsed
   * with a fallback at render time (see MaintenanceReportBuilder's
   * printLetterSpacingPx) so a blank or hand-edited non-numeric cell
   * never breaks the page. */
  printLetterSpacingPx: string;
  /** Checklist items shown under the "การดำเนินการ" column of a printed
   * maintenance report — editable by the hospital instead of hard-coded,
   * since this list is expected to grow (today just "บำรุงรักษา", later
   * maybe "อัพเดทโปรแกรม Hosxp 3 เป็นเวอร์ชัน ...."). Stored as a JSON
   * array in the Value cell — see the special-cased handling in
   * getReportSettings/updateReportSettings below, since every other
   * setting here is a plain string. */
  actionOptions: string[];
  /** Exact text of any actionOptions entries that are currently "ซ่อน"
   * (hidden) — hidden entries disappear from every place IT actually
   * *picks* an action (the report page's "เลือกรายการที่จะดำเนินการ"
   * chips, the printed form, and the "อัปเดตสถานะงาน" checklist on
   * /manage/it/tasks) but stay in actionOptions itself, at their original
   * array index, so they can be unhidden and reused later without
   * shifting any other entry's position — see buildActionColorMap
   * (lib/actionColors), which assigns colors by array index and would
   * otherwise silently reassign every later entry's color, desyncing
   * already-printed reports and saved task records from their original
   * color. Stored as a JSON array, same as actionOptions. */
  hiddenActionOptions: string[];
}

// Matches the attached example form exactly, so a hospital that never
// touches the settings screen still gets a correct-looking report.
export const DEFAULT_REPORT_SETTINGS: ReportSettings = {
  orgName: "โรงพยาบาลท่าตะเกียบ",
  maintenanceFormTitle: "แบบฟอร์มการบำรุงรักษาเชิงป้องกันเครื่องคอมพิวเตอร์และครุภัณฑ์คอมพิวเตอร์",
  fiscalYearLabel: "ประจำปีงบประมาณ 2569",
  acknowledgerName: "นางขนัญธร เสียงล้ำ",
  acknowledgerPosition: "เจ้าพนักงานเวชสถิติชำนาญงาน",
  acknowledgerDepartment: "กลุ่มงานประกันสุขภาพและกลุ่มงานสุขภาพดิจิทัล",
  printFontSizePt: "14",
  printHeaderFontSizePt: "16",
  printTableFontSizePx: "11",
  printLetterSpacingPx: "0",
  actionOptions: ["บำรุงรักษา"],
  hiddenActionOptions: [],
};

// Fixed key order — also what updateReportSettings writes back, so the
// tab's row order stays stable across edits instead of depending on
// whatever order a partial update happened to touch keys in.
const REPORT_SETTINGS_KEYS = Object.keys(DEFAULT_REPORT_SETTINGS) as (keyof ReportSettings)[];

function getReportSettingsTab(): string {
  return process.env.GOOGLE_SHEET_REPORT_SETTINGS_TAB?.trim() || "ReportSettings";
}

export async function getReportSettings(): Promise<ReportSettings> {
  const spreadsheetId = getEnv("GOOGLE_SHEET_ID");
  const tab = getReportSettingsTab();
  const sheets = google.sheets({ version: "v4", auth: sheetsAuth() });

  let values: string[][] | undefined;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tab}!A2:B200`,
    });
    values = res.data.values as string[][] | undefined;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Unable to parse range")) {
      // Tab doesn't exist yet — every setting falls back to its default.
      return { ...DEFAULT_REPORT_SETTINGS };
    }
    throw new Error(`อ่านการตั้งค่ารายงานไม่สำเร็จ: ${message}`);
  }

  const stored = new Map<string, string>();
  for (const row of values ?? []) {
    const key = (row[0] ?? "").toString().trim();
    if (key) stored.set(key, (row[1] ?? "").toString());
  }

  const result: ReportSettings = {
    ...DEFAULT_REPORT_SETTINGS,
    actionOptions: [...DEFAULT_REPORT_SETTINGS.actionOptions],
    hiddenActionOptions: [...DEFAULT_REPORT_SETTINGS.hiddenActionOptions],
  };
  for (const key of REPORT_SETTINGS_KEYS) {
    const v = stored.get(key);
    if (v === undefined || v.trim() === "") continue;
    if (key === "actionOptions" || key === "hiddenActionOptions") {
      // JSON array, not plain text — see the interface comment above.
      try {
        const parsed: unknown = JSON.parse(v);
        if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
          // actionOptions must never end up empty (nothing to print/pick
          // from) — hiddenActionOptions has no such floor, an empty array
          // just means "nothing hidden right now".
          if (key === "actionOptions") {
            if (parsed.length > 0) result.actionOptions = parsed as string[];
          } else {
            result.hiddenActionOptions = parsed as string[];
          }
        }
      } catch {
        // Malformed cell (hand-edited?) — keep the default rather than crash.
      }
      continue;
    }
    result[key] = v;
  }
  return result;
}

/** Merges `updates` into the current settings and rewrites the whole
 * tab in the fixed REPORT_SETTINGS_KEYS order. Throws (with a
 * create-the-tab-first message) if the tab doesn't exist — unlike
 * getReportSettings, there's nothing sensible to fall back to for a
 * *write*. */
export async function updateReportSettings(updates: Partial<ReportSettings>): Promise<ReportSettings> {
  const current = await getReportSettings();
  const merged: ReportSettings = { ...current, ...updates };

  const spreadsheetId = getEnv("GOOGLE_SHEET_ID");
  const tab = getReportSettingsTab();
  const sheets = google.sheets({ version: "v4", auth: sheetsAuth() });

  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tab}!A2:B${1 + REPORT_SETTINGS_KEYS.length}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: REPORT_SETTINGS_KEYS.map((key) => {
          if (key === "actionOptions") return [key, JSON.stringify(merged.actionOptions)];
          if (key === "hiddenActionOptions") return [key, JSON.stringify(merged.hiddenActionOptions)];
          return [key, merged[key]];
        }),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Unable to parse range")) {
      throw new Error(
        `ยังไม่พบแท็บชื่อ "${tab}" ในสเปรดชีต — สร้างแท็บนี้ก่อน (หัวตาราง: Key | Value) หรือตั้งค่า GOOGLE_SHEET_REPORT_SETTINGS_TAB ให้ตรงกับชื่อแท็บจริง`
      );
    }
    throw new Error(`บันทึกการตั้งค่ารายงานไม่สำเร็จ: ${message}`);
  }

  return merged;
}

// ---------------------------------------------------------------------------
// MaintenanceLog tab — the IT dashboard's per-machine service history
// (/manage/it): every time IT services a computer they append one row here
// instead of overwriting a single "current status" cell, so the full
// history (every software/version update, every "เป่าฝุ่น" cleaning visit)
// stays visible, not just the latest one. A machine's *current* status —
// shown in the IT dashboard's spec tables — is simply whichever row has the
// newest timestamp for that เลขครุภัณฑ์; see getLatestMaintenanceLogByAsset.
//
// "ซอฟต์แวร์ที่ติดตั้ง/อัปเดต" is deliberately free-form ("HOSxP 3: 3.2.6;
// HOSxP 4: 4.1.0") rather than fixed HOSxP-3/HOSxP-4 columns — the hospital
// asked for room to track other software later without a schema change.
// joinSoftwareEntries/splitSoftwareEntries (fields.ts) are the only code
// that needs to understand this string's shape.
//
// Same manually-created-tab convention as ReportSettings/Users/EditLog: the
// sheet owner creates this tab by hand (see project setup notes) before
// anyone logs a maintenance visit. Reading tolerates a missing tab (just
// means "no history yet"); appending requires the tab to already exist.
// ---------------------------------------------------------------------------

// MaintenanceLogEntry / getLatestMaintenanceLogByAsset themselves are
// defined in lib/maintenanceLog.ts and re-exported above.

function getMaintenanceLogTab(): string {
  return process.env.GOOGLE_SHEET_MAINTENANCE_LOG_TAB?.trim() || "MaintenanceLog";
}

const MAINTENANCE_LOG_COLUMNS = 7; // timestamp, assetNumber, recordedBy, software, maintenanceDate, manualSpecStatus, notes

function parseManualSpecStatus(raw: string): MaintenanceLogEntry["manualSpecStatus"] {
  const trimmed = raw.trim();
  return trimmed === "ปกติ" || trimmed === "ต่ำกว่ามาตรฐาน" ? trimmed : "";
}

/** Every logged maintenance visit, oldest first (append order) — callers
 * that want "current status per asset" should use
 * getLatestMaintenanceLogByAsset instead of re-deriving it themselves. */
export async function getMaintenanceLog(): Promise<MaintenanceLogEntry[]> {
  const spreadsheetId = getEnv("GOOGLE_SHEET_ID");
  const tab = getMaintenanceLogTab();
  const sheets = google.sheets({ version: "v4", auth: sheetsAuth() });

  let values: string[][] | undefined;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tab}!A2:G100000`,
    });
    values = res.data.values as string[][] | undefined;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Unable to parse range")) {
      // Tab doesn't exist yet — no maintenance history recorded anywhere.
      return [];
    }
    throw new Error(`อ่านประวัติการบำรุงรักษาไม่สำเร็จ: ${message}`);
  }

  return (values ?? [])
    .filter((row) => (row[1] ?? "").toString().trim()) // must have an asset number
    .map((row) => ({
      timestamp: (row[0] ?? "").toString(),
      assetNumber: (row[1] ?? "").toString().trim(),
      recordedBy: (row[2] ?? "").toString(),
      software: (row[3] ?? "").toString(),
      maintenanceDate: (row[4] ?? "").toString(),
      manualSpecStatus: parseManualSpecStatus((row[5] ?? "").toString()),
      notes: (row[6] ?? "").toString(),
    }));
}

/** Appends one maintenance-visit row. Throws a clear "create the tab
 * first" error if GOOGLE_SHEET_MAINTENANCE_LOG_TAB / "MaintenanceLog"
 * doesn't exist — same convention as appendEditLog. */
export async function appendMaintenanceLogEntry(
  entry: Omit<MaintenanceLogEntry, "timestamp"> & { timestamp?: string }
): Promise<void> {
  const spreadsheetId = getEnv("GOOGLE_SHEET_ID");
  const tab = getMaintenanceLogTab();
  const sheets = google.sheets({ version: "v4", auth: sheetsAuth() });
  const timestamp = entry.timestamp ?? new Date().toISOString();

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${tab}!A1`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[
          timestamp,
          entry.assetNumber,
          entry.recordedBy,
          entry.software,
          entry.maintenanceDate,
          entry.manualSpecStatus,
          entry.notes,
        ]],
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Unable to parse range")) {
      throw new Error(
        `ยังไม่พบแท็บชื่อ "${tab}" ในสเปรดชีต — สร้างแท็บนี้ก่อน (หัวตาราง: เวลา | เลขครุภัณฑ์ | ผู้บันทึก | ซอฟต์แวร์ที่ติดตั้ง/อัปเดต | วันที่บำรุงรักษา | ประเมินสเปกด้วยตนเอง | หมายเหตุ) หรือตั้งค่า GOOGLE_SHEET_MAINTENANCE_LOG_TAB ให้ตรงกับชื่อแท็บจริง`
      );
    }
    throw new Error(`บันทึกประวัติการบำรุงรักษาไม่สำเร็จ: ${message}`);
  }
  void MAINTENANCE_LOG_COLUMNS; // referenced for documentation/consistency only
}

// ---------------------------------------------------------------------------
// MaintenanceTasks tab — one mutable row per "IT is working on this piece
// of equipment right now" task, created automatically when an IT account
// prints a maintenance report from /manage/it/report (see
// createMaintenanceTasks, called from the report page's print button) and
// later filled in / closed from /manage/it/tasks (see updateMaintenanceTask).
// Unlike MaintenanceLog/EditLog above, this tab is NOT append-only — a task
// row gets read back and overwritten in place as its status changes from
// "in_progress" to "done", the same read-all/find-row/write-one-row pattern
// as updateUser() uses for the Users tab. TaskId (a random UUID, not the row
// number) is the stable identifier a client holds onto across that update,
// since the physical sheet row can shift if someone else's task is
// inserted/removed in between.
//
// ActionsTaken and InspectionChecks are small string arrays (checked items
// from the printed form's checklists) stored as a JSON string in one cell —
// same convention as ReportSettings.actionOptions above.
//
// Same manually-created-tab convention as every other tab here: the sheet
// owner creates it by hand before anyone prints a report. Reading tolerates
// a missing tab (just means "no tasks yet"); writing requires it to exist.
// ---------------------------------------------------------------------------

export type MaintenanceTaskStatus = "in_progress" | "done";
export type InspectionCheck = "ปกติ" | "ส่งซ่อม" | "เปลี่ยนอะไหล่" | "อื่นๆ";

export interface MaintenanceTask {
  taskId: string;
  createdAt: string;
  /** The equipment row's own sheet row number at the time the task was
   * created — kept for reference/audit only. Everything the task list and
   * dashboard actually display is snapshotted onto this row below, so
   * neither view needs to re-join against the live equipment sheet. */
  equipmentRowNumber: number;
  assetNumber: string;
  equipmentType: string;
  brandModel: string;
  department: string;
  location: string;
  assignedToUsername: string;
  assignedToDisplayName: string;
  status: MaintenanceTaskStatus;
  actionsTaken: string[];
  inspectionChecks: InspectionCheck[];
  /** Free text for the "เปลี่ยนอะไหล่ ...." blank on the printed form. */
  partsChanged: string;
  /** Free text for the "อื่นๆ ระบุ ...." blank on the printed form. */
  otherDetail: string;
  notes: string;
  completedAt: string;
  completedByUsername: string;
}

const MAINTENANCE_TASKS_HEADER_ROW = [
  "TaskId", "CreatedAt", "EquipmentRowNumber", "AssetNumber", "EquipmentType", "BrandModel",
  "Department", "Location", "AssignedToUsername", "AssignedToDisplayName", "Status",
  "ActionsTaken", "InspectionChecks", "PartsChanged", "OtherDetail", "Notes",
  "CompletedAt", "CompletedByUsername",
];

function getMaintenanceTasksTab(): string {
  return process.env.GOOGLE_SHEET_MAINTENANCE_TASKS_TAB?.trim() || "MaintenanceTasks";
}

function parseJsonStringArray(raw: string): string[] {
  if (!raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function rowToMaintenanceTask(row: string[]): MaintenanceTask {
  const col = (i: number) => (row[i] ?? "").toString();
  return {
    taskId: col(0).trim(),
    createdAt: col(1),
    equipmentRowNumber: Number(col(2)) || 0,
    assetNumber: col(3),
    equipmentType: col(4),
    brandModel: col(5),
    department: col(6),
    location: col(7),
    assignedToUsername: col(8),
    assignedToDisplayName: col(9),
    status: col(10).trim() === "done" ? "done" : "in_progress",
    actionsTaken: parseJsonStringArray(col(11)),
    inspectionChecks: parseJsonStringArray(col(12)) as InspectionCheck[],
    partsChanged: col(13),
    otherDetail: col(14),
    notes: col(15),
    completedAt: col(16),
    completedByUsername: col(17),
  };
}

function maintenanceTaskToRow(t: MaintenanceTask): (string | number)[] {
  return [
    t.taskId, t.createdAt, t.equipmentRowNumber, t.assetNumber, t.equipmentType, t.brandModel,
    t.department, t.location, t.assignedToUsername, t.assignedToDisplayName, t.status,
    JSON.stringify(t.actionsTaken), JSON.stringify(t.inspectionChecks), t.partsChanged,
    t.otherDetail, t.notes, t.completedAt, t.completedByUsername,
  ];
}

/** Every task, oldest first (append order) — the task-list page and
 * dashboard both filter/aggregate this client-side rather than the API
 * doing it, same rationale as getMaintenanceLog. */
export async function getMaintenanceTasks(): Promise<MaintenanceTask[]> {
  const spreadsheetId = getEnv("GOOGLE_SHEET_ID");
  const tab = getMaintenanceTasksTab();
  const sheets = google.sheets({ version: "v4", auth: sheetsAuth() });

  let values: string[][] | undefined;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tab}!A2:R100000`,
    });
    values = res.data.values as string[][] | undefined;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Unable to parse range")) {
      // Tab doesn't exist yet — no tasks have ever been logged.
      return [];
    }
    throw new Error(`อ่านรายการงานบำรุงรักษาไม่สำเร็จ: ${message}`);
  }

  return (values ?? [])
    .filter((row) => (row[0] ?? "").toString().trim() !== "")
    .map(rowToMaintenanceTask);
}

/** Creates one "in progress" task per entry — called when an IT account
 * prints a maintenance report, one row per piece of equipment on that
 * report. Throws a clear "create the tab first" error if the
 * MaintenanceTasks tab doesn't exist yet. */
export async function createMaintenanceTasks(
  entries: {
    equipmentRowNumber: number;
    assetNumber: string;
    equipmentType: string;
    brandModel: string;
    department: string;
    location: string;
    assignedToUsername: string;
    assignedToDisplayName: string;
  }[]
): Promise<MaintenanceTask[]> {
  if (entries.length === 0) return [];

  const spreadsheetId = getEnv("GOOGLE_SHEET_ID");
  const tab = getMaintenanceTasksTab();
  const sheets = google.sheets({ version: "v4", auth: sheetsAuth() });
  const now = new Date().toISOString();

  const tasks: MaintenanceTask[] = entries.map((e) => ({
    taskId: randomUUID(),
    createdAt: now,
    equipmentRowNumber: e.equipmentRowNumber,
    assetNumber: e.assetNumber,
    equipmentType: e.equipmentType,
    brandModel: e.brandModel,
    department: e.department,
    location: e.location,
    assignedToUsername: e.assignedToUsername,
    assignedToDisplayName: e.assignedToDisplayName,
    status: "in_progress",
    actionsTaken: [],
    inspectionChecks: [],
    partsChanged: "",
    otherDetail: "",
    notes: "",
    completedAt: "",
    completedByUsername: "",
  }));

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${tab}!A1`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: tasks.map(maintenanceTaskToRow) },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Unable to parse range")) {
      throw new Error(
        `ยังไม่พบแท็บชื่อ "${tab}" ในสเปรดชีต — สร้างแท็บนี้ก่อน (หัวตาราง: ${MAINTENANCE_TASKS_HEADER_ROW.join(" | ")}) หรือตั้งค่า GOOGLE_SHEET_MAINTENANCE_TASKS_TAB ให้ตรงกับชื่อแท็บจริง`
      );
    }
    throw new Error(`บันทึกงานบำรุงรักษาไม่สำเร็จ: ${message}`);
  }

  return tasks;
}

/** Merges `updates` into the task identified by `taskId` and rewrites just
 * that one sheet row — looks the row up by scanning getMaintenanceTasks()
 * rather than trusting a cached row number, same reasoning as updateUser()
 * (another IT account's task could have been inserted/closed in between). */
export async function updateMaintenanceTask(
  taskId: string,
  updates: Partial<
    Pick<
      MaintenanceTask,
      "status" | "actionsTaken" | "inspectionChecks" | "partsChanged" | "otherDetail" | "notes" | "completedAt" | "completedByUsername"
    >
  >
): Promise<MaintenanceTask> {
  const spreadsheetId = getEnv("GOOGLE_SHEET_ID");
  const tab = getMaintenanceTasksTab();
  const sheets = google.sheets({ version: "v4", auth: sheetsAuth() });

  let values: string[][] | undefined;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tab}!A2:R100000`,
    });
    values = res.data.values as string[][] | undefined;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`อ่านรายการงานบำรุงรักษาไม่สำเร็จ: ${message}`);
  }

  const rows = values ?? [];
  const idx = rows.findIndex((row) => (row[0] ?? "").toString().trim() === taskId);
  if (idx === -1) {
    throw new Error("ไม่พบงานนี้ในระบบ — อาจถูกลบหรือแก้ไขไปแล้ว");
  }
  const merged: MaintenanceTask = { ...rowToMaintenanceTask(rows[idx]), ...updates };
  const sheetRow = idx + 2;

  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tab}!A${sheetRow}:R${sheetRow}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [maintenanceTaskToRow(merged)] },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`บันทึกงานบำรุงรักษาไม่สำเร็จ: ${message}`);
  }

  return merged;
}

/** Physically removes one task row from the MaintenanceTasks tab — for when
 * IT selected the wrong equipment (or a duplicate) and wants the mistaken
 * task gone entirely, not just closed. Unlike updateMaintenanceTask this
 * doesn't rewrite a row in place; it deletes the sheet row outright via a
 * deleteDimension batchUpdate, so it disappears from every list immediately
 * and never leaves a blank row behind. Same find-by-taskId scan as
 * updateMaintenanceTask, for the same reason (another account's task could
 * have shifted the physical row in between).
 *
 * A "done" task can never be deleted this way — it's the completed record
 * of work IT actually did, kept for the หัวหน้า tracking view/history, so
 * only a fresh "in_progress" mistake is eligible. The API route also
 * enforces this server-side (never trust the client alone), but the check
 * lives here too so any other caller gets the same guarantee. */
export async function deleteMaintenanceTask(taskId: string): Promise<void> {
  const spreadsheetId = getEnv("GOOGLE_SHEET_ID");
  const tab = getMaintenanceTasksTab();
  const sheets = google.sheets({ version: "v4", auth: sheetsAuth() });

  let values: string[][] | undefined;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tab}!A2:R100000`,
    });
    values = res.data.values as string[][] | undefined;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`อ่านรายการงานบำรุงรักษาไม่สำเร็จ: ${message}`);
  }

  const rows = values ?? [];
  const idx = rows.findIndex((row) => (row[0] ?? "").toString().trim() === taskId);
  if (idx === -1) {
    throw new Error("ไม่พบงานนี้ในระบบ — อาจถูกลบไปแล้ว");
  }
  if (rowToMaintenanceTask(rows[idx]).status === "done") {
    throw new Error("งานนี้เสร็จสิ้นแล้ว ไม่สามารถลบได้");
  }
  const sheetRow = idx + 2; // 1-based sheet row — matches updateMaintenanceTask's own math

  let sheetId: number | null | undefined;
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
    sheetId = meta.data.sheets?.find((s) => s.properties?.title === tab)?.properties?.sheetId;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`ลบงานบำรุงรักษาไม่สำเร็จ: ${message}`);
  }
  if (sheetId == null) {
    throw new Error(`ไม่พบแท็บชื่อ "${tab}" ในสเปรดชีต`);
  }

  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId,
                dimension: "ROWS",
                startIndex: sheetRow - 1,
                endIndex: sheetRow,
              },
            },
          },
        ],
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`ลบงานบำรุงรักษาไม่สำเร็จ: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// SpecStandards tab — the minimum PC spec the hospital currently considers
// acceptable, used by lib/specEvaluation.ts to auto-flag a machine as
// "ต่ำกว่ามาตรฐาน" from its already-recorded RAM/storage spec columns. Same
// Key | Value shape and manual-tab-creation convention as ReportSettings —
// see that section's comment for the read/write fallback rules, which this
// mirrors exactly.
// ---------------------------------------------------------------------------

// SpecStandards / DEFAULT_SPEC_STANDARDS themselves are defined in
// lib/specEvaluation.ts and re-exported above.

const SPEC_STANDARDS_KEYS = Object.keys(DEFAULT_SPEC_STANDARDS) as (keyof SpecStandards)[];

function getSpecStandardsTab(): string {
  return process.env.GOOGLE_SHEET_SPEC_STANDARDS_TAB?.trim() || "SpecStandards";
}

export async function getSpecStandards(): Promise<SpecStandards> {
  const spreadsheetId = getEnv("GOOGLE_SHEET_ID");
  const tab = getSpecStandardsTab();
  const sheets = google.sheets({ version: "v4", auth: sheetsAuth() });

  let values: string[][] | undefined;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tab}!A2:B200`,
    });
    values = res.data.values as string[][] | undefined;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Unable to parse range")) {
      return { ...DEFAULT_SPEC_STANDARDS };
    }
    throw new Error(`อ่านมาตรฐานสเปกไม่สำเร็จ: ${message}`);
  }

  const stored = new Map<string, string>();
  for (const row of values ?? []) {
    const key = (row[0] ?? "").toString().trim();
    if (key) stored.set(key, (row[1] ?? "").toString());
  }

  const result = { ...DEFAULT_SPEC_STANDARDS };
  for (const key of SPEC_STANDARDS_KEYS) {
    const v = stored.get(key);
    if (v !== undefined && v.trim() !== "") result[key] = v;
  }
  return result;
}

export async function updateSpecStandards(updates: Partial<SpecStandards>): Promise<SpecStandards> {
  const current = await getSpecStandards();
  const merged: SpecStandards = { ...current, ...updates };

  const spreadsheetId = getEnv("GOOGLE_SHEET_ID");
  const tab = getSpecStandardsTab();
  const sheets = google.sheets({ version: "v4", auth: sheetsAuth() });

  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tab}!A2:B${1 + SPEC_STANDARDS_KEYS.length}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: SPEC_STANDARDS_KEYS.map((key) => [key, merged[key]]),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Unable to parse range")) {
      throw new Error(
        `ยังไม่พบแท็บชื่อ "${tab}" ในสเปรดชีต — สร้างแท็บนี้ก่อน (หัวตาราง: Key | Value) หรือตั้งค่า GOOGLE_SHEET_SPEC_STANDARDS_TAB ให้ตรงกับชื่อแท็บจริง`
      );
    }
    throw new Error(`บันทึกมาตรฐานสเปกไม่สำเร็จ: ${message}`);
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Equipment: add new row (superadmin only) / soft-delete via status column
// ---------------------------------------------------------------------------

/** Appends a new equipment row to the end of the main sheet, in whatever
 * header order the sheet currently has. Returns the row number Sheets
 * actually wrote to — parsed from the API's updatedRange rather than
 * assumed from the current row count, since an append always lands after
 * the last non-empty row (trailing blank rows, or a concurrent append,
 * would make an assumed row number wrong). */
export async function appendEquipmentRow(values: Record<string, string>): Promise<{ rowNumber: number }> {
  const spreadsheetId = getEnv("GOOGLE_SHEET_ID");
  const tab = process.env.GOOGLE_SHEET_TAB?.trim() || "Sheet1";
  const sheets = google.sheets({ version: "v4", auth: sheetsAuth() });

  const headerRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tab}!A1:Z1` });
  const headers = ((headerRes.data.values?.[0] ?? []) as string[]).map((h) => (h ?? "").toString().trim());
  const orderedValues = headers.map((h) => values[h] ?? "");

  const appendRes = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${tab}!A1`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [orderedValues] },
  });

  const updatedRange = appendRes.data.updates?.updatedRange ?? "";
  const match = updatedRange.match(/![A-Z]+(\d+):/);
  const rowNumber = match ? Number(match[1]) : NaN;
  if (!Number.isInteger(rowNumber)) {
    throw new Error("เพิ่มรายการสำเร็จแต่ไม่สามารถระบุแถวที่เพิ่มได้ กรุณารีเฟรชหน้าเพื่อตรวจสอบ");
  }
  return { rowNumber };
}

/** Soft-deletes ("จำหน่าย") one equipment row by overwriting just its status
 * column, via the same updateEquipmentRow() used for regular edits — reads
 * only the one row it needs (not the whole sheet) since this can be called
 * for any row number without a prior full fetch. */
export async function setEquipmentStatus(
  rowNumber: number,
  statusHeader: string,
  status: string
): Promise<Record<string, string>> {
  const spreadsheetId = getEnv("GOOGLE_SHEET_ID");
  const tab = process.env.GOOGLE_SHEET_TAB?.trim() || "Sheet1";
  const sheets = google.sheets({ version: "v4", auth: sheetsAuth() });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tab}!A1:Z${rowNumber}`,
  });
  const values = (res.data.values ?? []) as string[][];
  const headers = (values[0] ?? []).map((h) => (h ?? "").toString().trim());
  const rowValues = values[rowNumber - 1] ?? [];
  if (rowValues.length === 0) {
    throw new Error("ไม่พบรายการนี้ — อาจถูกย้ายหรือลบไปแล้ว");
  }

  const current: Record<string, string> = {};
  headers.forEach((h, i) => {
    current[h || `column_${i + 1}`] = (rowValues[i] ?? "").toString();
  });
  current[statusHeader] = status;

  await updateEquipmentRow(rowNumber, headers, current);
  return current;
}

/** 1-based column index -> spreadsheet column letter(s), e.g. 1 -> "A", 27 -> "AA". */
function columnLetter(index: number): string {
  let n = index;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}
