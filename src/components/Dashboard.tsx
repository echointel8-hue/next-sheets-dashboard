"use client";

import { useMemo, useState, type CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  Building2,
  Clock,
  Filter,
  ListChecks,
  LogIn,
  Package,
  RefreshCw,
  X,
} from "lucide-react";
import type { SheetSnapshot } from "@/lib/sheets";
import {
  DISPLAY_COLUMNS,
  getAssetNumber,
  getCellValue,
  isHidden,
  unresolvedColumns,
  type ColumnKey,
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

const THAI_MONTHS_SHORT = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

/**
 * Reformats the row's raw "ประทับเวลา" text — Google Sheets' own
 * D/M/YYYY[, H:MM:SS] Gregorian text, appended automatically by Google
 * Forms — into a short Thai date: day, abbreviated Thai month, Buddhist
 * year (e.g. "31/7/2026, 10:39:17" -> "31 ก.ค. 2569"). Parsed with a plain
 * regex on the literal text rather than `new Date(...)`: the raw string
 * carries no timezone marker, so handing it to Date() would have the
 * server (UTC) and the browser (Asia/Bangkok) parse the same text as
 * different moments — the same hydration-mismatch class of bug that
 * formatTime() above pins a timeZone to avoid — so this sidesteps it
 * entirely by never constructing a Date. Text that doesn't match the
 * expected D/M/YYYY shape is shown as-is rather than guessed at.
 */
function formatDateOnly(raw: string): string {
  const match = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return raw;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12) return raw;
  return `${day} ${THAI_MONTHS_SHORT[month - 1]} ${year + 543}`;
}

// Column widths for the desktop table (table-fixed, so these are load-
// bearing — without them the browser sizes columns from unwrapped content
// and long-text columns force a horizontal scrollbar). Percentages sum to
// 100; department gets the largest share since its values run longest,
// followed by the name column (which also carries the stacked asset-number
// line). timestamp stays short enough for one line; equipmentType wraps
// too now (a long type label no longer fits nowrap at laptop widths).
// position isn't rendered (not in DISPLAY_COLUMNS).
const COLUMN_WIDTH: Record<ColumnKey, string> = {
  timestamp: "w-[13%]",
  department: "w-[32%]",
  fullName: "w-[28%]",
  equipmentType: "w-[27%]",
  position: "w-0",
};

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

  // Equipment that's been "จำหน่าย" (disposed) or "ลบ" (deleted, bootstrap
  // superadmin only) through /manage stays in the sheet as a permanent
  // record (soft delete — see fields.ts isHidden) but isn't part of the
  // *current* registry this public dashboard shows or counts.
  const activeRecords = useMemo(
    () => (snapshot ? snapshot.rows.filter((r) => !isHidden(r.data, snapshot.fields)) : []),
    [snapshot]
  );

  // rawRows strips the row-number pairing back down to plain EquipmentRow[]
  // for the aggregate helpers below, which don't care which physical row a
  // value came from.
  const rawRows = useMemo(() => activeRecords.map((r) => r.data), [activeRecords]);

  const departmentOptions = useMemo(
    () => (snapshot ? uniqueOptions(rawRows, fields?.department ?? null) : []),
    [snapshot, rawRows, fields]
  );
  const equipmentTypeOptions = useMemo(
    () => (snapshot ? uniqueOptions(rawRows, fields?.equipmentType ?? null) : []),
    [snapshot, rawRows, fields]
  );

  // Fixed color per equipment type, computed once from the full unfiltered
  // dataset so colors stay stable as filters narrow the results.
  const typeColorMap = useMemo(() => {
    if (!snapshot || !fields) return new Map<string, string>();
    const ranked = sortedByCountDesc(countBy(rawRows, fields.equipmentType)).map(
      ([type]) => type
    );
    return assignCategoryColors(ranked);
  }, [snapshot, fields, rawRows]);

  const filteredRecords = useMemo(() => {
    if (!snapshot || !fields) return [];
    return activeRecords.filter((record) => {
      if (department !== "all") {
        const v = fieldValue(record.data, fields.department) || UNSPECIFIED;
        if (v !== department) return false;
      }
      if (equipmentType !== "all") {
        const v = fieldValue(record.data, fields.equipmentType) || UNSPECIFIED;
        if (v !== equipmentType) return false;
      }
      return true;
    });
  }, [snapshot, fields, department, equipmentType, activeRecords]);

  // Kept alongside filteredRecords rather than rewriting every consumer —
  // the aggregate helpers below (typeBreakdown, departmentBreakdown, ...)
  // were written for plain EquipmentRow[] and don't need a row number, so
  // only the two render loops that add the edit button use filteredRecords
  // directly.
  const filteredRows = useMemo(() => filteredRecords.map((r) => r.data), [filteredRecords]);

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

  // Single flat color for every department bar, rather than one hue per
  // department. There can be well over the categorical palette's 8-slot cap
  // here (hospital departments run ~18) — cycling/reusing hues past 8 makes
  // adjacent bars indistinguishable, especially for colorblind viewers (see
  // the dataviz skill's anti-patterns: "cycling hues past 8"). This chart
  // doesn't need color to carry identity anyway — each bar already has its
  // own department-name label directly beside it — so every department maps
  // to the same brand color and gets its own bar, with no "Other" bucket.
  const departmentColorMap = useMemo(() => {
    if (!snapshot || !fields) return new Map<string, string>();
    const map = new Map<string, string>();
    for (const row of rawRows) {
      const dep = fieldValue(row, fields.department) || UNSPECIFIED;
      // A subtle brand-hued gradient (defined once inside TypeBreakdownChart)
      // rather than a flat fill — still exactly one color family for every
      // bar, just with a bit of visual life instead of reading as plain.
      if (!map.has(dep)) map.set(dep, "url(#brandBarGradient)");
    }
    return map;
  }, [snapshot, fields, rawRows]);

  // Totals by department — recomputed from filteredRows, so they change live
  // as both filters (department, equipment type) narrow the result set.
  // Every distinct department gets its own bar (see departmentColorMap above
  // for why this one doesn't need an 8-category cap / "Other" fold).
  const departmentBreakdown = useMemo(() => {
    if (!fields) return [];
    return sortedByCountDesc(countBy(filteredRows, fields.department)).map(
      ([label, count]) => ({ label, count })
    );
  }, [filteredRows, fields]);

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
        <div className="flex justify-end">
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 text-sm text-zinc-400 transition-colors hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
          >
            <LogIn size={14} strokeWidth={2} aria-hidden="true" />
            เข้าสู่ระบบจัดการ
          </Link>
        </div>
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
            <div className="min-w-0">
              {/* Sized down on narrow screens and up from there — at the
                  desktop-only size this used to carry on mobile too, a
                  logo-width column left too little room for this long a
                  title, forcing 4+ cramped wrapped lines. leading-tight
                  keeps a 2-line wrap (still expected on a phone, for a
                  name this long) looking deliberate instead of cramped. */}
              <h1 className="text-xl font-bold leading-tight tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-2xl md:text-3xl">
                ทะเบียนครุภัณฑ์คอมพิวเตอร์ โรงพยาบาลท่าตะเกียบ
              </h1>
              {/* Each date/time and tab-name chunk is its own no-wrap unit
                  inside a wrapping flex row, so a narrow screen wraps
                  *between* phrases (a clean two-line result) instead of
                  splitting a phrase mid-word wherever it happens to run
                  out of width. */}
              <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-zinc-500 dark:text-zinc-400 sm:text-base">
                {snapshot ? (
                  <>
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <Clock size={16} strokeWidth={2} aria-hidden="true" />
                      อัปเดตล่าสุด <time dateTime={snapshot.fetchedAt}>{formatTime(snapshot.fetchedAt)}</time>
                    </span>
                    <span className="whitespace-nowrap">
                      · แท็บ &ldquo;{snapshot.tab}&rdquo;
                    </span>
                  </>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <Clock size={16} strokeWidth={2} aria-hidden="true" />
                    ยังไม่มีข้อมูล
                  </span>
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="flex h-12 items-center justify-center gap-2 self-start rounded-full bg-[var(--brand)] px-6 text-base font-medium text-[var(--brand-contrast)] shadow-sm transition-colors hover:bg-[var(--brand-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] disabled:opacity-60 sm:self-auto"
          >
            <RefreshCw
              size={18}
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
            <AlertTriangle size={22} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
            <div className="flex-1 text-base leading-7">
              <p className="font-medium">เชื่อมต่อ Google Sheets ไม่สำเร็จ</p>
              <p className="mt-1 text-red-800/90 dark:text-red-300/90">{data.error}</p>
              <button
                type="button"
                onClick={refresh}
                disabled={loading}
                className="mt-3 rounded-full border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-900 transition-colors hover:bg-red-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:opacity-60 dark:border-red-800 dark:bg-red-950 dark:text-red-200 dark:hover:bg-red-900/60"
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
            <AlertTriangle size={20} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
            <p className="text-base leading-7">
              ไม่พบคอลัมน์ต่อไปนี้ในชีต — ชื่อหัวคอลัมน์ในชีตอาจไม่ตรงกับที่คาดไว้:{" "}
              {missingColumns
                .map((key) => DISPLAY_COLUMNS.find((c) => c.key === key)?.label ?? key)
                .join(", ")}
            </p>
          </div>
        )}

        {snapshot && snapshot.rows.length === 0 && (
          <div className={`${CARD} p-8 text-center text-base text-zinc-500 dark:text-zinc-400`}>
            ยังไม่มีข้อมูลในชีต &ldquo;{snapshot.tab}&rdquo;
          </div>
        )}

        {snapshot && fields && snapshot.rows.length > 0 && (
          <div
            className={`flex flex-col gap-6 transition-opacity ${loading ? "opacity-60" : "opacity-100"}`}
          >
            {/* Filters */}
            <div className={`${CARD} flex flex-col gap-3 p-4`}>
              <div className="flex items-center gap-1.5 text-sm font-medium text-zinc-400 dark:text-zinc-500">
                <Filter size={15} strokeWidth={2} aria-hidden="true" />
                ตัวกรองข้อมูล
              </div>
              {/* sm:flex-wrap: at tablet-ish widths (~768px) the two
                  sm:max-w-xs selects plus the clear button and the count
                  text don't all fit on one row — without wrapping, the row
                  overflowed past the viewport and forced the whole page to
                  scroll horizontally. Wrapping only ever kicks in when
                  there's genuinely not enough room; wide desktop keeps
                  everything on one line as before. */}
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
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
                    className="flex h-11 items-center justify-center gap-1 self-start rounded-lg border border-zinc-200 px-3 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 sm:self-auto"
                  >
                    <X size={16} strokeWidth={2} aria-hidden="true" />
                    ล้างตัวกรอง
                  </button>
                )}
                <span
                  className="text-sm text-zinc-400 sm:ml-auto sm:self-center"
                  aria-live="polite"
                >
                  {filteredRows.length.toLocaleString("th-TH")} / {activeRecords.length.toLocaleString("th-TH")} รายการ
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
                <figcaption className="mb-4 flex items-center gap-2 text-base font-semibold text-zinc-700 dark:text-zinc-300">
                  <BarChart3 size={18} strokeWidth={2} className="text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  ผลรวมแยกตามกลุ่มงาน / งานที่สังกัด
                </figcaption>
                <TypeBreakdownChart data={departmentBreakdown} colorMap={departmentColorMap} />
              </figure>
            )}

            {/* Totals by equipment type */}
            {typeBreakdown.length > 0 && (
              <figure className={`${CARD} p-5`}>
                <figcaption className="mb-4 flex items-center gap-2 text-base font-semibold text-zinc-700 dark:text-zinc-300">
                  <BarChart3 size={18} strokeWidth={2} className="text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  ผลรวมแยกตามประเภทครุภัณฑ์
                </figcaption>
                <TypeBreakdownChart data={typeBreakdown} colorMap={typeColorMap} />
              </figure>
            )}

            {/* Records */}
            <div className={CARD}>
              <div className="flex items-center gap-2 border-b border-emerald-900/10 px-4 py-3.5 dark:border-emerald-400/10 sm:px-5">
                <ListChecks size={18} strokeWidth={2} className="text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-300">รายการทั้งหมด</h2>
              </div>

              {/* Mobile: card list (avoids forcing a 5-column table into a narrow viewport) */}
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60 sm:hidden">
                {filteredRecords.map((record) => {
                  const row = record.data;
                  const typeValue = getCellValue(row, "equipmentType", fields);
                  const color = typeValue ? typeColorMap.get(typeValue) ?? OTHER_COLOR : OTHER_COLOR;
                  const idValue = getAssetNumber(row, fields);
                  const rawTimestamp = getCellValue(row, "timestamp", fields);
                  return (
                    <li key={record.rowNumber} className="flex flex-col gap-2 p-4">
                      {/* Asset number (when the sheet has that column)
                          reads above the name — it identifies *this item*
                          before the name identifies *who's* responsible
                          for it. Same stacked treatment as the desktop
                          table's fullName cell below. */}
                      {idValue && (
                        <span className="text-sm text-zinc-400 dark:text-zinc-500">
                          เลขครุภัณฑ์ {idValue}
                        </span>
                      )}
                      {/* Name and the equipment-type badge stack (rather
                          than sharing one row) because a real equipment
                          type label ("ชุดคอมพิวเตอร์ตั้งโต๊ะ (Desktop PC)")
                          is long enough that fitting both side by side on
                          a phone width squeezed the name down to wrapping
                          one or two characters per line, while the
                          shrink-0 badge overflowed past the card edge. */}
                      <span className="break-words font-medium text-zinc-900 dark:text-zinc-100">
                        {getCellValue(row, "fullName", fields) || (
                          <span className="text-zinc-300 dark:text-zinc-600">—</span>
                        )}
                      </span>
                      {typeValue && (
                        <span
                          className="inline-flex max-w-full items-center gap-1.5 self-start rounded-full border px-2.5 py-1 text-sm font-medium text-zinc-700 dark:text-zinc-200"
                          style={typeBadgeStyle(color)}
                        >
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
                          <span className="break-words">{typeValue}</span>
                        </span>
                      )}
                      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-sm text-zinc-500 dark:text-zinc-400">
                        <dt className="font-medium">วันที่</dt>
                        <dd>{rawTimestamp ? formatDateOnly(rawTimestamp) : "—"}</dd>
                        <dt className="font-medium">กลุ่มงาน/สังกัด</dt>
                        <dd>{getCellValue(row, "department", fields) || "—"}</dd>
                      </dl>
                    </li>
                  );
                })}
                {filteredRecords.length === 0 && (
                  <li className="px-4 py-8 text-center text-base text-zinc-400">ไม่พบรายการที่ตรงกับตัวกรอง</li>
                )}
              </ul>

              {/* No overflow-x-auto wrapper: table-fixed + explicit per-
                  column widths below (COLUMN_WIDTH) size every column to
                  fit the card's own width, with long text wrapping onto
                  extra lines instead of forcing a horizontal scrollbar —
                  department, the name column, and the type badge all wrap;
                  only the date column stays a strict single line. */}
              <div className="hidden max-w-full sm:block">
                <table className="w-full table-fixed text-left text-base">
                  <caption className="sr-only">
                    ตารางรายการครุภัณฑ์ {filteredRows.length.toLocaleString("th-TH")} รายการ
                  </caption>
                  <thead>
                    <tr className="border-b border-emerald-900/15 text-sm uppercase tracking-wide text-zinc-400 dark:border-emerald-400/15">
                      {DISPLAY_COLUMNS.map((col) => (
                        <th
                          key={col.key}
                          scope="col"
                          className={`px-4 py-3 font-medium ${COLUMN_WIDTH[col.key]} ${
                            col.key === "timestamp" ? "whitespace-nowrap" : ""
                          }`}
                        >
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRecords.map((record) => {
                      const row = record.data;
                      const idValue = getAssetNumber(row, fields);
                      return (
                        <tr
                          key={record.rowNumber}
                          className="border-b border-zinc-100 transition-colors last:border-0 hover:bg-emerald-50/70 dark:border-zinc-800/60 dark:hover:bg-emerald-900/10"
                        >
                          {DISPLAY_COLUMNS.map((col) => {
                            const value = getCellValue(row, col.key, fields);

                            if (col.key === "equipmentType" && value) {
                              const color = typeColorMap.get(value) ?? OTHER_COLOR;
                              return (
                                <td key={col.key} className={`px-4 py-2.5 align-top ${COLUMN_WIDTH[col.key]}`}>
                                  {/* No whitespace-nowrap here — a long type
                                      label ("เครื่องคอมพิวเตอร์โน้ตบุ๊ก
                                      (Notebook)") needs to wrap onto a 2nd
                                      line inside the pill at narrower
                                      desktop widths, or its unbroken text
                                      overflows past the column and forces
                                      the table (and page) to scroll
                                      horizontally — exactly what this
                                      table-fixed layout is meant to avoid. */}
                                  <span
                                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm font-medium text-zinc-700 dark:text-zinc-200"
                                    style={typeBadgeStyle(color)}
                                  >
                                    <span
                                      className="h-2 w-2 shrink-0 rounded-full"
                                      style={{ backgroundColor: color }}
                                      aria-hidden="true"
                                    />
                                    <span className="break-words">{value}</span>
                                  </span>
                                </td>
                              );
                            }

                            if (col.key === "fullName") {
                              // Asset number (muted, small) stacked above
                              // the name — same pairing as the mobile card
                              // list, kept in one column rather than a
                              // separate one so the table doesn't grow a
                              // 5th column competing for width.
                              return (
                                <td key={col.key} className={`px-4 py-2.5 align-top ${COLUMN_WIDTH[col.key]}`}>
                                  <div className="flex min-w-0 flex-col gap-0.5">
                                    {idValue && (
                                      <span className="whitespace-nowrap text-sm text-zinc-400 dark:text-zinc-500">
                                        เลขครุภัณฑ์ {idValue}
                                      </span>
                                    )}
                                    <span className="break-words font-medium text-zinc-900 dark:text-zinc-100">
                                      {value || <span className="text-zinc-300 dark:text-zinc-600">—</span>}
                                    </span>
                                  </div>
                                </td>
                              );
                            }

                            if (col.key === "timestamp") {
                              return (
                                <td key={col.key} className={`whitespace-nowrap px-4 py-2.5 text-zinc-700 dark:text-zinc-300 ${COLUMN_WIDTH[col.key]}`}>
                                  {value ? formatDateOnly(value) : <span className="text-zinc-300 dark:text-zinc-600">—</span>}
                                </td>
                              );
                            }

                            // department — the long one, so it wraps rather
                            // than forcing the column (and the table) wider.
                            return (
                              <td key={col.key} className={`break-words px-4 py-2.5 text-zinc-700 dark:text-zinc-300 ${COLUMN_WIDTH[col.key]}`}>
                                {value || <span className="text-zinc-300 dark:text-zinc-600">—</span>}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                    {filteredRecords.length === 0 && (
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
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)` }}
        aria-hidden="true"
      >
        <Icon size={20} strokeWidth={2} style={{ color }} />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">{label}</p>
        <p className="text-2xl font-bold text-zinc-950 dark:text-zinc-50">{value}</p>
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
    <label className="flex flex-1 flex-col gap-1 text-sm text-zinc-500 dark:text-zinc-400 sm:max-w-xs">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 rounded-lg border border-zinc-200 bg-white px-3 text-base text-zinc-900 transition-colors hover:border-zinc-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:border-zinc-600"
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
