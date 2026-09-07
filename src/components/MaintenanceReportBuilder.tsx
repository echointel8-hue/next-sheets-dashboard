"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Printer as PrinterIcon } from "lucide-react";
import type { ReportSettings } from "@/lib/sheets";

/** One selectable equipment item — already flattened/redaction-free by
 * manage/it/report/page.tsx from the raw sheet row, so this component never
 * needs FieldMap/EquipmentRow at all. */
export interface ReportEquipmentItem {
  rowNumber: number;
  assetNumber: string;
  equipmentType: string;
  brandModel: string;
  department: string;
  installLocation: string;
  responsiblePerson: string;
  disposed: boolean;
}

interface SelectedRow {
  rowNumber: number;
  assetNumber: string;
  description: string;
  location: string;
  responsiblePerson: string;
}

const CARD = "rounded-2xl border border-emerald-900/10 bg-white shadow-sm dark:border-emerald-400/10 dark:bg-zinc-900";
const INPUT_CLASS =
  "h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100";

const THAI_MONTHS_SHORT = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

/** "2026-08-14" -> "14 ส.ค. 2569" (Buddhist calendar, matching every other
 * Thai date on this site — see Dashboard.tsx's own date formatting). */
function formatThaiDate(iso: string): string {
  const parts = iso.split("-").map(Number);
  const [y, m, d] = parts;
  if (!y || !m || !d) return iso;
  return `${d} ${THAI_MONTHS_SHORT[m - 1] ?? ""} ${y + 543}`;
}

export default function MaintenanceReportBuilder({
  items,
  loadError,
  settings,
}: {
  items: ReportEquipmentItem[];
  loadError: string | null;
  settings: ReportSettings;
}) {
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [search, setSearch] = useState("");
  const [selectedRowNumbers, setSelectedRowNumbers] = useState<number[]>([]);
  const [formDepartment, setFormDepartment] = useState("");
  const [visitDate, setVisitDate] = useState("");
  const [timeFrom, setTimeFrom] = useState("");
  const [timeTo, setTimeTo] = useState("");
  const [overrides, setOverrides] = useState<
    Record<number, { location: string; responsiblePerson: string }>
  >({});

  const departmentOptions = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) if (it.department) set.add(it.department);
    return [...set].sort((a, b) => a.localeCompare(b, "th"));
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (departmentFilter && it.department !== departmentFilter) return false;
      if (q) {
        const hay = `${it.assetNumber} ${it.brandModel} ${it.equipmentType} ${it.installLocation} ${it.responsiblePerson}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, departmentFilter, search]);

  function toggleItem(rowNumber: number) {
    setSelectedRowNumbers((prev) =>
      prev.includes(rowNumber) ? prev.filter((n) => n !== rowNumber) : [...prev, rowNumber]
    );
  }

  function updateOverride(rowNumber: number, field: "location" | "responsiblePerson", value: string) {
    const source = items.find((it) => it.rowNumber === rowNumber);
    setOverrides((prev) => ({
      ...prev,
      [rowNumber]: {
        location: prev[rowNumber]?.location ?? source?.installLocation ?? "",
        responsiblePerson: prev[rowNumber]?.responsiblePerson ?? source?.responsiblePerson ?? "",
        [field]: value,
      },
    }));
  }

  // Preserve pick order (the order the person checked items in) rather than
  // the table's own order — that's usually the order they'll want on the
  // printed form too.
  const selectedRows: SelectedRow[] = useMemo(() => {
    return selectedRowNumbers
      .map((n) => items.find((it) => it.rowNumber === n))
      .filter((it): it is ReportEquipmentItem => Boolean(it))
      .map((it) => {
        const o = overrides[it.rowNumber];
        return {
          rowNumber: it.rowNumber,
          assetNumber: it.assetNumber,
          description: [it.equipmentType, it.brandModel].filter(Boolean).join(" — "),
          location: o?.location ?? it.installLocation,
          responsiblePerson: o?.responsiblePerson ?? it.responsiblePerson,
        };
      });
  }, [selectedRowNumbers, items, overrides]);

  const displayDate = visitDate ? formatThaiDate(visitDate) : "";
  const timeRangeLabel = timeFrom && timeTo ? `${timeFrom} - ${timeTo}` : timeFrom || timeTo || "";

  return (
    <main className="flex w-full flex-1 justify-center bg-[var(--page-bg)] px-4 py-8 print:block print:bg-white print:px-0 print:py-0 sm:px-6 lg:px-10">
      <div className="flex w-full max-w-[75rem] flex-col gap-6 print:max-w-none print:gap-0">
        {/* Selection controls — never printed (see the @media print rule
            below, which also hides anything with the .no-print class as a
            belt-and-suspenders backstop for browsers that ignore print:). */}
        <div className="no-print flex flex-col gap-6 print:hidden">
          <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-xl font-bold text-zinc-950 dark:text-zinc-50 sm:text-2xl">
                ออกรายงาน: แบบฟอร์มบำรุงรักษาเชิงป้องกัน
              </h1>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                เลือกครุภัณฑ์ กรอกวันที่/ช่วงเวลา แล้วกด &quot;พิมพ์&quot; — ใช้ฟังก์ชัน Print ของเบราว์เซอร์เลือก &quot;บันทึกเป็น PDF&quot;
                ได้เลย ไม่ต้องดาวน์โหลดไฟล์แยก
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/manage/it"
                className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <ArrowLeft size={16} strokeWidth={2} aria-hidden="true" />
                กลับไปแดชบอร์ด IT
              </Link>
              <button
                type="button"
                onClick={() => window.print()}
                disabled={selectedRows.length === 0}
                className="inline-flex items-center gap-1.5 rounded-full bg-[var(--brand)] px-4 py-2 text-sm font-medium text-[var(--brand-contrast)] transition-colors hover:bg-[var(--brand-strong)] disabled:opacity-50"
              >
                <PrinterIcon size={16} strokeWidth={2} aria-hidden="true" />
                พิมพ์ / บันทึกเป็น PDF
              </button>
            </div>
          </header>

          {loadError && (
            <div
              role="alert"
              className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
            >
              {loadError}
            </div>
          )}

          <div className={`${CARD} flex flex-col gap-3 p-4`}>
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">ข้อมูลของแบบฟอร์ม (ใช้ร่วมกันทุกรายการในตาราง)</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="flex flex-col gap-1 text-sm text-zinc-500 dark:text-zinc-400">
                กลุ่มงาน (แสดงในหัวแบบฟอร์ม)
                <input
                  type="text"
                  value={formDepartment}
                  onChange={(e) => setFormDepartment(e.target.value)}
                  placeholder="เช่น กลุ่มงานรังสีวิทยา"
                  className={INPUT_CLASS}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-zinc-500 dark:text-zinc-400">
                วันที่ดำเนินการ
                <input type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} className={INPUT_CLASS} />
              </label>
              <label className="flex flex-col gap-1 text-sm text-zinc-500 dark:text-zinc-400">
                เวลาเริ่ม
                <input type="time" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} className={INPUT_CLASS} />
              </label>
              <label className="flex flex-col gap-1 text-sm text-zinc-500 dark:text-zinc-400">
                เวลาสิ้นสุด
                <input type="time" value={timeTo} onChange={(e) => setTimeTo(e.target.value)} className={INPUT_CLASS} />
              </label>
            </div>
          </div>

          <div className={`${CARD} flex flex-col gap-3 p-4`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
              <label className="flex flex-col gap-1 text-sm text-zinc-500 dark:text-zinc-400 sm:max-w-xs sm:flex-1">
                กรองตามกลุ่มงาน
                <select
                  value={departmentFilter}
                  onChange={(e) => setDepartmentFilter(e.target.value)}
                  className={INPUT_CLASS}
                >
                  <option value="">ทั้งหมด</option>
                  {departmentOptions.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-zinc-500 dark:text-zinc-400 sm:max-w-xs sm:flex-1">
                ค้นหา
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="เลขครุภัณฑ์ / ยี่ห้อ / รุ่น / สถานที่"
                  className={INPUT_CLASS}
                />
              </label>
              <span className="text-sm text-zinc-400 sm:ml-auto sm:self-center">
                เลือกแล้ว {selectedRowNumbers.length.toLocaleString("th-TH")} รายการ
              </span>
            </div>
            <div className="max-h-80 overflow-y-auto rounded-lg border border-zinc-100 dark:border-zinc-800">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead className="sticky top-0 bg-white dark:bg-zinc-900">
                  <tr className="border-b border-zinc-100 text-[10px] uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
                    <th scope="col" className="px-2 py-2 font-medium">เลือก</th>
                    <th scope="col" className="px-2 py-2 font-medium">เลขครุภัณฑ์</th>
                    <th scope="col" className="px-2 py-2 font-medium">รายการ</th>
                    <th scope="col" className="px-2 py-2 font-medium">กลุ่มงาน</th>
                    <th scope="col" className="px-2 py-2 font-medium">สถานที่ตั้ง</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((it) => (
                    <tr key={it.rowNumber} className="border-b border-zinc-50 last:border-0 dark:border-zinc-800/60">
                      <td className="px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={selectedRowNumbers.includes(it.rowNumber)}
                          onChange={() => toggleItem(it.rowNumber)}
                          aria-label={`เลือก ${it.assetNumber || it.equipmentType}`}
                        />
                      </td>
                      <td className="px-2 py-1.5 text-zinc-700 dark:text-zinc-300">{it.assetNumber || "—"}</td>
                      <td className="px-2 py-1.5 text-zinc-700 dark:text-zinc-300">
                        {[it.equipmentType, it.brandModel].filter(Boolean).join(" — ") || "—"}
                        {it.disposed && <span className="ml-1 text-[10px] text-zinc-400">(จำหน่ายแล้ว)</span>}
                      </td>
                      <td className="px-2 py-1.5 text-zinc-700 dark:text-zinc-300">{it.department || "—"}</td>
                      <td className="px-2 py-1.5 text-zinc-700 dark:text-zinc-300">{it.installLocation || "—"}</td>
                    </tr>
                  ))}
                  {filteredItems.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-2 py-6 text-center text-zinc-400">
                        ไม่พบรายการ
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {selectedRows.length > 0 && (
            <div className={`${CARD} flex flex-col gap-3 p-4`}>
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                ปรับ &quot;สถานที่ตั้ง&quot; / &quot;ผู้รับผิดชอบครุภัณฑ์&quot; ก่อนพิมพ์ (ถ้าข้อมูลในระบบไม่ตรงกับปัจจุบัน)
              </p>
              <div className="flex flex-col gap-2">
                {selectedRows.map((row) => (
                  <div
                    key={row.rowNumber}
                    className="grid grid-cols-1 gap-2 border-b border-zinc-50 pb-2 last:border-0 sm:grid-cols-3 dark:border-zinc-800/60"
                  >
                    <span className="self-center text-xs text-zinc-500 dark:text-zinc-400">
                      {row.assetNumber || "—"} · {row.description || "—"}
                    </span>
                    <input
                      type="text"
                      value={row.location}
                      onChange={(e) => updateOverride(row.rowNumber, "location", e.target.value)}
                      placeholder="สถานที่ตั้ง"
                      className={INPUT_CLASS}
                    />
                    <input
                      type="text"
                      value={row.responsiblePerson}
                      onChange={(e) => updateOverride(row.rowNumber, "responsiblePerson", e.target.value)}
                      placeholder="ผู้รับผิดชอบครุภัณฑ์"
                      className={INPUT_CLASS}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* The printable form itself — kept visible on screen too (as a live
            preview) so what ends up on paper is never a surprise. */}
        <div className="print-area rounded-2xl border border-zinc-200 bg-white p-8 text-zinc-900 shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
          <div className="flex flex-col items-center gap-1 text-center">
            <p className="text-base font-bold">{settings.orgName}</p>
            <p className="text-base font-bold">{settings.maintenanceFormTitle}</p>
            <p className="text-sm">{settings.fiscalYearLabel}</p>
            {formDepartment && <p className="mt-1 text-sm">กลุ่มงาน: {formDepartment}</p>}
          </div>

          <div className="mt-5">
            <p className="mb-2 text-sm font-semibold">ส่วนที่ 1 ข้อมูลครุภัณฑ์ที่ดำเนินการบำรุงรักษา</p>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  <th className="border border-zinc-400 px-1.5 py-1 font-medium">ลำดับ</th>
                  <th className="border border-zinc-400 px-1.5 py-1 font-medium">หมายเลขครุภัณฑ์</th>
                  <th className="border border-zinc-400 px-1.5 py-1 font-medium">รายการครุภัณฑ์</th>
                  <th className="border border-zinc-400 px-1.5 py-1 font-medium">สถานที่ตั้ง</th>
                  <th className="border border-zinc-400 px-1.5 py-1 font-medium">ผู้รับผิดชอบครุภัณฑ์</th>
                  <th className="border border-zinc-400 px-1.5 py-1 font-medium">วันที่</th>
                  <th className="border border-zinc-400 px-1.5 py-1 font-medium">ช่วงเวลา</th>
                </tr>
              </thead>
              <tbody>
                {selectedRows.map((row, i) => (
                  <tr key={row.rowNumber}>
                    <td className="border border-zinc-400 px-1.5 py-1 text-center">{i + 1}</td>
                    <td className="border border-zinc-400 px-1.5 py-1">{row.assetNumber || "—"}</td>
                    <td className="border border-zinc-400 px-1.5 py-1">{row.description || "—"}</td>
                    <td className="border border-zinc-400 px-1.5 py-1">{row.location || "—"}</td>
                    <td className="border border-zinc-400 px-1.5 py-1">{row.responsiblePerson || "—"}</td>
                    <td className="border border-zinc-400 px-1.5 py-1 whitespace-nowrap">{displayDate || "—"}</td>
                    <td className="border border-zinc-400 px-1.5 py-1 whitespace-nowrap">{timeRangeLabel || "—"}</td>
                  </tr>
                ))}
                {selectedRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="border border-zinc-400 px-1.5 py-6 text-center text-zinc-400">
                      ยังไม่ได้เลือกครุภัณฑ์ — เลือกจากรายการด้านบนก่อนพิมพ์
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-6">
            <p className="mb-2 text-sm font-semibold">ส่วนที่ 2 ผลการบำรุงรักษา</p>
            <div className="flex flex-col gap-3 text-sm">
              <div className="flex flex-wrap gap-x-8 gap-y-2">
                <span>วันที่ดำเนินการ .............................................</span>
                <span>ผู้ดำเนินการ .............................................</span>
              </div>
              <div>
                <p>ผลการตรวจเช็ค</p>
                <div className="mt-1 flex flex-col gap-3">
                  <span className="block border-b border-zinc-400">&nbsp;</span>
                  <span className="block border-b border-zinc-400">&nbsp;</span>
                </div>
              </div>
              <p>
                สถานะการดำเนินการ&nbsp;&nbsp;☐ ปกติ&nbsp;&nbsp;&nbsp;☐ ต้องซ่อม&nbsp;&nbsp;&nbsp;☐ เปลี่ยนอะไหล่&nbsp;&nbsp;&nbsp;☐
                อื่นๆ ระบุ ....................................................
              </p>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-8 text-center text-sm sm:grid-cols-2">
            <div className="flex flex-col items-center gap-1">
              <p>ลงชื่อ ....................................................... ผู้ตรวจสอบ</p>
              <p>(.......................................................)</p>
              <p>ตำแหน่ง .......................................................</p>
              <p>กลุ่มงานผู้รับบริการ</p>
            </div>
            <div className="flex flex-col items-center gap-1">
              <p>ลงชื่อ ....................................................... ผู้รับทราบ</p>
              <p>({settings.acknowledgerName})</p>
              <p>ตำแหน่ง {settings.acknowledgerPosition}</p>
              <p>{settings.acknowledgerDepartment}</p>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          @page { size: A4; margin: 14mm; }
          html, body { background: #fff !important; }
          .no-print { display: none !important; }
          .print-area, .print-area * { color: #000 !important; border-color: #52525b !important; }
          .print-area tr { break-inside: avoid; }
        }
      `}</style>
    </main>
  );
}
