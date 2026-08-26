"use client";

import { useMemo, useState, type CSSProperties } from "react";
import Image from "next/image";
import dynamic from "next/dynamic";
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  Building2,
  Clock,
  Filter,
  ListChecks,
  Package,
  RefreshCw,
  X,
} from "lucide-react";
import type { SheetSnapshot } from "@/lib/sheets";
import {
  DISPLAY_COLUMNS,
  getCellValue,
  unresolvedColumns,
  type EquipmentRow,
  type FieldMap,
} from "@/lib/fields";
import { assignCategoryColors, OTHER_COLOR } from "@/lib/category-colors";

// Code-split the chart (recharts is a sizeable dependency) so it only loads
// once it's actually needed, instead of inflating the dashboard's initial JS.
const TypeBreakdownChart = dynamic(() => import("@/components/TypeBreakdownChart"), {
  ssr: false,
  loading: () => (
    <div
      className="h-48 animate-pulse rounded-xl bg-zinc-100 motion-reduce:animate-none dark:bg-zinc-800"
      aria-hidden="true"
    />
  ),
});

type LoadResult = SheetSnapshot | { error: string };

const UNSPECIFIED = "(ไม่ระบุ)";
const OTHER_BUCKET = "อื่นๆ";

// Shared card treatment: soft border + subtle shadow reads as "elevated" on
// the page wash without being heavy-handed. Border carries a faint green
// tint (rather than flat zinc) to keep the brand read even on quiet cards.
const CARD = "rounded-2xl border border-emerald-900/10 bg-white shadow-sm dark:border-emerald-400/10 dark:bg-zinc-900";

function isError(data: LoadResult): data is { error: string } {
  return "error" in data;
}

function formatTime(iso: string) {
  try {
    // Pin the timezone explicitly — Vercel's server runs in UTC while
    // browsers here run in Asia/Bangkok (UTC+7). Without a fixed timeZone,
    // toLocaleString() uses each runtime's own local zone, so the server-
    // rendered text and the client's first render disagree by 7 hours,
    // which React reports as a hydration mismatch (minified error #418).
    return new Date(iso).toLocaleString("th-TH", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Bangkok",
    });
  } catch {
    return iso;
  }
}

function fieldValue(row: EquipmentRow, header: string | null): string {
  if (!header) return "";
  return (row[header] ?? "").trim();
}

function countBy(rows: EquipmentRow[], header: string | null): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const raw = fieldValue(row, header);
    const key = raw === "" ? UNSPECIFIED : raw;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function sortedByCountDesc(counts: Map<string, number>): [string, number][] {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function uniqueOptions(rows: EquipmentRow[], header: string | null): { value: string; count: number }[] {
  const counts = countBy(rows, header);
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => a.value.localeCompare(b.value, "th"));
}

// Tinted pill background from a category color, kept subtle (≈12% mix) so the
// pill's zinc-700/zinc-200 text keeps its own AA contrast regardless of hue —
// the color communicates category at a glance without being load-bearing for
// legibility. The dot next to the label carries the full-saturation color.
function typeBadgeStyle(color: string): CSSProperties {
  return {
    backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
    borderColor: `color-mix(in srgb, ${color} 35%, transparent)`,
  };
}

export default function Dashboard({ initial }: { initial: LoadResult }) {
  const [data, setData] = useState<LoadResult>(initial);
  const [loading, setLoading] = useState(false);
  const [department, setDepartment] = useState("all");
  const [equipmentType, setEquipmentType] = useState("all");

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch("/api/sheets", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        setData({ error: json.error ?? "โหลดข้อมูลไม่สำเร็จ" });
      } else {
        setData(json as SheetSnapshot);
      }
    } catch (e) {
      setData({ error: e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ" });
    } finally {
      setLoading(false);
    }
  }

  const snapshot = !isError(data) ? data : null;
  const fields: FieldMap | null = snapshot?.fields ?? null;
  const hasActiveFilters = department !== "all" || equipmentType !== "all";

  function clearFilters() {
    setDepartment("all");
    setEquipmentType("all");
  }

  const missingColumns = useMemo(
    () => (fields ? unresolvedColumns(fields) : []),
    [fields]
  );

  const departmentOptions = useMemo(
    () => (snapshot ? uniqueOptions(snapshot.rows, fields?.department ?? null) : []),
    [snapshot, fields]
  );
  const equipmentTypeOptions = useMemo(
    () => (snapshot ? uniqueOptions(snapshot.rows, fields?.equipmentType ?? null) : []),
    [snapshot, fields]
  );

  // Fixed color per equipment type, computed once from the full unfiltered
  // dataset so colors stay stable as filters narrow the results.
  const typeColorMap = useMemo(() => {
    if (!snapshot || !fields) return new Map<string, string>();
    const ranked = sortedByCountDesc(countBy(snapshot.rows, fields.equipmentType)).map(
      ([type]) => type
    );
    return assignCategoryColors(ranked);
  }, [snapshot, fields]);

  const filteredRows = useMemo(() => {
    if (!snapshot || !fields) return [];
    return snapshot.rows.filter((row) => {
      if (department !== "all") {
        const v = fieldValue(row, fields.department) || UNSPECIFIED;
        if (v !== department) return false;
      }
      if (equipmentType !== "all") {
        const v = fieldValue(row, fields.equipmentType) || UNSPECIFIED;
        if (v !== equipmentType) return false;
      }
      return true;
    });
  }, [snapshot, fields, department, equipmentType]);

  // Totals by equipment type — recomputed from filteredRows, so they change
  // live as the filters above narrow the result set.
  const typeBreakdown = useMemo(() => {
    if (!fields) return [];
    const counts = countBy(filteredRows, fields.equipmentType);
    const known: { label: string; count: number }[] = [];
    let otherTotal = 0;
    for (const [type, count] of counts) {
      if (typeColorMap.has(type)) known.push({ label: type, count });
      else otherTotal += count;
    }
    known.sort((a, b) => b.count - a.count);
    if (otherTotal > 0) known.push({ label: OTHER_BUCKET, count: otherTotal });
    return known;
  }, [filteredRows, fields, typeColorMap]);

  // Fixed color per department, same stability rule as typeColorMap: ranked
  // from the full unfiltered dataset so a department's color never changes
  // as filters narrow the visible rows.
  const departmentColorMap = useMemo(() => {
    if (!snapshot || !fields) return new Map<string, string>();
    const ranked = sortedByCountDesc(countBy(snapshot.rows, fields.department)).map(
      ([dep]) => dep
    );
    return assignCategoryColors(ranked);
  }, [snapshot, fields]);

  // Totals by department — recomputed from filteredRows, so they change live
  // as both filters (department, equipment type) narrow the result set.
  const departmentBreakdown = useMemo(() => {
    if (!fields) return [];
    const counts = countBy(filteredRows, fields.department);
    const known: { label: string; count: number }[] = [];
    let otherTotal = 0;
    for (const [dep, count] of counts) {
      if (departmentColorMap.has(dep)) known.push({ label: dep, count });
      else otherTotal += count;
    }
    known.sort((a, b) => b.count - a.count);
    if (otherTotal > 0) known.push({ label: OTHER_BUCKET, count: otherTotal });
    return known;
  }, [filteredRows, fields, departmentColorMap]);

  const filteredDepartmentCount = useMemo(() => {
    if (!fields) return 0;
    return new Set(
      filteredRows.map((row) => fieldValue(row, fields.department) || UNSPECIFIED)
    ).size;
  }, [filteredRows, fields]);

  return (
    <main
      id="main-content"
      aria-busy={loading}
      className="flex w-full flex-1 justify-center bg-[var(--page-bg)] px-4 py-8 sm:px-8 lg:px-12"
    >
      <div className="flex w-full max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Image
              src="/logo.png"
              alt="ตราสัญลักษณ์โรงพยาบาลท่าตะเกียบ"
              width={44}
              height={44}
              priority
              className="h-11 w-11 shrink-0 rounded-2xl object-cover ring-1 ring-zinc-200 dark:ring-zinc-700"
            />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                ทะเบียนครุภัณฑ์คอมพิวเตอร์ โรงพยาบาลท่าตะเกียบ
              </h1>
              <p className="mt-0.5 flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400">
                <Clock size={14} strokeWidth={2} aria-hidden="true" />
                {snapshot ? (
                  <>
                    อัปเดตล่าสุด{" "}
                    <time dateTime={snapshot.fetchedAt}>{formatTime(snapshot.fetchedAt)}</time> · แท็บ &ldquo;
                    {snapshot.tab}&rdquo;
                  </>
                ) : (
                  "ยังไม่มีข้อมูล"
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="flex h-10 items-center justify-center gap-2 self-start rounded-full bg-[var(--brand)] px-5 text-sm font-medium text-[var(--brand-contrast)] shadow-sm transition-colors hover:bg-[var(--brand-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] disabled:opacity-60 sm:self-auto"
          >
            <RefreshCw
              size={16}
              strokeWidth={2}
              className={`motion-reduce:animate-none ${loading ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            {loading ? "กำลังโหลด..." : "รีเฟรชข้อมูล"}
          </button>
        </header>

        {isError(data) && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-900 shadow-sm dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
          >
            <AlertTriangle size={20} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
            <div className="flex-1 text-sm leading-6">
              <p className="font-medium">เชื่อมต่อ Google Sheets ไม่สำเร็จ</p>
              <p className="mt-1 text-red-800/90 dark:text-red-300/90">{data.error}</p>
              <button
                type="button"
                onClick={refresh}
                disabled={loading}
                className="mt-3 rounded-full border border-red-300 bg-white px-4 py-1.5 text-xs font-medium text-red-900 transition-colors hover:bg-red-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:opacity-60 dark:border-red-800 dark:bg-red-950 dark:text-red-200 dark:hover:bg-red-900/60"
              >
                {loading ? "กำลังลองใหม่..." : "ลองอีกครั้ง"}
              </button>
            </div>
          </div>
        )}

        {snapshot && missingColumns.length > 0 && (
          <div
            role="status"
            className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900 shadow-sm dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
          >
            <AlertTriangle size={18} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
            <p className="text-sm leading-6">
              ไม่พบคอลัมน์ต่อไปนี้ในชีต — ชื่อหัวคอลัมน์ในชีตอาจไม่ตรงกับที่คาดไว้:{" "}
              {missingColumns
                .map((key) => DISPLAY_COLUMNS.find((c) => c.key === key)?.label ?? key)
                .join(", ")}
            </p>
          </div>
        )}

        {snapshot && snapshot.rows.length === 0 && (
          <div className={`${CARD} p-8 text-center text-sm text-zinc-500 dark:text-zinc-400`}>
            ยังไม่มีข้อมูลในชีต &ldquo;{snapshot.tab}&rdquo;
          </div>
        )}

        {snapshot && fields && snapshot.rows.length > 0 && (
          <div
            className={`flex flex-col gap-6 transition-opacity ${loading ? "opacity-60" : "opacity-100"}`}
          >
            {/* Filters */}
            <div className={`${CARD} flex flex-col gap-3 p-4`}>
              <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 dark:text-zinc-500">
                <Filter size={13} strokeWidth={2} aria-hidden="true" />
                ตัวกรองข้อมูล
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <FilterSelect
                  label="กลุ่มงาน / งานที่สังกัด"
                  value={department}
                  onChange={setDepartment}
                  options={departmentOptions}
                />
                <FilterSelect
                  label="ประเภทครุภัณฑ์"
                  value={equipmentType}
                  onChange={setEquipmentType}
                  options={equipmentTypeOptions}
                />
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="flex h-9 items-center justify-center gap-1 self-start rounded-lg border border-zinc-200 px-3 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 sm:self-auto"
                  >
                    <X size={14} strokeWidth={2} aria-hidden="true" />
                    ล้างตัวกรอง
                  </button>
                )}
                <span
                  className="text-xs text-zinc-400 sm:ml-auto sm:self-center"
                  aria-live="polite"
                >
                  {filteredRows.length.toLocaleString("th-TH")} / {snapshot.rows.length.toLocaleString("th-TH")} รายการ
                </span>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatTile
                icon={Package}
                color="var(--brand)"
                label="รายการครุภัณฑ์คอมพิวเตอร์"
                value={filteredRows.length.toLocaleString("th-TH")}
              />
              <StatTile
                icon={Boxes}
                color="var(--brand-2)"
                label="ประเภทครุภัณฑ์"
                value={typeBreakdown.length.toLocaleString("th-TH")}
              />
              <StatTile
                icon={Building2}
                color="var(--brand-3)"
                label="กลุ่มงาน / หน่วยงาน"
                value={filteredDepartmentCount.toLocaleString("th-TH")}
              />
            </div>

            {/* Totals by department — mirrors the equipment-type chart below;
                both read from filteredRows, so either filter (or both) updates
                what's plotted here immediately. */}
            {departmentBreakdown.length > 0 && (
              <figure className={`${CARD} p-5`}>
                <figcaption className="mb-4 flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  <BarChart3 size={16} strokeWidth={2} className="text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  ผลรวมแยกตามกลุ่มงาน / งานที่สังกัด
                </figcaption>
                <TypeBreakdownChart data={departmentBreakdown} colorMap={departmentColorMap} />
              </figure>
            )}

            {/* Totals by equipment type */}
            {typeBreakdown.length > 0 && (
              <figure className={`${CARD} p-5`}>
                <figcaption className="mb-4 flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  <BarChart3 size={16} strokeWidth={2} className="text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  ผลรวมแยกตามประเภทครุภัณฑ์
                </figcaption>
                <TypeBreakdownChart data={typeBreakdown} colorMap={typeColorMap} />
              </figure>
            )}

            {/* Records */}
            <div className={CARD}>
              <div className="flex items-center gap-2 border-b border-emerald-900/10 px-4 py-3.5 dark:border-emerald-400/10 sm:px-5">
                <ListChecks size={16} strokeWidth={2} className="text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">รายการทั้งหมด</h2>
              </div>

              {/* Mobile: card list (avoids forcing a 5-column table into a narrow viewport) */}
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60 sm:hidden">
                {filteredRows.map((row, i) => {
                  const typeValue = getCellValue(row, "equipmentType", fields);
                  const color = typeValue ? typeColorMap.get(typeValue) ?? OTHER_COLOR : OTHER_COLOR;
                  return (
                    <li key={i} className="flex flex-col gap-2 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium text-zinc-900 dark:text-zinc-100">
                          {getCellValue(row, "fullName", fields) || (
                            <span className="text-zinc-300 dark:text-zinc-600">—</span>
                          )}
                        </span>
                        {typeValue && (
                          <span
                            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-200"
                            style={typeBadgeStyle(color)}
                          >
                            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
                            {typeValue}
                          </span>
                        )}
                      </div>
                      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                        <dt className="font-medium">ประทับเวลา</dt>
                        <dd>{getCellValue(row, "timestamp", fields) || "—"}</dd>
                        <dt className="font-medium">กลุ่มงาน/สังกัด</dt>
                        <dd>{getCellValue(row, "department", fields) || "—"}</dd>
                      </dl>
                    </li>
                  );
                })}
                {filteredRows.length === 0 && (
                  <li className="px-4 py-8 text-center text-sm text-zinc-400">ไม่พบรายการที่ตรงกับตัวกรอง</li>
                )}
              </ul>

              {/* Desktop: full table */}
              <div className="hidden max-w-full overflow-x-auto sm:block">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">
                    ตารางรายการครุภัณฑ์ {filteredRows.length.toLocaleString("th-TH")} รายการ
                  </caption>
                  <thead>
                    <tr className="border-b border-emerald-900/15 text-xs uppercase tracking-wide text-zinc-400 dark:border-emerald-400/15">
                      {DISPLAY_COLUMNS.map((col) => (
                        <th key={col.key} scope="col" className="whitespace-nowrap px-4 py-3 font-medium">
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row, i) => (
                      <tr
                        key={i}
                        className="border-b border-zinc-100 transition-colors last:border-0 hover:bg-emerald-50/70 dark:border-zinc-800/60 dark:hover:bg-emerald-900/10"
                      >
                        {DISPLAY_COLUMNS.map((col) => {
                          const value = getCellValue(row, col.key, fields);
                          if (col.key === "equipmentType" && value) {
                            const color = typeColorMap.get(value) ?? OTHER_COLOR;
                            return (
                              <td key={col.key} className="whitespace-nowrap px-4 py-2.5">
                                <span
                                  className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-200"
                                  style={typeBadgeStyle(color)}
                                >
                                  <span
                                    className="h-1.5 w-1.5 rounded-full"
                                    style={{ backgroundColor: color }}
                                    aria-hidden="true"
                                  />
                                  {value}
                                </span>
                              </td>
                            );
                          }
                          return (
                            <td
                              key={col.key}
                              className={`whitespace-nowrap px-4 py-2.5 text-zinc-700 dark:text-zinc-300 ${
                                col.key === "fullName" ? "font-medium text-zinc-900 dark:text-zinc-100" : ""
                              }`}
                            >
                              {value || <span className="text-zinc-300 dark:text-zinc-600">—</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    {filteredRows.length === 0 && (
                      <tr>
                        <td colSpan={DISPLAY_COLUMNS.length} className="px-4 py-8 text-center text-zinc-400">
                          ไม่พบรายการที่ตรงกับตัวกรอง
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function StatTile({
  icon: Icon,
  color,
  label,
  value,
}: {
  icon: typeof Package;
  color: string;
  label: string;
  value: string;
}) {
  return (
    <div className={`${CARD} flex items-center gap-3 p-4`}>
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)` }}
        aria-hidden="true"
      >
        <Icon size={18} strokeWidth={2} style={{ color }} />
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
        <p className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">{value}</p>
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; count: number }[];
}) {
  return (
    <label className="flex flex-1 flex-col gap-1 text-xs text-zinc-500 dark:text-zinc-400 sm:max-w-xs">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-lg border border-zinc-200 bg-white px-2.5 text-sm text-zinc-900 transition-colors hover:border-zinc-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:border-zinc-600"
      >
        <option value="all">ทั้งหมด</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.value} ({opt.count.toLocaleString("th-TH")})
          </option>
        ))}
      </select>
    </label>
  );
}
