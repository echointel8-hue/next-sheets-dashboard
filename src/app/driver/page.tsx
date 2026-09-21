import type { Metadata } from "next";
import { getDriverTrips } from "@/lib/sheets";
import DriverCalendar from "@/components/DriverCalendar";

// เที่ยวรถ/สถานะยกเลิกเปลี่ยนได้ตลอดเวลา — ห้าม cache หน้านี้ เหมือน
// /api/public/driver-trips (endpoint พี่น้องกันที่ใช้ getDriverTrips ตัว
// เดียวกัน — ดูคอมเมนต์ที่นั่น)
export const dynamic = "force-dynamic";

// กันหลุดไปอยู่บนผลค้นหา Google โดยไม่ตั้งใจ — หน้านี้ไม่ต้องล็อกอิน (ดูคอมเมนต์
// เต็มที่ head ของไฟล์ด้านล่าง) จึงไม่อยากให้ถูก index แม้ข้อมูลจะไม่ใช่ความลับ
// ระดับสูงก็ตาม
export const metadata: Metadata = {
  title: "ปฏิทินงานคนขับ",
  robots: { index: false, follow: false },
};

/**
 * หน้าปฏิทินงานคนขับ — สาธารณะ ไม่ต้องล็อกอิน ตามที่ออกแบบไว้ใน
 * docs/line-driver-notify-plan.md เข้าถึงผ่านลิงก์ที่แนบมาในข้อความ LINE ทุก
 * ครั้งที่มีการจ่ายรถ/แก้ไข/แยก/ยกเลิกเที่ยว (ดู lib/lineNotify.ts และจุดที่
 * เรียกใช้ในแต่ละ API route ใต้ src/app/api/booking/) ตั้งใจแยกออกจากระบบ
 * /booking/car เดิมโดยสิ้นเชิง — ไม่ผ่าน proxy.ts (ดูคอมเมนต์ที่นั่นว่าเฉพาะ
 * /booking, /api/booking, /manage, /api/manage, /menu เท่านั้นที่ต้อง
 * ล็อกอิน) และไม่ใช้ session cookie เลย เพราะคนขับไม่มีบัญชีผู้ใช้ในระบบนี้
 * (ชื่อคนขับเป็นแค่ข้อความอิสระในใบสั่งงานเดินทาง ไม่ใช่บัญชี)
 *
 * เรียก getDriverTrips() ตรงๆ ฝั่งเซิร์ฟเวอร์ (server component) สำหรับการ
 * เรนเดอร์ครั้งแรก — เร็วและเห็นผลทันทีตั้งแต่โหลดหน้าโดยไม่ต้องรอ client
 * fetch ก่อน (สำคัญสำหรับคนขับที่กดลิงก์จาก LINE บนมือถือ อาจเน็ตช้า) ส่งต่อ
 * เป็น initialTrips ให้ DriverCalendar.tsx (client component) ซึ่งจะรีเฟรช
 * เป็นระยะผ่าน GET /api/public/driver-trips ต่อเองจากตรงนั้น
 */
export default async function DriverPage() {
  const trips = await getDriverTrips();
  return <DriverCalendar initialTrips={trips} />;
}
