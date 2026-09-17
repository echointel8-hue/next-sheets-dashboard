"use client";

import { useEffect } from "react";

// 30 วินาที — เลือกเป็นค่ากลางตามที่โรงพยาบาลเลือกไว้ ถี่พอให้รู้ตัวไว ไม่
// ต้องรอนานเกินไปหลังถูกเซสชันอื่นทับ แต่ก็ไม่ถี่จนกินโควตาคำสั่ง Upstash
// Redis เกินจำเป็น (ทุก poll คือ 1-2 คำสั่งไปยัง Redis ผ่าน
// checkSessionSuperseded ใน lib/auth.ts) — ทั้งการนำทางปกติผ่าน proxy.ts และ
// ตัวนี้ใช้โควตาเดียวกัน ยังห่างไกลโควตาฟรีของ Upstash มาก (ดูการประเมินการ
// ใช้งานจริงตอนตั้งค่า Upstash ครั้งแรก — ~20-30 คน ใช้งานทั้งวัน)
const SESSION_CHECK_INTERVAL_MS = 30_000;

/**
 * Mounted once ผ่าน AppShell (ทุกหน้าที่ล็อกอินแล้ว) — poll
 * GET /api/auth/session-check ทุก 30 วินาที ทันทีที่เซสชันนี้ใช้ไม่ได้แล้ว
 * (ที่พบบ่อยที่สุด: ถูกเซสชันใหม่ทับ — ดู checkSessionSuperseded ใน
 * lib/auth.ts) จะเด้งไปหน้า /login ทันที ไม่ต้องรอให้ผู้ใช้กด/เปลี่ยนหน้าเอง
 * ก่อนถึงจะโดน proxy.ts จับได้ ตามที่โรงพยาบาลขอเพิ่มภายหลัง ("อยากให้แจ้ง
 * เตือน+เด้งออกอัตโนมัติ ไม่ใช่รอจนกดอะไรสักอย่างก่อนถึงจะรู้ตัว")
 *
 * ใช้ ?reason=elsewhere พารามิเตอร์เดียวกับที่ proxy.ts ติดไปเองอยู่แล้วตอน
 * เตะออกกรณีนี้ — LoginForm.tsx จึงโชว์ข้อความ "ถูกเตะออกเพราะมีคนล็อกอินที่
 * อื่น" แบบเดียวกันทุกประการ ไม่ว่าจะถูกจับได้จากทางไหน (proxy.ts ตอนกด
 * อะไรสักอย่าง หรือตัวนี้ตอนนั่งเฉยๆ) — นี่เป็นแค่จุดกระตุ้นเพิ่มเติมของ flow
 * เดิมที่มีอยู่แล้ว ไม่ใช่ flow ใหม่
 *
 * ไม่เช็คทันทีตอน mount โดยตั้งใจ — ทุกหน้าที่ผ่านมาถึงตรงนี้ได้ต้องผ่าน
 * proxy.ts ตรวจสอบมาแล้วสดๆ อยู่แล้ว (นั่นคือเหตุผลที่หน้านี้โหลดขึ้นมาได้)
 * เช็คซ้ำทันทีจะเป็นการเรียก Redis ที่ไม่จำเป็น เริ่มนับ interval จริงๆ ตอน
 * 30 วินาทีแรกผ่านไปก็พอ
 */
export default function SessionWatcher() {
  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch("/api/auth/session-check", { cache: "no-store" });
        if (cancelled || res.ok) return;
        const data = await res.json().catch(() => ({}));
        const loginUrl = data.reason === "elsewhere" ? "/login?reason=elsewhere" : "/login";
        // Hard navigation แทน router.push()/router.refresh() — เหตุผล
        // เดียวกับ logout()'s ของ AppShell.tsx และ handleLoginSubmit ของ
        // LoginForm.tsx: ไม่เสี่ยงค้างอยู่กลาง client-router transition ที่
        // ทำครึ่งๆ กลางๆ
        window.location.href = loginUrl;
      } catch {
        // Best-effort — เน็ตสะดุดชั่วคราวแค่ลองใหม่รอบถัดไป ปรัชญาเดียวกับ
        // poll() ของ NotificationBell.tsx
      }
    }

    const interval = setInterval(check, SESSION_CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return null;
}
