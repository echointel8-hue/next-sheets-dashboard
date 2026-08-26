require('dotenv').config({ path: '.env.local' });
const { google } = require('googleapis');

// 1. ตั้งค่า Authentication ผ่าน Service Account
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    // แปลง \n ใน private key ให้เป็น line break จริง
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });
const spreadsheetId = process.env.GOOGLE_SHEET_ID;

// ==========================================
// ฟังก์ชันสำหรับ "อ่านข้อมูล" (Read)
// ==========================================
async function readSheetData(range = 'Sheet1!A1:E10') {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      console.log('⚠️ ไม่พบข้อมูลใน Range ที่ระบุ');
      return [];
    }

    console.log('✅ อ่านข้อมูลสำเร็จ:');
    console.log(rows);
    return rows;
  } catch (error) {
    console.error('❌ เกิดข้อผิดพลาดในการอ่านข้อมูล:', error.message);
  }
}

// ==========================================
// ฟังก์ชันสำหรับ "เพิ่มแถวใหม่ต่อท้าย" (Append / Write)
// ==========================================
async function appendSheetData(range = 'Sheet1!A:E', values = []) {
  try {
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED', // ให้ระบบแปลงชนิดข้อมูลอัตโนมัติ (เช่น วันที่, ตัวเลข)
      requestBody: {
        values: values,
      },
    });

    console.log(`✅ บันทึกข้อมูลสำเร็จ! เพิ่มไป ${response.data.updates.updatedRows} แถว`);
    return response.data;
  } catch (error) {
    console.error('❌ เกิดข้อผิดพลาดในการเขียนข้อมูล:', error.message);
  }
}

// ==========================================
// ฟังก์ชันสำหรับ "อัปเดต/แก้ไขข้อมูลเฉพาะช่อง" (Update)
// ==========================================
async function updateSheetData(range = 'Sheet1!A2:C2', values = []) {
  try {
    const response = await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: values,
      },
    });

    console.log(`✅ อัปเดตข้อมูลสำเร็จ! แก้ไขไป ${response.data.updatedCells} ช่อง`);
    return response.data;
  } catch (error) {
    console.error('❌ เกิดข้อผิดพลาดในการอัปเดตข้อมูล:', error.message);
  }
}

// ==========================================
// ทดสอบเรียกใช้งาน
// ==========================================
async function main() {
  // หมายเหตุ: เปลี่ยนชื่อ Sheet1 ให้ตรงกับชื่อแท็บชีตของคุณ (เช่น "Form Responses 1" หรือ "แผ่น1")
  const sheetTabName = 'Sheet1';

  console.log('--- 1. ทดสอบเขียนข้อมูลแถวใหม่ ---');
  await appendSheetData(`${sheetTabName}!A:C`, [
    ['2026-08-25', 'จอคอมพิวเตอร์ Dell 24 นิ้ว', 'พร้อมใช้งาน'],
    ['2026-08-25', 'เมาส์ไร้สาย Logitech', 'กำลังซ่อมแซม']
  ]);

  console.log('\n--- 2. ทดสอบอ่านข้อมูลทั้งหมด ---');
  await readSheetData(`${sheetTabName}!A1:E`);
}

main();