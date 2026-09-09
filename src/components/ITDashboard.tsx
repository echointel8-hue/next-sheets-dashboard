"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Cpu,
  Filter,
  Loader2,
  LogOut,
  Package,
  Pencil,
  Printer,
  Save,
  Users,
  Wrench,
  X,
} from "lucide-react";
import {
  PC_ONLY_FIELD_HEADERS,
  PRINTER_ONLY_FIELD_HEADERS,
  STATUS_ACTIVE,
  STATUS_DISPOSED,
  classifyEquipmentType,
  getAssetNumber,
  getBrandModel,
  getFullName,
  type EquipmentRow,
  type FieldMap,
} from "@/lib/fields";
import type { MaintenanceTask, SpecStandards } from "@/lib/sheets";
import { getLatestMaintenanceLogByAsset, type MaintenanceLogEntry } from "@/lib/maintenanceLog";
import { DEFAULT_SPEC_STANDARDS, evaluateRowSpec } from "@/lib/specEvaluation";
import MultiSelect from "@/components/MultiSelect";
import MaintenanceStatusStrip from "@/components/MaintenanceStatusStrip";
import BulkEditSpecModal, { type BulkEditResult } from "@/components/BulkEditSpecModal";

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

// Short-value spec columns get a fixed, modest width so table-layout:auto
// doesn't stretch them to fill the table's min-width — that stretching is
// what created the large empty gap the hospital flagged around "ประเภท
// RAM" (a 4-character value like "DDR4" doesn't need 150px). Any label not
// listed here (e.g. "หน่วยประมวลผล", "ประเภทเครื่องพิมพ์") is left
// unset/flexible so it naturally absorbs the width freed up from the
// columns above.
/** The at-a-glance status badge shown under the 12-month strip — same idea
 * (and same "กำลังบำรุงรักษาโดย .../เสร็จสิ้นล่าสุดโดย ..." wording) as the
 * badges in the /manage/it/report equipment picker, except this one isn't
 * scoped to any เดือน/ปี filter (the dashboard has none, per the "ดูได้
 * อย่างเดียว" ask) — it just reflects the row's live status: any
 * still-open task wins outright (createMaintenanceTasks only ever leaves
 * at most one in_progress task per equipment at a time), otherwise the
 * most recently completed one, if any. */
function pickInProgressTask(tasks: MaintenanceTask[]): MaintenanceTask | undefined {
  return tasks.find((t) => t.status === "in_progress");
}

function pickLastCompletedTask(tasks: MaintenanceTask[]): MaintenanceTask | undefined {
  let best: MaintenanceTask | undefined;
  for (const t of tasks) {
    if (t.status !== "done") continue;
    const at = t.completedAt || t.createdAt;
    const bestAt = best ? best.completedAt || best.createdAt : "";
    if (!best || at > bestAt) best = t;
  }
  return best;
}

const THAI_MONTHS_FULL = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

/** Same "effective เดือน/ปี" rule as MaintenanceStatusStrip's own
 * monthlyTasks bucketing (deliberately duplicated, not shared — see that
 * component's header comment): a "done" task anchors to when it actually
 * finished (completedAt), a still-open one always counts as "happening
 * right now" (today's real date) so it keeps matching the current
 * เดือน/ปี filter for as long as it stays open. Used only by the new
 * "เดือน/ปีบำรุงรักษา" row filter below, so a filtered result always
 * agrees with whichever month the strip itself highlights for that row. */
function taskEffectiveYearMonth(t: MaintenanceTask): { yearBE: number; month1: number } {
  const iso = t.status === "done" ? t.completedAt || t.createdAt : new Date().toISOString();
  const d = new Date(iso);
  return { yearBE: d.getFullYear() + 543, month1: d.getMonth() + 1 };
}

const SPEC_COLUMN_WIDTH_CLASS: Record<string, string> = {
  "ประเภท RAM": "w-[56px]",
  "ความจุ RAM": "w-[64px]",
  "ความเร็ว RAM": "w-[76px]",
  "ประเภทหน่วยจัดเก็บ": "w-[68px]",
  "ความจุจัดเก็บ": "w-[72px]",
};

export default function ITDashboard({
  session,
  initial,
  initialMaintenanceLog,
  initialMaintenanceTasks,
  actionOptions,
  initialSpecStandards,
}: {
  session: { username: string; isBootstrap: boolean };
  initial: ITLoadResult;
  initialMaintenanceLog: MaintenanceLogEntry[];
  /** Every MaintenanceTask ever created (any equipment, any ปี) — feeds the
   * "แดชบอร์ดงานบำรุงรักษา" per-account summary below and the read-only
   * MaintenanceStatusStrip embedded in each spec table's เลขครุภัณฑ์ cell.
   * Kept as the raw list (not pre-aggregated) so both can be derived
   * client-side without a second round-trip. */
  initialMaintenanceTasks: MaintenanceTask[];
  /** รายการ "การดำเนินการ" (ReportSettings.actionOptions) — only needed here
   * so MaintenanceStatusStrip colors each action exactly the same as
   * /manage/it/report does (see lib/actionColors' index-based assignment). */
  actionOptions: string[];
  initialSpecStandards: SpecStandards | null;
}) {
  const router = useRouter();
  // Not a plain const — a successful bulk edit (see applyBulkEditResult
  // below) patches the affected rows' values in place so the table reflects
  // the save immediately, without a full page reload.
  const [data, setData] = useState<ITLoadResult>(initial);
  const [departmentFilter, setDepartmentFilter] = useState<string[]>([]);
  const [equipmentTypeFilter, setEquipmentTypeFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [maintenanceMonthFilter, setMaintenanceMonthFilter] = useState("");
  const [maintenanceYearFilter, setMaintenanceYearFilter] = useState("");
  const [ramTypeFilter, setRamTypeFilter] = useState<string[]>([]);
  const [ramCapacityFilter, setRamCapacityFilter] = useState<string[]>([]);
  const [ramSpeedFilter, setRamSpeedFilter] = useState<string[]>([]);
  const [storageTypeFilter, setStorageTypeFilter] = useState<string[]>([]);
  const [storageCapacityFilter, setStorageCapacityFilter] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [showSpecSettings, setShowSpecSettings] = useState(false);
  const [maintenanceLog] = useState<MaintenanceLogEntry[]>(initialMaintenanceLog);
  const [maintenanceTasks] = useState<MaintenanceTask[]>(initialMaintenanceTasks);
  const [specStandards, setSpecStandards] = useState<SpecStandards>(initialSpecStandards ?? DEFAULT_SPEC_STANDARDS);
  // เลือกหลายรายการ (เฉพาะตารางคอมพิวเตอร์/โน้ตบุ๊ก/All-in-One) เพื่อแก้ไข
  // ยี่ห้อ/รุ่น/สเปกพร้อมกัน — see BulkEditSpecModal.
  const [selectedRowNumbers, setSelectedRowNumbers] = useState<Set<number>>(new Set());
  const [showBulkEdit, setShowBulkEdit] = useState(false);

  const latestMaintenanceByAsset = useMemo(
    () => getLatestMaintenanceLogByAsset(maintenanceLog),
    [maintenanceLog]
  );

  // Groups every task by its equipmentRowNumber once, so each spec-table row
  // below can look up its own history in O(1) instead of re-filtering the
  // whole list per row (MaintenanceStatusStrip only needs the slice for the
  // one row it's rendering).
  const tasksByRowNumber = useMemo(() => {
    const map = new Map<number, MaintenanceTask[]>();
    for (const t of maintenanceTasks) {
      const list = map.get(t.equipmentRowNumber);
      if (list) list.push(t);
      else map.set(t.equipmentRowNumber, [t]);
    }
    return map;
  }, [maintenanceTasks]);

  // Current พ.ศ. year — MaintenanceStatusStrip always shows this one ปี
  // (view-only here, no year picker, matching the "ดูได้อย่างเดียว" ask).
  const currentYear = useMemo(() => String(new Date().getFullYear() + 543), []);

  // ตัวเลือกปีของตัวกรอง "ปีบำรุงรักษา" — ทุกปี (พ.ศ.) ที่มีงานบำรุงรักษาจริง
  // อยู่แล้ว บวกปีปัจจุบันเสมอ (แม้ยังไม่มีงานเลยในปีนี้) เรียงใหม่ไปเก่า.
  const maintenanceYearOptions = useMemo(() => {
    const set = new Set<string>([currentYear]);
    for (const t of maintenanceTasks) {
      set.add(String(taskEffectiveYearMonth(t).yearBE));
    }
    return [...set].sort((a, b) => Number(b) - Number(a));
  }, [maintenanceTasks, currentYear]);

  // Per-account maintenance workload — "รายงานการดำเนินการของ IT แต่ละท่าน"
  // requested alongside the new dashboard section below. All-time totals
  // (no ปี/เดือน scoping) since this is a running tally of who's done what,
  // not a period report — /manage/it/tasks already covers period filtering
  // in detail for anyone who needs that.
  const technicianStats = useMemo(() => {
    const byUser = new Map<
      string,
      { username: string; displayName: string; total: number; done: number; inProgress: number; lastActivity: string }
    >();
    for (const t of maintenanceTasks) {
      const key = t.assignedToUsername || t.assignedToDisplayName || "ไม่ทราบผู้ดำเนินการ";
      const entry = byUser.get(key) ?? {
        username: t.assignedToUsername,
        displayName: t.assignedToDisplayName || t.assignedToUsername || "ไม่ทราบผู้ดำเนินการ",
        total: 0,
        done: 0,
        inProgress: 0,
        lastActivity: "",
      };
      entry.total += 1;
      if (t.status === "done") entry.done += 1;
      else entry.inProgress += 1;
      const activity = t.status === "done" ? t.completedAt || t.createdAt : t.createdAt;
      if (activity > entry.lastActivity) entry.lastActivity = activity;
      byUser.set(key, entry);
    }
    return [...byUser.values()].sort((a, b) => b.total - a.total);
  }, [maintenanceTasks]);

  const maintenanceTotals = useMemo(
    () => ({
      total: maintenanceTasks.length,
      inProgress: maintenanceTasks.filter((t) => t.status === "in_progress").length,
      done: maintenanceTasks.filter((t) => t.status === "done").length,
    }),
    [maintenanceTasks]
  );

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

  const hasActiveFilters =
    departmentFilter.length > 0 ||
    equipmentTypeFilter.length > 0 ||
    statusFilter.length > 0 ||
    maintenanceMonthFilter !== "" ||
    maintenanceYearFilter !== "" ||
    ramTypeFilter.length > 0 ||
    ramCapacityFilter.length > 0 ||
    ramSpeedFilter.length > 0 ||
    storageTypeFilter.length > 0 ||
    storageCapacityFilter.length > 0 ||
    search.trim() !== "";

  function clearFilters() {
    setDepartmentFilter([]);
    setEquipmentTypeFilter([]);
    setStatusFilter([]);
    setMaintenanceMonthFilter("");
    setMaintenanceYearFilter("");
    setRamTypeFilter([]);
    setRamCapacityFilter([]);
    setRamSpeedFilter([]);
    setStorageTypeFilter([]);
    setStorageCapacityFilter([]);
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
      if (statusFilter.length > 0) {
        const label = cell(r.values, fields.status) === STATUS_DISPOSED ? STATUS_DISPOSED : STATUS_ACTIVE;
        if (!statusFilter.includes(label)) return false;
      }
      if (maintenanceMonthFilter || maintenanceYearFilter) {
        const rowTasks = tasksByRowNumber.get(r.rowNumber) ?? [];
        const matches = rowTasks.some((t) => {
          const eff = taskEffectiveYearMonth(t);
          if (maintenanceMonthFilter && String(eff.month1) !== maintenanceMonthFilter) return false;
          if (maintenanceYearFilter && String(eff.yearBE) !== maintenanceYearFilter) return false;
          return true;
        });
        if (!matches) return false;
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
  }, [
    rows,
    fields,
    departmentFilter,
    equipmentTypeFilter,
    statusFilter,
    maintenanceMonthFilter,
    maintenanceYearFilter,
    tasksByRowNumber,
    search,
  ]);

  const pcRowsAll = useMemo(
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

  // สเปกคอมพิวเตอร์ที่ใช้กรอง — มีผลเฉพาะตารางคอมพิวเตอร์/โน้ตบุ๊ก/All-in-One
  // (ตารางเครื่องพิมพ์ไม่มีคอลัมน์เหล่านี้ จึงไม่ถูกกรองไปด้วย) ตัวเลือกแต่ละ
  // ช่องดึงจากค่าจริงที่มีอยู่ในข้อมูล (หลังกรองตัวกรองอื่นๆ แล้ว แต่ก่อนกรอง
  // ด้วยตัวมันเอง) เพื่อไม่ให้เสนอตัวเลือกที่ไม่มีอยู่จริงในระบบ.
  const specHeaderByLabel = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const c of pcSpecColumns) map[c.label] = c.header;
    return map;
  }, [pcSpecColumns]);

  // One combined useMemo (rather than 5 separate ones each calling a local
  // helper) so the eslint-plugin-react-hooks exhaustive-deps check has a
  // single, simple dependency list — pcRowsAll and specHeaderByLabel are
  // the only two things any of these 5 option lists actually reads.
  const specFilterOptions = useMemo(() => {
    function optionsFor(label: string) {
      const header = specHeaderByLabel[label];
      if (!header) return [];
      const set = new Set<string>();
      for (const r of pcRowsAll) {
        const v = cell(r.values, header);
        if (v) set.add(v);
      }
      return [...set].sort((a, b) => a.localeCompare(b, "th")).map((value) => ({ value }));
    }
    return {
      ramType: optionsFor("ประเภท RAM"),
      ramCapacity: optionsFor("ความจุ RAM"),
      ramSpeed: optionsFor("ความเร็ว RAM"),
      storageType: optionsFor("ประเภทหน่วยจัดเก็บ"),
      storageCapacity: optionsFor("ความจุจัดเก็บ"),
    };
  }, [pcRowsAll, specHeaderByLabel]);
  const {
    ramType: ramTypeOptions,
    ramCapacity: ramCapacityOptions,
    ramSpeed: ramSpeedOptions,
    storageType: storageTypeOptions,
    storageCapacity: storageCapacityOptions,
  } = specFilterOptions;

  const pcRows = useMemo(() => {
    const ramTypeHeader = specHeaderByLabel["ประเภท RAM"];
    const ramCapacityHeader = specHeaderByLabel["ความจุ RAM"];
    const ramSpeedHeader = specHeaderByLabel["ความเร็ว RAM"];
    const storageTypeHeader = specHeaderByLabel["ประเภทหน่วยจัดเก็บ"];
    const storageCapacityHeader = specHeaderByLabel["ความจุจัดเก็บ"];
    return pcRowsAll.filter((r) => {
      if (ramTypeFilter.length > 0 && !ramTypeFilter.includes(cell(r.values, ramTypeHeader))) return false;
      if (ramCapacityFilter.length > 0 && !ramCapacityFilter.includes(cell(r.values, ramCapacityHeader))) return false;
      if (ramSpeedFilter.length > 0 && !ramSpeedFilter.includes(cell(r.values, ramSpeedHeader))) return false;
      if (storageTypeFilter.length > 0 && !storageTypeFilter.includes(cell(r.values, storageTypeHeader))) return false;
      if (
        storageCapacityFilter.length > 0 &&
        !storageCapacityFilter.includes(cell(r.values, storageCapacityHeader))
      )
        return false;
      return true;
    });
  }, [
    pcRowsAll,
    specHeaderByLabel,
    ramTypeFilter,
    ramCapacityFilter,
    ramSpeedFilter,
    storageTypeFilter,
    storageCapacityFilter,
  ]);

  // Bulk edit ตัดจากรายการที่เลือกไว้แล้วถ้าไม่อยู่ใน pcRows ที่มองเห็นอยู่ตอนนี้
  // อีกต่อไป (เช่น ถูกกรองออกไปหลังแก้ไข) — ไม่บังคับ แค่กันไม่ให้ตัวนับ
  // "เลือกแล้ว N รายการ" ค้างรวมแถวที่มองไม่เห็นแล้วจนสับสน
  const selectablePcRowNumbers = useMemo(() => {
    if (!fields) return new Set<number>();
    const set = new Set<number>();
    for (const r of pcRows) {
      if (cell(r.values, fields.status) !== STATUS_DISPOSED) set.add(r.rowNumber);
    }
    return set;
  }, [pcRows, fields]);

  function toggleRowSelected(rowNumber: number) {
    setSelectedRowNumbers((prev) => {
      const next = new Set(prev);
      if (next.has(rowNumber)) next.delete(rowNumber);
      else next.add(rowNumber);
      return next;
    });
  }

  function toggleSelectAllVisible(rowNumbers: number[], checked: boolean) {
    setSelectedRowNumbers((prev) => {
      const next = new Set(prev);
      for (const rn of rowNumbers) {
        if (checked) next.add(rn);
        else next.delete(rn);
      }
      return next;
    });
  }

  function applyBulkEditResult(result: BulkEditResult) {
    setData((prev) => {
      if (isError(prev)) return prev;
      const byRow = new Map(result.updated.map((u) => [u.rowNumber, u.values]));
      return {
        ...prev,
        rows: prev.rows.map((r) =>
          byRow.has(r.rowNumber) ? { ...r, values: byRow.get(r.rowNumber) as EquipmentRow } : r
        ),
      };
    });
    setSelectedRowNumbers((prev) => {
      const next = new Set(prev);
      for (const u of result.updated) next.delete(u.rowNumber);
      return next;
    });
  }

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
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{session.username}</p>
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
              href="/manage/it/tasks"
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <ClipboardCheck size={16} strokeWidth={2} aria-hidden="true" />
              งานบำรุงรักษา
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

            {/* แดชบอร์ดงานบำรุงรักษา — a running (all-time) summary of
                MaintenanceTask activity: overall totals plus one row per IT
                account, so anyone glancing at this page sees who's been
                doing the maintenance rounds without a trip to
                /manage/it/tasks (still linked below for the full,
                filterable board). */}
            <div className={`${CARD} flex flex-col gap-3 p-4`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                  <Wrench size={15} strokeWidth={2} aria-hidden="true" />
                  แดชบอร์ดงานบำรุงรักษา
                </div>
                <Link
                  href="/manage/it/tasks"
                  className="text-xs font-medium text-[var(--brand)] hover:underline"
                >
                  ดูรายละเอียดทั้งหมด →
                </Link>
              </div>

              <div className="flex flex-wrap gap-2 text-xs">
                <span className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  งานทั้งหมด {maintenanceTotals.total.toLocaleString("th-TH")}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 font-medium text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
                  <Wrench size={11} strokeWidth={2} aria-hidden="true" />
                  กำลังดำเนินการ {maintenanceTotals.inProgress.toLocaleString("th-TH")}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                  <CheckCircle2 size={11} strokeWidth={2} aria-hidden="true" />
                  เสร็จสิ้นแล้ว {maintenanceTotals.done.toLocaleString("th-TH")}
                </span>
              </div>

              {technicianStats.length === 0 ? (
                <p className="text-xs text-zinc-400">ยังไม่มีข้อมูลงานบำรุงรักษา</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] text-left text-xs">
                    <thead>
                      <tr className="border-b border-emerald-900/15 text-[10px] uppercase tracking-wide text-zinc-400 dark:border-emerald-400/15">
                        <th scope="col" className="flex items-center gap-1 py-1.5 pr-2 font-medium">
                          <Users size={12} strokeWidth={2} aria-hidden="true" />
                          ผู้ดำเนินการ
                        </th>
                        <th scope="col" className="px-2 py-1.5 text-right font-medium">ทั้งหมด</th>
                        <th scope="col" className="px-2 py-1.5 text-right font-medium">เสร็จสิ้น</th>
                        <th scope="col" className="px-2 py-1.5 text-right font-medium">กำลังทำ</th>
                        <th scope="col" className="px-2 py-1.5 text-right font-medium">ล่าสุด</th>
                      </tr>
                    </thead>
                    <tbody>
                      {technicianStats.map((t) => (
                        <tr key={t.username || t.displayName} className="border-b border-zinc-50 last:border-0 dark:border-zinc-800/60">
                          <td className="py-1.5 pr-2 font-medium text-zinc-700 dark:text-zinc-200">{t.displayName}</td>
                          <td className="px-2 py-1.5 text-right text-zinc-600 dark:text-zinc-300">
                            {t.total.toLocaleString("th-TH")}
                          </td>
                          <td className="px-2 py-1.5 text-right text-emerald-700 dark:text-emerald-400">
                            {t.done.toLocaleString("th-TH")}
                          </td>
                          <td className="px-2 py-1.5 text-right text-amber-700 dark:text-amber-400">
                            {t.inProgress.toLocaleString("th-TH")}
                          </td>
                          <td className="px-2 py-1.5 text-right text-zinc-400 dark:text-zinc-500">
                            {t.lastActivity ? new Date(t.lastActivity).toLocaleDateString("th-TH") : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Filters */}
            <div className={`${CARD} flex flex-col gap-3 p-4`}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 text-sm font-medium text-zinc-400 dark:text-zinc-500">
                  <Filter size={15} strokeWidth={2} aria-hidden="true" />
                  ตัวกรองข้อมูล
                </div>
                {/* Report-template text settings (org name/form title/
                    acknowledger) live on /manage/it/report itself now — that
                    page already edits and can print with those values in
                    the same place, so a separate entry point here would
                    just be a second, easy-to-miss place to look for it. */}
                <button
                  type="button"
                  onClick={() => setShowSpecSettings((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  <Cpu size={14} strokeWidth={2} aria-hidden="true" />
                  ตั้งค่ามาตรฐานสเปก
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
                <MultiSelect
                  label="สถานะ"
                  options={[{ value: STATUS_ACTIVE }, { value: STATUS_DISPOSED }]}
                  selected={statusFilter}
                  onChange={setStatusFilter}
                  className="sm:max-w-[9rem] sm:flex-1"
                />
                <label className="flex flex-col gap-1 text-sm text-zinc-500 dark:text-zinc-400 sm:max-w-[9rem] sm:flex-1">
                  เดือนบำรุงรักษา
                  <select
                    value={maintenanceMonthFilter}
                    onChange={(e) => setMaintenanceMonthFilter(e.target.value)}
                    className="h-11 rounded-lg border border-zinc-200 bg-white px-3 text-base text-zinc-900 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  >
                    <option value="">ทั้งหมด</option>
                    {THAI_MONTHS_FULL.map((label, i) => (
                      <option key={label} value={String(i + 1)}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm text-zinc-500 dark:text-zinc-400 sm:max-w-[7rem] sm:flex-1">
                  ปีบำรุงรักษา
                  <select
                    value={maintenanceYearFilter}
                    onChange={(e) => setMaintenanceYearFilter(e.target.value)}
                    className="h-11 rounded-lg border border-zinc-200 bg-white px-3 text-base text-zinc-900 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  >
                    <option value="">ทั้งหมด</option>
                    {maintenanceYearOptions.map((y) => (
                      <option key={y} value={y}>
                        {y}
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

              {/* สเปกคอมพิวเตอร์ — มีผลเฉพาะตารางคอมพิวเตอร์/โน้ตบุ๊ก/All-in-One
                  ด้านล่างเท่านั้น ตารางเครื่องพิมพ์ไม่มีคอลัมน์เหล่านี้จึงไม่ถูก
                  กรองไปด้วย */}
              <div className="flex flex-col gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500">
                  ตัวกรองสเปกคอมพิวเตอร์ (เฉพาะตารางคอมพิวเตอร์ / โน้ตบุ๊ก)
                </p>
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                  <MultiSelect
                    label="ประเภท RAM"
                    options={ramTypeOptions}
                    selected={ramTypeFilter}
                    onChange={setRamTypeFilter}
                    className="sm:max-w-[8rem] sm:flex-1"
                  />
                  <MultiSelect
                    label="ความจุ RAM"
                    options={ramCapacityOptions}
                    selected={ramCapacityFilter}
                    onChange={setRamCapacityFilter}
                    className="sm:max-w-[8rem] sm:flex-1"
                  />
                  <MultiSelect
                    label="ความเร็ว RAM"
                    options={ramSpeedOptions}
                    selected={ramSpeedFilter}
                    onChange={setRamSpeedFilter}
                    className="sm:max-w-[8rem] sm:flex-1"
                  />
                  <MultiSelect
                    label="ประเภทหน่วยจัดเก็บ"
                    options={storageTypeOptions}
                    selected={storageTypeFilter}
                    onChange={setStorageTypeFilter}
                    className="sm:max-w-[9rem] sm:flex-1"
                  />
                  <MultiSelect
                    label="ความจุจัดเก็บ"
                    options={storageCapacityOptions}
                    selected={storageCapacityFilter}
                    onChange={setStorageCapacityFilter}
                    className="sm:max-w-[9rem] sm:flex-1"
                  />
                </div>
              </div>
            </div>

            {showSpecSettings && (
              <SpecStandardsPanel
                initialStandards={specStandards}
                onClose={() => setShowSpecSettings(false)}
                onSaved={setSpecStandards}
              />
            )}

            {selectedRowNumbers.size > 0 && (
              <div className={`${CARD} flex flex-wrap items-center justify-between gap-3 p-3`}>
                <span className="text-sm text-zinc-600 dark:text-zinc-300">
                  เลือกแล้ว {selectedRowNumbers.size.toLocaleString("th-TH")} รายการ (ตารางคอมพิวเตอร์ / โน้ตบุ๊ก)
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedRowNumbers(new Set())}
                    className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    <X size={13} strokeWidth={2} aria-hidden="true" />
                    ล้างการเลือก
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowBulkEdit(true)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[var(--brand)] px-3 py-1.5 text-xs font-medium text-[var(--brand-contrast)] transition-colors hover:bg-[var(--brand-strong)]"
                  >
                    <Pencil size={13} strokeWidth={2} aria-hidden="true" />
                    แก้ไขที่เลือก ({selectedRowNumbers.size.toLocaleString("th-TH")})
                  </button>
                </div>
              </div>
            )}

            {showBulkEdit && (
              <BulkEditSpecModal
                rowNumbers={[...selectedRowNumbers]}
                onClose={() => setShowBulkEdit(false)}
                onSaved={applyBulkEditResult}
              />
            )}

            <SpecTable
              title="คอมพิวเตอร์ / โน้ตบุ๊ก / All-in-One"
              icon={<Cpu size={16} strokeWidth={2} aria-hidden="true" />}
              rows={pcRows}
              headers={headers}
              fields={fields}
              specColumns={pcSpecColumns}
              latestMaintenanceByAsset={latestMaintenanceByAsset}
              specStandards={specStandards}
              showSpecStatus
              tasksByRowNumber={tasksByRowNumber}
              actionOptions={actionOptions}
              statusYear={currentYear}
              selectable
              selectedRowNumbers={selectedRowNumbers}
              onToggleRow={toggleRowSelected}
              onToggleAllVisible={toggleSelectAllVisible}
              selectableRowNumbers={selectablePcRowNumbers}
            />

            <SpecTable
              title="เครื่องพิมพ์"
              icon={<Printer size={16} strokeWidth={2} aria-hidden="true" />}
              rows={printerRows}
              headers={headers}
              fields={fields}
              specColumns={printerSpecColumns}
              latestMaintenanceByAsset={latestMaintenanceByAsset}
              specStandards={specStandards}
              showSpecStatus={false}
              tasksByRowNumber={tasksByRowNumber}
              actionOptions={actionOptions}
              statusYear={currentYear}
            />
          </>
        )}
      </div>
    </main>
  );
}

/** สถานะสเปก badge — combines IT's own per-visit judgment call
 * (manualSpecStatus, from the latest MaintenanceLog entry for this asset)
 * with the automatic evaluateRowSpec() comparison against SpecStandards.
 * Per the hospital's answer ("เอาทั้งคู่ ... เลือกใช้ได้ทั้งสองแบบ"), neither
 * replaces the other: a manual call is shown when IT has made one (it's
 * their direct judgment of the specific machine), the automatic evaluation
 * is always shown too — as the badge itself when there's no manual call, or
 * folded into the tooltip alongside it otherwise — since a manual "ปกติ"
 * doesn't erase what the automatic check actually found. */
function SpecStatusBadge({
  row,
  headers,
  standards,
  manualStatus,
}: {
  row: EquipmentRow;
  headers: string[];
  standards: SpecStandards;
  manualStatus: MaintenanceLogEntry["manualSpecStatus"] | undefined;
}) {
  const auto = useMemo(() => evaluateRowSpec(row, headers, standards), [row, headers, standards]);
  const autoTitle = auto.unknown
    ? "ระบบประเมินอัตโนมัติ: ข้อมูลสเปกในระบบไม่ครบ ไม่สามารถประเมินได้"
    : auto.belowStandard
      ? `ระบบประเมินอัตโนมัติ: ${auto.reasons.join(" / ")}`
      : "ระบบประเมินอัตโนมัติ: ผ่านมาตรฐาน";

  if (manualStatus === "ต่ำกว่ามาตรฐาน") {
    return (
      <span
        title={`ประเมินเอง: ต่ำกว่ามาตรฐาน · ${autoTitle}`}
        className="inline-flex items-center rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
      >
        ต่ำกว่ามาตรฐาน (ประเมินเอง)
      </span>
    );
  }
  if (manualStatus === "ปกติ") {
    return (
      <span
        title={`ประเมินเอง: ปกติ · ${autoTitle}`}
        className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
      >
        ปกติ (ประเมินเอง)
      </span>
    );
  }
  if (auto.unknown) {
    return (
      <span
        title={autoTitle}
        className="inline-flex items-center rounded-full border border-zinc-300 bg-zinc-50 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"
      >
        ไม่ทราบ
      </span>
    );
  }
  if (auto.belowStandard) {
    return (
      <span
        title={autoTitle}
        className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300"
      >
        ต่ำกว่ามาตรฐาน (ระบบประเมิน)
      </span>
    );
  }
  return (
    <span
      title={autoTitle}
      className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
    >
      ผ่านมาตรฐาน
    </span>
  );
}

function SpecTable({
  title,
  icon,
  rows,
  headers,
  fields,
  specColumns,
  latestMaintenanceByAsset,
  specStandards,
  showSpecStatus,
  tasksByRowNumber,
  actionOptions,
  statusYear,
  selectable = false,
  selectedRowNumbers,
  onToggleRow,
  onToggleAllVisible,
  selectableRowNumbers,
}: {
  title: string;
  icon: React.ReactNode;
  rows: ITRecord[];
  headers: string[];
  fields: FieldMap | null;
  specColumns: SpecColumn[];
  latestMaintenanceByAsset: Map<string, MaintenanceLogEntry>;
  specStandards: SpecStandards;
  showSpecStatus: boolean;
  /** This row's maintenance history, keyed by equipmentRowNumber — feeds the
   * read-only MaintenanceStatusStrip embedded under เลขครุภัณฑ์. */
  tasksByRowNumber: Map<number, MaintenanceTask[]>;
  actionOptions: string[];
  statusYear: string;
  /** เพิ่มคอลัมน์ checkbox นำหน้าตาราง สำหรับ "แก้ไขพร้อมกันหลายรายการ" — ตอนนี้
   * มีเฉพาะตารางคอมพิวเตอร์/โน้ตบุ๊ก/All-in-One เพราะฟิลด์ที่แก้ไขได้ (ยี่ห้อ
   * รุ่น สเปก RAM/หน่วยจัดเก็บ) เป็นคอลัมน์เฉพาะของอุปกรณ์ประเภทนี้เท่านั้น —
   * ดู BulkEditSpecModal. */
  selectable?: boolean;
  selectedRowNumbers?: Set<number>;
  onToggleRow?: (rowNumber: number) => void;
  onToggleAllVisible?: (rowNumbers: number[], checked: boolean) => void;
  /** rowNumbers ที่ "เลือกได้" ในตารางนี้ตอนนี้ (ไม่รวมรายการจำหน่ายแล้ว) —
   * ใช้ตัดสิน checked/indeterminate ของ checkbox "เลือกทั้งหมด" ในหัวตาราง. */
  selectableRowNumbers?: Set<number>;
}) {
  const columnCount = 6 + specColumns.length + (showSpecStatus ? 1 : 0) + (selectable ? 1 : 0);
  const selectableList = selectableRowNumbers ? [...selectableRowNumbers] : [];
  const allSelected =
    selectable && selectableList.length > 0 && selectableList.every((rn) => selectedRowNumbers?.has(rn));
  const someSelected = selectable && selectableList.some((rn) => selectedRowNumbers?.has(rn));
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
        <table className="w-full min-w-[720px] text-left text-[10px] sm:text-[11px]">
          <colgroup>
            {selectable && <col className="w-[28px]" />}
            <col className="w-[224px]" />
            <col />
            <col />
            {specColumns.map((c) => (
              <col key={c.label} className={SPEC_COLUMN_WIDTH_CLASS[c.label] ?? undefined} />
            ))}
            <col />
            <col />
            <col className="w-[60px]" />
            {showSpecStatus && <col />}
          </colgroup>
          <thead>
            <tr className="border-b border-emerald-900/15 text-[9px] uppercase tracking-wide text-zinc-400 dark:border-emerald-400/15">
              {selectable && (
                <th scope="col" className="px-1.5 py-1.5 font-medium sm:px-2">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = !allSelected && someSelected;
                    }}
                    onChange={(e) => onToggleAllVisible?.(selectableList, e.target.checked)}
                    disabled={selectableList.length === 0}
                    aria-label="เลือกทั้งหมด"
                    className="h-3.5 w-3.5 rounded border-zinc-300"
                  />
                </th>
              )}
              <th scope="col" className="px-1.5 py-1.5 font-medium sm:px-2">เดือนบำรุงรักษา</th>
              <th scope="col" className="px-1.5 py-1.5 font-medium sm:px-2">กลุ่มงาน</th>
              <th scope="col" className="px-1.5 py-1.5 font-medium sm:px-2">ยี่ห้อ / รุ่น</th>
              {specColumns.map((c) => (
                <th key={c.label} scope="col" className="px-1.5 py-1.5 font-medium sm:px-2">
                  {c.label}
                </th>
              ))}
              <th scope="col" className="px-1.5 py-1.5 font-medium sm:px-2">สถานที่ / จุดติดตั้ง</th>
              <th scope="col" className="px-1.5 py-1.5 font-medium sm:px-2">ผู้ใช้งาน</th>
              <th scope="col" className="whitespace-nowrap px-1.5 py-1.5 font-medium sm:px-2">สถานะ</th>
              {showSpecStatus && <th scope="col" className="px-1.5 py-1.5 font-medium sm:px-2">สถานะสเปก</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const disposed = fields ? cell(r.values, fields.status) === STATUS_DISPOSED : false;
              const assetNumber = fields ? getAssetNumber(r.values, fields) : "";
              const latest = assetNumber ? latestMaintenanceByAsset.get(assetNumber) : undefined;
              const brandModel = fields ? getBrandModel(r.values, fields) : "";
              const rowTasks = tasksByRowNumber.get(r.rowNumber) ?? [];
              const inProgressTask = pickInProgressTask(rowTasks);
              const lastCompletedTask = inProgressTask ? undefined : pickLastCompletedTask(rowTasks);
              return (
                <tr
                  key={r.rowNumber}
                  className="border-b border-zinc-100 transition-colors last:border-0 hover:bg-emerald-50/70 dark:border-zinc-800/60 dark:hover:bg-emerald-900/10"
                >
                  {selectable && (
                    <td className="px-1.5 py-1.5 align-top sm:px-2">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedRowNumbers?.has(r.rowNumber))}
                        onChange={() => onToggleRow?.(r.rowNumber)}
                        disabled={disposed}
                        title={disposed ? "รายการนี้จำหน่ายแล้ว ไม่สามารถเลือกแก้ไขได้" : undefined}
                        aria-label={`เลือกแถวที่ ${r.rowNumber}`}
                        className="h-3.5 w-3.5 rounded border-zinc-300 disabled:cursor-not-allowed disabled:opacity-40"
                      />
                    </td>
                  )}
                  <td className="break-words px-1.5 py-1.5 align-top leading-snug text-zinc-700 dark:text-zinc-300 sm:px-2">
                    <MaintenanceStatusStrip
                      tasks={rowTasks.map((t) => ({
                        status: t.status,
                        createdAt: t.createdAt,
                        completedAt: t.completedAt,
                        displayName: t.assignedToDisplayName || t.assignedToUsername || "ไม่ทราบผู้ดำเนินการ",
                        actionsTaken: t.actionsTaken,
                        inspectionChecks: t.inspectionChecks,
                        partsChanged: t.partsChanged,
                        otherDetail: t.otherDetail,
                      }))}
                      actionOptions={actionOptions}
                      year={statusYear}
                      assetLabel={assetNumber || undefined}
                    />
                  </td>
                  <td className="break-words px-1.5 py-1.5 align-top leading-snug text-zinc-700 dark:text-zinc-300 sm:px-2">
                    {(fields && cell(r.values, fields.department)) || "—"}
                  </td>
                  <td className="break-words px-1.5 py-1.5 align-top leading-snug font-medium text-zinc-900 dark:text-zinc-100 sm:px-2">
                    <div className="flex flex-col gap-1">
                      <span>{brandModel || "—"}</span>
                      {inProgressTask ? (
                        <span className="inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium leading-tight text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                          <Wrench size={9} strokeWidth={2} className="shrink-0" aria-hidden="true" />
                          กำลังบำรุงรักษาโดย {inProgressTask.assignedToDisplayName || inProgressTask.assignedToUsername || "ไม่ทราบผู้ดำเนินการ"}
                        </span>
                      ) : (
                        lastCompletedTask && (
                          <span className="inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-medium leading-tight text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                            <CheckCircle2 size={9} strokeWidth={2} className="shrink-0" aria-hidden="true" />
                            เสร็จสิ้นล่าสุดโดย{" "}
                            {lastCompletedTask.assignedToDisplayName || lastCompletedTask.assignedToUsername || "ไม่ทราบผู้ดำเนินการ"}
                            {lastCompletedTask.completedAt &&
                              ` เมื่อ ${new Date(lastCompletedTask.completedAt).toLocaleDateString("th-TH")}`}
                          </span>
                        )
                      )}
                    </div>
                  </td>
                  {specColumns.map((c) => (
                    <td
                      key={c.label}
                      className="break-words px-1.5 py-1.5 align-top leading-snug text-zinc-700 dark:text-zinc-300 sm:px-2"
                    >
                      {cell(r.values, c.header) || "—"}
                    </td>
                  ))}
                  <td className="break-words px-1.5 py-1.5 align-top leading-snug text-zinc-700 dark:text-zinc-300 sm:px-2">
                    {(fields && cell(r.values, fields.installLocation)) || "—"}
                  </td>
                  <td className="break-words px-1.5 py-1.5 align-top leading-snug text-zinc-700 dark:text-zinc-300 sm:px-2">
                    {(fields && getFullName(r.values, fields)) || "—"}
                  </td>
                  <td className="px-1.5 py-1.5 align-top sm:px-2">
                    {disposed ? (
                      <span className="inline-flex items-center whitespace-nowrap rounded-full border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                        จำหน่ายแล้ว
                      </span>
                    ) : (
                      <span className="inline-flex items-center whitespace-nowrap rounded-full border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                        ใช้งาน
                      </span>
                    )}
                  </td>
                  {showSpecStatus && (
                    <td className="px-1.5 py-1.5 align-top sm:px-2">
                      {fields ? (
                        <SpecStatusBadge
                          row={r.values}
                          headers={headers}
                          standards={specStandards}
                          manualStatus={latest?.manualSpecStatus}
                        />
                      ) : (
                        "—"
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columnCount} className="px-4 py-10 text-center text-zinc-400">
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

const RAM_TYPE_CHOICES = ["DDR2", "DDR3", "DDR4", "DDR5"];

/** Editable thresholds for the automatic "สเปกต่ำกว่ามาตรฐานปัจจุบัน"
 * evaluation (lib/specEvaluation.ts) — see lib/sheets.ts
 * getSpecStandards/updateSpecStandards and the SpecStandards sheet tab.
 * Reachable by "it" and the bootstrap superadmin only, same as the rest of
 * this page (the API route enforces this independently). This is the
 * "automatic" half of the hospital's two-track answer on below-standard
 * detection — see SpecStatusBadge for how it combines with the manual
 * per-visit call from the update-status modal below. */
function SpecStandardsPanel({
  initialStandards,
  onClose,
  onSaved,
}: {
  initialStandards: SpecStandards;
  onClose: () => void;
  onSaved: (standards: SpecStandards) => void;
}) {
  const [values, setValues] = useState<SpecStandards>(initialStandards);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function setField<K extends keyof SpecStandards>(key: K, value: SpecStandards[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/manage/it/spec-standards", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "บันทึกไม่สำเร็จ");
        return;
      }
      setValues(json.standards);
      onSaved(json.standards);
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
          <Cpu size={15} strokeWidth={2} aria-hidden="true" />
          ตั้งค่ามาตรฐานสเปกขั้นต่ำ (ระบบประเมินอัตโนมัติ)
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
        ใช้เปรียบเทียบกับข้อมูลสเปก RAM/หน่วยจัดเก็บที่บันทึกไว้ในระบบของแต่ละเครื่อง — เป็นการประเมินแบบอัตโนมัติ
      </p>
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm text-zinc-500 dark:text-zinc-400">
          RAM ขั้นต่ำ (GB)
          <input
            type="number"
            min={0}
            value={values.minRamCapacityGb}
            onChange={(e) => setField("minRamCapacityGb", e.target.value)}
            className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-zinc-500 dark:text-zinc-400">
          ประเภท RAM ขั้นต่ำ
          <select
            value={values.minRamType}
            onChange={(e) => setField("minRamType", e.target.value)}
            className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          >
            {RAM_TYPE_CHOICES.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm text-zinc-500 dark:text-zinc-400 sm:justify-end sm:pb-2.5">
          <span className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={values.requireSsd === "true"}
              onChange={(e) => setField("requireSsd", e.target.checked ? "true" : "false")}
              className="h-4 w-4 rounded border-zinc-300"
            />
            ต้องเป็น SSD/NVMe
          </span>
        </label>
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

