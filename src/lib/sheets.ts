import { google } from "googleapis";
import { resolveFields, type EquipmentRow, type FieldMap } from "@/lib/fields";

export type { EquipmentRow, FieldMap };

export interface SheetSnapshot {
  tab: string;
  headers: string[];
  rows: EquipmentRow[];
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

/**
 * Reads equipment data from the configured Google Sheet using a service
 * account. Set GOOGLE_SHEET_TAB in .env.local if your tab isn't "Sheet1".
 */
export async function getEquipmentData(): Promise<SheetSnapshot> {
  const clientEmail = getEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = getEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n");
  const spreadsheetId = getEnv("GOOGLE_SHEET_ID");
  const tab = process.env.GOOGLE_SHEET_TAB?.trim() || "Sheet1";

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: clientEmail,
      private_key: privateKey,
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });

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
        `ไม่มีสิทธิ์เข้าถึงสเปรดชีต — เปิดสเปรดชีตแล้วแชร์ให้กับ ${clientEmail} (สิทธิ์ Viewer ก็พอ)`
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

  const rows: EquipmentRow[] = dataRows
    .filter((r) => r.some((cell) => (cell ?? "").toString().trim() !== ""))
    .map((r) => {
      const row: EquipmentRow = {};
      headers.forEach((h, i) => {
        row[h || `column_${i + 1}`] = (r[i] ?? "").toString();
      });
      return row;
    });

  return {
    tab,
    headers,
    rows,
    fields: resolveFields(headers),
    fetchedAt: new Date().toISOString(),
  };
}
