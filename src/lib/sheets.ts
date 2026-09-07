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
  /** Checklist items shown under the "การดำเนินการ" column of a printed
   * maintenance report — editable by the hospital instead of hard-coded,
   * since this list is expected to grow (today just "บำรุงรักษา", later
   * maybe "อัพเดทโปรแกรม Hosxp 3 เป็นเวอร์ชัน ...."). Stored as a JSON
   * array in the Value cell — see the special-cased handling in
   * getReportSettings/updateReportSettings below, since every other
   * setting here is a plain string. */
  actionOptions: string[];
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
  actionOptions: ["บำรุงรักษา"],
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

  const result: ReportSettings = { ...DEFAULT_REPORT_SETTINGS, actionOptions: [...DEFAULT_REPORT_SETTINGS.actionOptions] };
  for (const key of REPORT_SETTINGS_KEYS) {
    const v = stored.get(key);
    if (v === undefined || v.trim() === "") continue;
    if (key === "actionOptions") {
      // JSON array, not plain text — see the interface comment above.
      try {
        const parsed: unknown = JSON.parse(v);
        if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((x) => typeof x === "string")) {
          result.actionOptions = parsed as string[];
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
        values: REPORT_SETTINGS_KEYS.map((key) =>
          key === "actionOptions" ? [key, JSON.stringify(merged.actionOptions)] : [key, merged[key]]
        ),
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
