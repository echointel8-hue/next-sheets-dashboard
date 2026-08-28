import { google } from "googleapis";
import { redactSurname, resolveFields, type EquipmentRow, type FieldMap } from "@/lib/fields";

export type { EquipmentRow, FieldMap };

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
  role: "superadmin" | "admin";
  department: string;
  displayName: string;
  active: boolean;
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
      role: (r[2] ?? "").toString().trim() === "superadmin" ? "superadmin" : "admin",
      department: (r[3] ?? "").toString().trim(),
      displayName: (r[4] ?? "").toString().trim(),
      active: parseActive((r[5] ?? "").toString()),
    }));
}

export async function addUser(user: {
  username: string;
  passwordHash: string;
  role: "superadmin" | "admin";
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
