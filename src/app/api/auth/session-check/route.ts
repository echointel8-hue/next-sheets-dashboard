import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, checkSessionSuperseded, verifySessionToken } from "@/lib/auth";

// Never cache/prerender — checks live session state (signature/expiry +
// cross-instance superseded-check) on every call, same as every other route
// in src/app/api/auth/*.
export const dynamic = "force-dynamic";

/**
 * เบาๆ ไว้ให้ฝั่ง client (ดู src/components/SessionWatcher.tsx) poll ถามเป็น
 * ระยะว่าเซสชันปัจจุบันยังใช้ได้อยู่ไหม — โดยเฉพาะกรณี "ถูกเตะออกเพราะมีคน
 * ล็อกอินบัญชีเดียวกันทับที่อื่น" (checkSessionSuperseded ผ่าน
 * lib/sessionStore.ts) ปกติ proxy.ts จะตรวจสิ่งนี้ให้ทุก request ที่ผ่าน
 * /manage, /api/manage, /booking, /api/booking, /menu อยู่แล้ว แต่นั่นแปลว่า
 * ต้อง "มีคนกดอะไรสักอย่าง/เปลี่ยนหน้า" ก่อนถึงจะไปกระตุ้นให้ proxy.ts เช็ค —
 * ถ้าเปิดหน้าเดิมค้างไว้เฉยๆ ไม่กดอะไรเลย จะไม่รู้ตัวว่าถูกเตะออกไปแล้วจนกว่า
 * จะขยับทำอะไรสักอย่าง จึงต้องมี endpoint แยกต่างหากนี้ ให้ SessionWatcher
 * เรียกเองเป็นระยะแทน (ตามที่โรงพยาบาลขอเพิ่มภายหลัง — "อยากให้แจ้งเตือน+
 * เด้งออกอัตโนมัติ ไม่ใช่รอจนกดอะไรสักอย่างก่อน")
 *
 * ตอบ 200 {valid:true} เมื่อยังใช้ได้ปกติ, 401 {valid:false, reason} เมื่อ
 * ใช้ไม่ได้แล้ว — reason เป็น "elsewhere" เฉพาะกรณีถูกเซสชันใหม่ทับเท่านั้น
 * (SessionWatcher ใช้ค่านี้ต่อ ?reason=elsewhere ให้หน้า /login โชว้ข้อความ
 * ที่ตรงสาเหตุ เหมือนที่ proxy.ts ทำอยู่แล้วทุกประการ) กรณีอื่น (ไม่มีคุกกี้/
 * ลายเซ็นไม่ถูกต้อง/หมดอายุ) ใช้ "expired" เฉยๆ — ไม่ต้องมีคำอธิบายพิเศษ
 * เพราะเป็นสถานการณ์ปกติทั่วไป (เช่น หมดอายุจาก SESSION_MAX_AGE_SECONDS)
 */
export async function GET(request: NextRequest) {
  const session = verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ valid: false, reason: "expired" }, { status: 401 });
  }
  const superseded = await checkSessionSuperseded(session);
  if (superseded) {
    return NextResponse.json({ valid: false, reason: "elsewhere" }, { status: 401 });
  }
  return NextResponse.json({ valid: true });
}
