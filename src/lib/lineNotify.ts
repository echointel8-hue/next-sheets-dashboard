/**
 * ส่งข้อความ push เข้ากลุ่ม LINE ของพนักงานขับรถ ผ่าน LINE Messaging API (ไม่ใช่
 * LINE Notify ซึ่งถูกปิดให้บริการไปแล้วตั้งแต่ 31 มี.ค. 2568 — ดูรายละเอียด
 * สถาปัตยกรรมเต็มๆ ใน docs/line-driver-notify-plan.md)
 *
 * ต้องตั้งค่า environment variables สองตัวก่อนใช้งานได้จริง (ดูขั้นตอนเต็มใน
 * เอกสารข้างต้น — ต้องสร้าง LINE Official Account + เปิด Messaging API +
 * เชิญเข้ากลุ่มคนขับ + ดึง Group ID มาก่อน ไม่ใช่งานที่ทำในโค้ดนี้ได้):
 *   - LINE_CHANNEL_ACCESS_TOKEN — token ของ Messaging API channel
 *   - LINE_DRIVER_GROUP_ID — Group ID ของกลุ่ม LINE คนขับที่เชิญบอทเข้าไปแล้ว
 *
 * ตั้งใจให้ "best-effort" เสมอ — ยังไม่ได้ตั้งค่า env var ทั้งสองตัวนี้ก็ไม่ใช่
 * ข้อผิดพลาด (ข้ามเงียบๆ ระบบจองยังทำงานปกติทุกอย่าง แค่ไม่มีข้อความเด้งไป
 * LINE เท่านั้น) และถ้าเรียก LINE API แล้วล้มเหลว (token หมดอายุ, โควตาเต็ม,
 * เครือข่ายมีปัญหา) ก็จะไม่ throw ออกไปให้ผู้เรียกเห็นเช่นกัน — แค่ log ไว้ กัน
 * ไม่ให้ปัญหาฝั่ง LINE ทำให้การอนุมัติ/แก้ไข/ยกเลิกจองรถในระบบหลักล้มเหลวตามไป
 * ด้วย ผู้เรียกทุกจุด (ดู route handlers ที่เรียกใช้) จึงเรียกแบบ "fire and
 * forget" ได้เลยโดยไม่ต้องกัน error เพิ่มเอง
 */

const LINE_PUSH_ENDPOINT = "https://api.line.me/v2/bot/message/push";

// LINE จำกัดความยาวข้อความประเภท text ไว้ที่ 5,000 ตัวอักษรต่อข้อความ — ตัด
// ปลายทิ้งเป็นเกราะป้องกันสุดท้าย ไม่ควรมีข้อความไหนในระบบนี้ยาวขนาดนั้นจริงๆ
// อยู่แล้ว แต่กันไว้ไม่ให้ทั้งคำขอ push ถูก LINE ปฏิเสธเพราะยาวเกิน
const LINE_TEXT_MAX_LENGTH = 5000;

/** ส่งข้อความ text หนึ่งข้อความเข้ากลุ่มคนขับที่ตั้งค่าไว้ (LINE_DRIVER_GROUP_ID)
 * — ดูคอมเมนต์หัวไฟล์สำหรับ contract เต็มๆ (ไม่ throw, ข้ามเงียบๆ ถ้ายังไม่ได้
 * ตั้งค่า) เรียกจาก route handler หลังบันทึกข้อมูลลง Sheets สำเร็จแล้วเท่านั้น
 * — ไม่เคย await ผลลัพธ์เพื่อตัดสินใจอย่างอื่นต่อ เพราะการแจ้งเตือนไม่ควรเป็น
 * เงื่อนไขว่าการดำเนินการหลักสำเร็จหรือไม่ */
export async function notifyDriverGroup(text: string): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const groupId = process.env.LINE_DRIVER_GROUP_ID;
  if (!token || !groupId) {
    // ยังไม่ได้ตั้งค่า LINE Messaging API — ข้ามเงียบๆ ตามที่ออกแบบไว้ (ดู
    // คอมเมนต์หัวไฟล์) ไม่ log เป็น error เพราะนี่เป็นสถานะที่คาดไว้ได้ตามปกติ
    // ก่อนที่โรงพยาบาลจะตั้งค่า LINE OA เสร็จ (เฟส 0 ใน
    // docs/line-driver-notify-plan.md)
    return;
  }

  try {
    const res = await fetch(LINE_PUSH_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        to: groupId,
        messages: [{ type: "text", text: text.slice(0, LINE_TEXT_MAX_LENGTH) }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[lineNotify] LINE push ล้มเหลว (${res.status}): ${body}`);
    }
  } catch (err: unknown) {
    console.error("[lineNotify] เรียก LINE API ไม่สำเร็จ:", err);
  }
}

/** URL เต็มของหน้าปฏิทินงานคนขับ (/driver) — คำนวณจาก origin ของคำขอที่กำลัง
 * ประมวลผลอยู่ (request.nextUrl.origin) แทนการพึ่ง env var ตัวใหม่ เพราะ
 * origin ที่ถูกต้องมีอยู่แล้วในทุก request ที่เข้ามาที่ route handler เหล่านี้
 * (ใช้ได้ทั้ง production/preview deployment ของ Vercel โดยไม่ต้องตามอัปเดต
 * env var ทุกครั้งที่โดเมนเปลี่ยน) รองรับ path ทางเลือกผ่าน
 * DRIVER_CALENDAR_PATH เผื่ออยากเปลี่ยนจาก "/driver" ตรงๆ เป็น path ที่เดา
 * ยากกว่าภายหลัง (ดูข้อ 6 ใน docs/line-driver-notify-plan.md) — ไม่ตั้งค่า
 * ก็ใช้ "/driver" เป็นค่าเริ่มต้น */
export function driverCalendarUrl(origin: string): string {
  const path = process.env.DRIVER_CALENDAR_PATH || "/driver";
  return `${origin}${path}`;
}
