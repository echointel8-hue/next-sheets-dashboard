"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Clock, MapPin, RefreshCw, Truck, Users } from "lucide-react";
import { splitBookingDateTime } from "@/lib/booking";
import type { DriverTripSummary } from "@/lib/sheets";

// เด้งรีเฟรชเองเป็นระยะ เผื่อคนขับเปิดหน้านี้ค้างไว้ (ปักหมุด/บุ๊กมาร์กไว้บน
// มือถือ) — ไม่ถี่เท่า NotificationBell.tsx (15 วินาที, สำหรับฝ่ายบริหารที่
// ต้องเห็นคำขอใหม่เร็วที่สุด) เพราะหน้านี้แค่ให้ "ดูงาน" ไม่มีอะไรต้องรีบกด
// อนุมัติ/ปฏิเสธ
const POLL_INTERVAL_MS = 60_000;

const THAI_WEEKDAYS_SHORT = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
const THAI_MONTHS_SHORT = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

/** วันนี้/พรุ่งนี้ตามเขตเวลา Asia/Bangkok — ระบุ timeZone ตรงๆ เสมอ (ไม่พึ่ง
 * เขตเวลาของเครื่องที่รัน) เพราะฟังก์ชันนี้ถูกเรียกทั้งตอน render บนเซิร์ฟเวอร์
 * (Vercel รันเป็น UTC) และตอน hydrate ในเบราว์เซอร์ผู้ใช้ (Asia/Bangkok) — ถ้า
 * ไม่ล็อกเขตเวลาไว้ ผลลัพธ์สองฝั่งจะไม่ตรงกันได้ ทำให้ React แจ้ง hydration
 * mismatch (เหมือนที่ formatTime ใน Dashboard.tsx เจอปัญหาเดียวกันมาก่อน) */
function bangkokDateKey(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
}

/** หัวข้อวัน — "วันนี้ (25 ก.ย. 2569)" / "พรุ่งนี้ (26 ก.ย. 2569)" / else
 * "ศ. 27 ก.ย. 2569" คำนวณวัน/เดือน/ปี/วันในสัปดาห์เองล้วนๆ จากตัวเลขใน dateKey
 * ตรงๆ (ไม่พึ่ง Intl/toLocaleDateString สำหรับตัวเลขวันที่) ให้ผลเหมือนกันเป๊ะ
 * ไม่ว่าจะรันฝั่งไหน (เหตุผลเดียวกับ bangkokDateKey ด้านบน) — ใช้
 * Date.UTC(...).getUTCDay() หาวันในสัปดาห์เพราะเป็นเลขคณิตปฏิทินล้วนๆ ไม่ผูก
 * กับเขตเวลาเครื่องที่รันเลย */
function dayHeading(dateKey: string, todayKey: string, tomorrowKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const weekdayShort = THAI_WEEKDAYS_SHORT[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const dateLabel = `${d} ${THAI_MONTHS_SHORT[m - 1]} ${y + 543}`;
  if (dateKey === todayKey) return `วันนี้ (${dateLabel})`;
  if (dateKey === tomorrowKey) return `พรุ่งนี้ (${dateLabel})`;
  return `${weekdayShort} ${dateLabel}`;
}

/**
 * หน้าปฏิทินงานคนขับ — รายการ (ไม่ใช่ปฏิทินกริดแบบฝ่ายบริหาร) เรียงตามเวลา
 * เริ่มก่อน-หลัง จัดกลุ่มตามวัน เพราะออกแบบไว้ให้ใช้บนมือถือเป็นหลัก (อ่านลิสต์
 * เร็วกว่ากดดูปฏิทินกริดบนจอเล็ก) — ดูภาพรวมทั้งหมดใน
 * docs/line-driver-notify-plan.md
 *
 * รับ initialTrips จาก page.tsx (server component, เรนเดอร์ครั้งแรกจาก
 * getDriverTrips() ตรงๆ) แล้วรีเฟรชเองเป็นระยะผ่าน
 * GET /api/public/driver-trips จากตรงนี้ต่อ — ไม่มี session/ล็อกอินเกี่ยวข้อง
 * เลยทั้งสองทาง
 */
export default function DriverCalendar({ initialTrips }: { initialTrips: DriverTripSummary[] }) {
  const [trips, setTrips] = useState<DriverTripSummary[]>(initialTrips);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  // เที่ยวที่กำลังกางดูรายละเอียดคำขอย่อยอยู่ — พับไว้ทั้งหมดโดยเริ่มต้น กัน
  // หน้าจอรกเกินไปเมื่อมีหลายเที่ยวในวันเดียว ให้เห็นแค่สรุปสั้นๆ ก่อน
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/public/driver-trips", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.trips)) {
        setTrips(data.trips as DriverTripSummary[]);
        setLastUpdated(new Date());
      }
    } catch {
      // Best-effort — รีเฟรชไม่สำเร็จก็แค่เก็บข้อมูลเดิมไว้ก่อน ลองใหม่รอบถัดไป
      // อัตโนมัติ (ดู POLL_INTERVAL_MS) ไม่ต้องมี error banner รบกวน
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  function toggle(tripOrderId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(tripOrderId)) next.delete(tripOrderId);
      else next.add(tripOrderId);
      return next;
    });
  }

  // ตั้งใจสร้าง Date เดียว (now) แล้วคำนวณ todayKey/tomorrowKey ต่อจากค่านั้น
  // แทนการเรียก `new Date()`/`Date.now()` ซ้ำหลายจุด — ตัวสร้าง Date() ตรงๆ
  // เป็นฟังก์ชัน impure (react-hooks/purity บ่นถ้าเรียกซ้ำในจุดคำนวณค่า
  // ระหว่าง render) เรียกครั้งเดียวในนี้พอ
  const now = useMemo(() => new Date(), []);
  const todayKey = useMemo(() => bangkokDateKey(now), [now]);
  const tomorrowKey = useMemo(() => bangkokDateKey(new Date(now.getTime() + 24 * 60 * 60 * 1000)), [now]);

  const groups = useMemo(() => {
    const map = new Map<string, DriverTripSummary[]>();
    for (const trip of trips) {
      const key = splitBookingDateTime(trip.startTime)?.dateKey ?? "";
      const list = map.get(key);
      if (list) list.push(trip);
      else map.set(key, [trip]);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [trips]);

  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-5 dark:bg-zinc-950">
      <div className="mx-auto flex max-w-md flex-col gap-4">
        <header className="flex items-center justify-between gap-2">
          <h1 className="flex items-center gap-2 text-lg font-bold text-zinc-800 dark:text-zinc-100">
            <Truck size={22} strokeWidth={2.2} className="shrink-0 text-[var(--brand-strong)]" aria-hidden="true" />
            ปฏิทินงานคนขับ
          </h1>
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            aria-label="รีเฟรชข้อมูล"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-emerald-900/10 bg-white text-zinc-600 shadow-sm transition-colors hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-60 dark:border-emerald-400/10 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-emerald-950/40"
          >
            <RefreshCw size={16} strokeWidth={2} className={refreshing ? "animate-spin" : ""} aria-hidden="true" />
          </button>
        </header>

        {groups.length === 0 ? (
          <p className="rounded-2xl border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            ยังไม่มีงานที่จ่ายรถในช่วง 14 วันข้างหน้า
          </p>
        ) : (
          groups.map(([dateKey, dayTrips]) => (
            <section key={dateKey} className="flex flex-col gap-2">
              <h2 className="px-1 text-sm font-semibold text-zinc-600 dark:text-zinc-300">
                {dayHeading(dateKey, todayKey, tomorrowKey)}
              </h2>
              <div className="flex flex-col gap-2">
                {dayTrips.map((trip) => {
                  const isOpen = expanded.has(trip.tripOrderId);
                  const startParts = splitBookingDateTime(trip.startTime);
                  const endParts = splitBookingDateTime(trip.endTime);
                  return (
                    <div
                      key={trip.tripOrderId}
                      className="rounded-2xl border border-emerald-900/10 bg-white p-3.5 shadow-sm dark:border-emerald-400/10 dark:bg-zinc-900"
                    >
                      <button
                        type="button"
                        onClick={() => toggle(trip.tripOrderId)}
                        className="flex w-full flex-col gap-1.5 text-left"
                        aria-expanded={isOpen}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-base font-semibold text-zinc-800 dark:text-zinc-100">
                            {trip.resourceName}
                          </span>
                          {isOpen ? (
                            <ChevronUp size={16} strokeWidth={2} className="shrink-0 text-zinc-400" aria-hidden="true" />
                          ) : (
                            <ChevronDown size={16} strokeWidth={2} className="shrink-0 text-zinc-400" aria-hidden="true" />
                          )}
                        </div>
                        {/* เวลาออกเดินทาง — ตัวใหญ่เด่นชัดเหมือนในปฏิทินฝ่าย
                            บริหาร (BookingCalendar.tsx) เพราะเป็นข้อมูลที่คนขับ
                            ต้องการเห็นเร็วที่สุด */}
                        <div className="flex items-baseline gap-1.5">
                          <Clock
                            size={18}
                            strokeWidth={2.5}
                            className="shrink-0 self-center text-sky-700 dark:text-sky-300"
                            aria-hidden="true"
                          />
                          <span className="text-xl font-bold leading-none tabular-nums text-sky-900 dark:text-sky-100">
                            {startParts?.time ?? "--:--"}
                          </span>
                          <span className="text-xs text-zinc-400 dark:text-zinc-500">
                            – {endParts?.time ?? "--:--"}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                          <span>คนขับ: {trip.driverName || "—"}</span>
                          <span className="inline-flex items-center gap-1">
                            <Users size={12} strokeWidth={2} aria-hidden="true" />
                            {trip.totalParticipants.toLocaleString("th-TH")} คน
                          </span>
                          <span>{trip.requests.length.toLocaleString("th-TH")} คำขอ</span>
                        </div>
                      </button>
                      {isOpen && (
                        <ul className="mt-2.5 flex flex-col gap-2 border-t border-zinc-100 pt-2.5 dark:border-zinc-800">
                          {trip.requests.map((r, i) => {
                            const rStart = splitBookingDateTime(r.startTime);
                            const rEnd = splitBookingDateTime(r.endTime);
                            return (
                              <li
                                key={i}
                                className={`text-xs leading-5 ${
                                  r.cancelled
                                    ? "text-zinc-400 line-through dark:text-zinc-600"
                                    : "text-zinc-600 dark:text-zinc-300"
                                }`}
                              >
                                <span className="font-medium">{r.department}</span>
                                {" · "}
                                {rStart?.time ?? "--:--"}–{rEnd?.time ?? "--:--"}
                                {" · "}
                                <span className="inline-flex items-center gap-0.5">
                                  <Users size={10} strokeWidth={2} aria-hidden="true" />
                                  {r.participants.toLocaleString("th-TH")} คน
                                </span>
                                {r.destination && (
                                  <>
                                    {" · "}
                                    <span className="inline-flex items-center gap-0.5">
                                      <MapPin size={10} strokeWidth={2} aria-hidden="true" />
                                      {r.destination}
                                    </span>
                                  </>
                                )}
                                {r.cancelled && " (ยกเลิกแล้ว)"}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))
        )}

        <p className="px-1 text-center text-[11px] text-zinc-400 dark:text-zinc-600">
          {lastUpdated
            ? `อัปเดตล่าสุด ${lastUpdated.toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok" })}`
            : "ข้อมูล ณ ตอนเปิดหน้านี้"}
        </p>
      </div>
    </div>
  );
}
