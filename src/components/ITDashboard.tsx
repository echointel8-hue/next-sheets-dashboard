"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  Cpu,
  FileText,
  Filter,
  Loader2,
  LogOut,
  Package,
  Printer,
  Save,
  Settings,
  X,
} from "lucide-react";
import {
  PC_ONLY_FIELD_HEADERS,
  PRINTER_ONLY_FIELD_HEADERS,
  STATUS_DISPOSED,
  classifyEquipmentType,
  getAssetNumber,
  getBrandModel,
  getFullName,
  type EquipmentRow,
  type FieldMap,
} from "@/lib/fields";
import type { ReportSettings } from "@/lib/sheets";
import MultiSelect from "@/components/MultiSelect";

export interface ITRecord {
  rowNumber: number;
  values: EquipmentRow;
  snapshotHash: string;
}

export interface ITDashboardData {
  headers: string[];
  fields: FieldMap;
  rows: ITRecord[];
}

type ITLoadResult = ITDashboardData | { error: string };

function isError(data: ITLoadResult): data is { error: string } {
  return "error" in data;
}

function cell(row: EquipmentRow, header: string | null): string {
  if (!header) return "";
  return (row[header] ?? "").trim();
}

/** The PC/printer-only spec constants (fields.ts) are matched against the
 * sheet's *actual* header text by trim-equality (see fields.ts headerIn) —
 * this resolves each fixed label to whichever real header string the
 * current sheet actually uses, so a cell lookup below always indexes the
 * row with a header that's really there. */
function resolveHeader(headers: string[], candidate: string): string | null {
  const target = candidate.trim();
  return headers.find((h) => h.trim() === target) ?? null;
}

const CARD = "rounded-2xl border border-emerald-900/10 bg-white shadow-sm dark:border-emerald-400/10 dark:bg-zinc-900";

interface SpecColumn {
  label: string;
  header: string | null;
}

export default function ITDashboard({
  session,
  initial,
  initialSettings,
}: {
  session: { username: string; isBootstrap: boolean };
  initial: ITLoadResult;
  initialSettings: ReportSettings | null;
}) {
  const router = useRouter();
  const [data] = useState<ITLoadResult>(initial);
  const [departmentFilter, setDepartmentFilter] = useState<string[]>([]);
  const [equipmentTypeFilter, setEquipmentTypeFilter] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  const rows = useMemo(() => (!isError(data) ? data.rows : []), [data]);
  const headers = useMemo(() => (!isError(data) ? data.headers : []), [data]);
  const fields = !isError(data) ? data.fields : null;

  const departmentOptions = useMemo(() => {
    if (!fields) return [];
    const set = new Set<string>();
    for (const r of rows) {
      const v = cell(r.values, fields.department);
      if (v) set.add(v);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "th")).map((value) => ({ value }));
  }, [rows, fields]);

  const equipmentTypeOptions = useMemo(() => {
    if (!fields) return [];
    const set = new Set<string>();
    for (const r of rows) {
      const v = cell(r.values, fields.equipmentType);
      if (v) set.add(v);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "th")).map((value) => ({ value }));
  }, [rows, fields]);

  const hasActiveFilters = departmentFilter.length > 0 || equipmentTypeFilter.length > 0 || search.trim() !== "";

  function clearFilters() {
    setDepartmentFilter([]);
    setEquipmentTypeFilter([]);
    setSearch("");
  }

  const visibleRows = useMemo(() => {
    if (!fields) return [];
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (departmentFilter.length > 0) {
        const v = cell(r.values, fields.department);
        if (!departmentFilter.includes(v)) return false;
      }
      if (equipmentTypeFilter.length > 0) {
        const v = cell(r.values, fields.equipmentType);
        if (!equipmentTypeFilter.includes(v)) return false;
      }
      if (q) {
        const haystack = [
          getAssetNumber(r.values, fields),
          getBrandModel(r.values, fields),
          getFullName(r.values, fields),
          cell(r.values, fields.installLocation),
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [rows, fields, departmentFilter, equipmentTypeFilter, search]);

  const pcRows = useMemo(
    () => (fields ? visibleRows.filter((r) => classifyEquipmentType(cell(r.values, fields.equipmentType)) === "pc") : []),
    [visibleRows, fields]
  );
  const printerRows = useMemo(
    () =>
      fields ? visibleRows.filter((r) => classifyEquipmentType(cell(r.values, fields.equipmentType)) === "printer") : [],
    [visibleRows, fields]
  );

  const disposedCount = useMemo(
    () => (fields ? visibleRows.filter((r) => cell(r.values, fields.status) === STATUS_DISPOSED).length : 0),
    [visibleRows, fields]
  );

  const pcSpecColumns: SpecColumn[] = useMemo(
    () => [
      { label: "หน่วยประมวลผล", header: resolveHeader(headers, PC_ONLY_FIELD_HEADERS[2]) },
      { label: "ประเภท RAM", header: resolveHeader(headers, PC_ONLY_FIELD_HEADERS[5]) },
      { label: "ความจุ RAM", header: resolveHeader(headers, PC_ONLY_FIELD_HEADERS[6]) },
      { label: "ความเร็ว RAM", header: resolveHeader(headers, PC_ONLY_FIELD_HEADERS[7]) },
      { label: "ประเภทหน่วยจัดเก็บ", header: resolveHeader(headers, PC_ONLY_FIELD_HEADERS[3]) },
      { label: "ความจุจัดเก็บ", header: resolveHeader(headers, PC_ONLY_FIELD_HEADERS[4]) },
    ],
    [headers]
  );

  const printerSpecColumns: SpecColumn[] = useMemo(
    () => [{ label: "ประเภทเครื่องพิมพ์", header: resolveHeader(headers, PRINTER_ONLY_FIELD_HEADERS[2]) }],
    [headers]
  );

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <main className="flex w-full flex-1 justify-center bg-[var(--page-bg)] px-4 py-8 sm:px-6 lg:px-10">
      <div className="flex w-full max-w-[100rem] flex-col gap-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-zinc-950 dark:text-zinc-50 sm:text-2xl">
              แดชบอร์ดงาน IT
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {session.username} · ดูข้อมูล + ออกรายงาน (ไม่สามารถเพิ่ม/แก้ไข/จำหน่ายครุภัณฑ์จากหน้านี้ได้)
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <ArrowLeft size={16} strokeWidth={2} aria-hidden="true" />
              แดชบอร์ดสาธารณะ
            </Link>
            {session.isBootstrap && (
              <Link
                href="/manage"
                className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <Package size={16} strokeWidth={2} aria-hidden="true" />
                จัดการครุภัณฑ์ทั่วไป
              </Link>
            )}
            <Link
              href="/manage/it/report"
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--brand)] px-4 py-2 text-sm font-medium text-[var(--brand-contrast)] transition-colors hover:bg-[var(--brand-strong)]"
            >
              <FileText size={16} strokeWidth={2} aria-hidden="true" />
              ออกรายงาน
            </Link>
            <button
              type="button"
              onClick={logout}
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <LogOut size={16} strokeWidth={2} aria-hidden="true" />
              ออกจากระบบ
            </button>
          </div>
        </header>

        {isError(data) && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-900 shadow-sm dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
          >
            <AlertTriangle size={22} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
            <p className="flex-1 text-base leading-7">{data.error}</p>
          </div>
        )}

        {!isError(data) && (
          <>
            {/* Stat tiles */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className={`${CARD} flex flex-col gap-1 p-4`}>
                <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 dark:text-zinc-500">
                  <Package size={14} strokeWidth={2} aria-hidden="true" />
                  ครุภัณฑ์ทั้งหมด
                </div>
                <span className="text-2xl font-bold text-zinc-950 dark:text-zinc-50">
                  {visibleRows.length.toLocaleString("th-TH")}
                </span>
              </div>
              <div className={`${CARD} flex flex-col gap-1 p-4`}>
                <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 dark:text-zinc-500">
                  <Cpu size={14} strokeWidth={2} aria-hidden="true" />
                  คอมพิวเตอร์ / โน้ตบุ๊ก
                </div>
                <span className="text-2xl font-bold text-zinc-950 dark:text-zinc-50">
                  {pcRows.length.toLocaleString("th-TH")}
                </span>
              </div>
              <div className={`${CARD} flex flex-col gap-1 p-4`}>
                <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 dark:text-zinc-500">
                  <Printer size={14} strokeWidth={2} aria-hidden="true" />
                  เครื่องพิมพ์
                </div>
                <span className="text-2xl font-bold text-zinc-950 dark:text-zinc-50">
                  {printerRows.length.toLocaleString("th-TH")}
                </span>
              </div>
              <div className={`${CARD} flex flex-col gap-1 p-4`}>
                <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 dark:text-zinc-500">
                  <Building2 size={14} strokeWidth={2} aria-hidden="true" />
                  จำหน่ายแล้ว
                </div>
                <span className="text-2xl font-bold text-zinc-950 dark:text-zinc-50">
                  {disposedCount.toLocaleString("th-TH")}
                </span>
              </div>
            </div>

            {/* Filters */}
            <div className={`${CARD} flex flex-col gap-3 p-4`}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 text-sm font-medium text-zinc-400 dark:text-zinc-500">
                  <Filter size={15} strokeWidth={2} aria-hidden="true" />
                  ตัวกรองข้อมูล
                </div>
                <button
                  type="button"
                  onClick={() => setShowSettings((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  <Settings size={14} strokeWidth={2} aria-hidden="true" />
                  ตั้งค่าแบบฟอร์มรายงาน
                </button>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                <MultiSelect
                  label="กลุ่มงาน"
                  options={departmentOptions}
                  selected={departmentFilter}
                  onChange={setDepartmentFilter}
                  className="sm:max-w-xs sm:flex-1"
                />
                <MultiSelect
                  label="ประเภทครุภัณฑ์"
                  options={equipmentTypeOptions}
                  selected={equipmentTypeFilter}
                  onChange={setEquipmentTypeFilter}
                  className="sm:max-w-xs sm:flex-1"
                />
                <label className="flex flex-col gap-1 text-sm text-zinc-500 dark:text-zinc-400 sm:max-w-xs sm:flex-1">
                  ค้นหา
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="เลขครุภัณฑ์ / ยี่ห้อ / รุ่น / ผู้ใช้งาน / สถานที่"
                    className="h-11 rounded-lg border border-zinc-200 bg-white px-3 text-base text-zinc-900 transition-colors placeholder:text-zinc-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  />
                </label>
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="flex h-11 items-center justify-center gap-1 self-start rounded-lg border border-zinc-200 px-3 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 sm:self-auto"
                  >
                    <X size={16} strokeWidth={2} aria-hidden="true" />
                    ล้างตัวกรอง
                  </button>
                )}
                <span className="text-sm text-zinc-400 sm:ml-auto sm:self-center" aria-live="polite">
                  {visibleRows.length.toLocaleString("th-TH")} / {rows.length.toLocaleString("th-TH")} รายการ
                </span>
              </div>
            </div>

            {showSettings && (
              <ReportSettingsPanel initialSettings={initialSettings} onClose={() => setShowSettings(false)} />
            )}

            <SpecTable
              title="คอมพิวเตอร์ / โน้ตบุ๊ก / All-in-One"
              icon={<Cpu size={16} strokeWidth={2} aria-hidden="true" />}
              rows={pcRows}
              fields={fields}
              specColumns={pcSpecColumns}
            />

            <SpecTable
              title="เครื่องพิมพ์"
              icon={<Printer size={16} strokeWidth={2} aria-hidden="true" />}
              rows={printerRows}
              fields={fields}
              specColumns={printerSpecColumns}
            />
          </>
        )}
      </div>
    </main>
  );
}

function SpecTable({
  title,
  icon,
  rows,
  fields,
  specColumns,
}: {
  title: string;
  icon: React.ReactNode;
  rows: ITRecord[];
  fields: FieldMap | null;
  specColumns: SpecColumn[];
}) {
  return (
    <div className={CARD}>
      <div className="flex items-center gap-2 border-b border-emerald-900/10 px-4 py-3 text-sm font-semibold text-zinc-800 dark:border-emerald-400/10 dark:text-zinc-100">
        {icon}
        {title}
        <span className="ml-auto text-xs font-normal text-zinc-400">
          {rows.length.toLocaleString("th-TH")} รายการ
        </span>
      </div>
      <div className="max-w-full overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-[11px] sm:text-xs lg:text-sm">
          <thead>
            <tr className="border-b border-emerald-900/15 text-[10px] uppercase tracking-wide text-zinc-400 dark:border-emerald-400/15">
              <th scope="col" className="px-2 py-2 font-medium sm:px-3">เลขครุภัณฑ์</th>
              <th scope="col" className="px-2 py-2 font-medium sm:px-3">กลุ่มงาน</th>
              <th scope="col" className="px-2 py-2 font-medium sm:px-3">ยี่ห้อ / รุ่น</th>
              {specColumns.map((c) => (
                <th key={c.label} scope="col" className="px-2 py-2 font-medium sm:px-3">
                  {c.label}
                </th>
              ))}
              <th scope="col" className="px-2 py-2 font-medium sm:px-3">สถานที่ / จุดติดตั้ง</th>
              <th scope="col" className="px-2 py-2 font-medium sm:px-3">ผู้ใช้งาน</th>
              <th scope="col" className="px-2 py-2 font-medium sm:px-3">สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const disposed = fields ? cell(r.values, fields.status) === STATUS_DISPOSED : false;
              return (
                <tr
                  key={r.rowNumber}
                  className="border-b border-zinc-100 transition-colors last:border-0 hover:bg-emerald-50/70 dark:border-zinc-800/60 dark:hover:bg-emerald-900/10"
                >
                  <td className="break-words px-2 py-2 align-top leading-snug text-zinc-700 dark:text-zinc-300 sm:px-3">
                    {(fields && getAssetNumber(r.values, fields)) || "—"}
                  </td>
                  <td className="break-words px-2 py-2 align-top leading-snug text-zinc-700 dark:text-zinc-300 sm:px-3">
                    {(fields && cell(r.values, fields.department)) || "—"}
                  </td>
                  <td className="break-words px-2 py-2 align-top leading-snug font-medium text-zinc-900 dark:text-zinc-100 sm:px-3">
                    {(fields && getBrandModel(r.values, fields)) || "—"}
                  </td>
                  {specColumns.map((c) => (
                    <td
                      key={c.label}
                      className="break-words px-2 py-2 align-top leading-snug text-zinc-700 dark:text-zinc-300 sm:px-3"
                    >
                      {cell(r.values, c.header) || "—"}
                    </td>
                  ))}
                  <td className="break-words px-2 py-2 align-top leading-snug text-zinc-700 dark:text-zinc-300 sm:px-3">
                    {(fields && cell(r.values, fields.installLocation)) || "—"}
                  </td>
                  <td className="break-words px-2 py-2 align-top leading-snug text-zinc-700 dark:text-zinc-300 sm:px-3">
                    {(fields && getFullName(r.values, fields)) || "—"}
                  </td>
                  <td className="px-2 py-2 align-top sm:px-3">
                    {disposed ? (
                      <span className="inline-flex items-center rounded-full border border-zinc-300 bg-zinc-50 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                        จำหน่ายแล้ว
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                        ใช้งาน
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5 + specColumns.length} className="px-4 py-10 text-center text-zinc-400">
                  <Package size={22} strokeWidth={2} className="mx-auto mb-2 opacity-60" aria-hidden="true" />
                  ไม่มีรายการ
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const SETTINGS_FIELD_LABELS: { key: keyof ReportSettings; label: string }[] = [
  { key: "orgName", label: "ชื่อหน่วยงาน" },
  { key: "maintenanceFormTitle", label: "ชื่อแบบฟอร์ม" },
  { key: "fiscalYearLabel", label: "ปีงบประมาณ (ข้อความแสดงผล)" },
  { key: "acknowledgerName", label: "ชื่อผู้รับทราบ" },
  { key: "acknowledgerPosition", label: "ตำแหน่งผู้รับทราบ" },
  { key: "acknowledgerDepartment", label: "สังกัดผู้รับทราบ (แสดงใต้ตำแหน่ง)" },
];

/** Editable text pieces for the printed maintenance-report template — see
 * lib/sheets.ts getReportSettings/updateReportSettings and the ReportSettings
 * sheet tab. Reachable by "it" and the bootstrap superadmin only, same as
 * the rest of this page (the API route enforces this independently). */
function ReportSettingsPanel({
  initialSettings,
  onClose,
}: {
  initialSettings: ReportSettings | null;
  onClose: () => void;
}) {
  const [values, setValues] = useState<Partial<ReportSettings>>(initialSettings ?? {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function setField(key: keyof ReportSettings, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/manage/it/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "บันทึกไม่สำเร็จ");
        return;
      }
      setValues(json.settings);
      setSaved(true);
    } catch {
      setError("บันทึกไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`${CARD} flex flex-col gap-3 p-4`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
          <Settings size={15} strokeWidth={2} aria-hidden="true" />
          ตั้งค่าข้อความในแบบฟอร์มรายงาน
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
          aria-label="ปิด"
        >
          <X size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        ข้อความเหล่านี้จะแสดงในหัวแบบฟอร์มและช่องผู้รับทราบของ &quot;แบบฟอร์มการบำรุงรักษาเชิงป้องกัน&quot; ที่ออกจากหน้านี้ — ส่วนที่ 2
        (ผลการบำรุงรักษา) และการลงนามอื่นๆ เว้นว่างให้กรอกด้วยลายมือหลังพิมพ์เสมอ
      </p>
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {SETTINGS_FIELD_LABELS.map(({ key, label }) => (
          <label key={key} className="flex flex-col gap-1 text-sm text-zinc-500 dark:text-zinc-400">
            {label}
            <input
              type="text"
              value={values[key] ?? ""}
              onChange={(e) => setField(key, e.target.value)}
              className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-full bg-[var(--brand)] px-4 py-2 text-sm font-medium text-[var(--brand-contrast)] transition-colors hover:bg-[var(--brand-strong)] disabled:opacity-60"
        >
          {saving ? (
            <Loader2 size={15} strokeWidth={2} className="animate-spin" aria-hidden="true" />
          ) : (
            <Save size={15} strokeWidth={2} aria-hidden="true" />
          )}
          บันทึก
        </button>
        {saved && <span className="text-sm text-emerald-600 dark:text-emerald-400">บันทึกแล้ว</span>}
      </div>
    </div>
  );
}
