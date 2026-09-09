"use client";

import { useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Loader2,
  MapPin,
  Plus,
  Printer as PrinterIcon,
  RectangleHorizontal,
  RectangleVertical,
  Save,
  Settings,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import type { InspectionCheck, MaintenanceTaskStatus, ReportSettings } from "@/lib/sheets";
import { TITLE_PREFIX_OPTIONS } from "@/lib/fields";
import MultiSelect from "@/components/MultiSelect";

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
  /** Combined "คำนำหน้า ชื่อ-นามสกุล" for display/search/print — always
   * derived from titlePrefix + nameOnly below, whichever sheet shape this
   * came from (see manage/it/report/page.tsx). */
  responsiblePerson: string;
  /** One of TITLE_PREFIX_OPTIONS (@/lib/fields), or "" if none was set or
   * none could be detected — drives the คำนำหน้า dropdown in the
   * "แก้ไข ... ก่อนพิมพ์" modal below. */
  titlePrefix: string;
  /** ชื่อ-นามสกุล without the คำนำหน้า. */
  nameOnly: string;
  /** For the optimistic-concurrency check on save-back — see
   * /api/manage/it/records/[rowNumber]. */
  snapshotHash: string;
  /** Whether editing titlePrefix/nameOnly here can save back to the sheet
   * (true whenever the sheet has either a combined name column or both
   * split columns) — false only for a sheet missing both shapes entirely,
   * in which case editing here only affects this one printout. */
  canSaveResponsiblePerson: boolean;
}

/** One maintenance task, trimmed to just what the equipment-picker badges
 * (and the ปี filter driving them) need — see manage/it/report/page.tsx's
 * taskHistory mapping from the full MaintenanceTask. actionsTaken/
 * inspectionChecks/partsChanged/otherDetail are only ever filled in once
 * someone opens "อัปเดตสถานะงาน" on /manage/it/tasks and saves — an
 * in-progress task nobody has touched yet just carries empty values here,
 * which the month-strip popup below renders as "ยังไม่ได้บันทึกรายละเอียด". */
export interface ReportTaskEntry {
  equipmentRowNumber: number;
  status: MaintenanceTaskStatus;
  createdAt: string;
  completedAt: string;
  displayName: string;
  actionsTaken: string[];
  inspectionChecks: InspectionCheck[];
  partsChanged: string;
  otherDetail: string;
}

/** "ปกติ, เปลี่ยนอะไหล่ (จอ LCD), ส่งซ่อม" — folds the ผลการตรวจสอบโดย IT
 * checkboxes back into one readable line for the month-strip popup, same
 * checks as the printed form's "ผลการตรวจสอบโดย IT" box. Appends the
 * matching free-text blank in parens where one was filled in. */
function formatInspectionResult(t: ReportTaskEntry): string {
  return t.inspectionChecks
    .map((check) => {
      if (check === "เปลี่ยนอะไหล่" && t.partsChanged.trim()) return `${check} (${t.partsChanged.trim()})`;
      if (check === "อื่นๆ" && t.otherDetail.trim()) return `${check} (${t.otherDetail.trim()})`;
      return check;
    })
    .join(", ");
}

interface SelectedRow {
  rowNumber: number;
  assetNumber: string;
  description: string;
  /** ประเภทครุภัณฑ์ and ยี่ห้อ/รุ่น kept separate (description above stays
   * the single-line "type — brand/model" form for compact UI like the
   * adjust-modal row label) so the printed table can put them on two lines
   * at different sizes — see the "รายการครุภัณฑ์" column below. */
  equipmentType: string;
  brandModel: string;
  /** Shown above location in the printed "สถานที่ตั้ง" column so it reads
   * as "กลุ่มงาน — ที่ตั้ง" without needing its own table column. */
  department: string;
  location: string;
  responsiblePerson: string;
  titlePrefix: string;
  nameOnly: string;
  canSaveResponsiblePerson: boolean;
  snapshotHash: string;
  locationChanged: boolean;
  responsiblePersonChanged: boolean;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

const CARD = "rounded-2xl border border-emerald-900/10 bg-white shadow-sm dark:border-emerald-400/10 dark:bg-zinc-900";
const INPUT_CLASS =
  "h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100";

const THAI_MONTHS_SHORT = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

/** Fixed, colorblind-validated categorical order (8 hues) for coloring each
 * distinct "การดำเนินการ" (action-taken) text in the month-strip and its
 * legend — assigned automatically by first-appearance order (see
 * actionColorMap below), never picked by hand and never re-cycled, so a
 * color always means the same action everywhere it appears. A 9th-and-later
 * distinct action folds into ACTION_OTHER_COLOR instead of generating a new
 * hue, since a 9th hue can no longer be kept distinguishable from the rest
 * (colorblind-safe categorical palettes top out around 8). */
const ACTION_COLOR_PALETTE: { light: string; dark: string }[] = [
  { light: "#2a78d6", dark: "#3987e5" }, // blue
  { light: "#eb6834", dark: "#d95926" }, // orange
  { light: "#1baf7a", dark: "#199e70" }, // aqua
  { light: "#eda100", dark: "#c98500" }, // yellow
  { light: "#e87ba4", dark: "#d55181" }, // magenta
  { light: "#008300", dark: "#008300" }, // green
  { light: "#4a3aa7", dark: "#9085e9" }, // violet
  { light: "#e34948", dark: "#e66767" }, // red
];
/** Deliberately neutral/gray — never impersonates one of the 8 real
 * categorical colors above — used once a 9th distinct action text shows up. */
const ACTION_OTHER_COLOR = { light: "#a1a1aa", dark: "#71717a" };

type ActionColor = { light: string; dark: string };

/** CSS custom properties for one action-color segment — applied via
 * className="bg-[var(--seg-c)] dark:bg-[var(--seg-c-dark)]" so the two
 * static Tailwind arbitrary-value classes stay the same for every segment
 * while the actual color comes from the inline variables per element. */
function actionColorStyle(color: ActionColor): CSSProperties {
  return { "--seg-c": color.light, "--seg-c-dark": color.dark } as CSSProperties;
}

/** Full names, in the same index order as THAI_MONTHS_SHORT — used only for
 * the month-strip popup heading below (e.g. "สิงหาคม 2569"), where the
 * abbreviation would read a bit too terse for a heading. */
const THAI_MONTHS_FULL = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

/** "2026-08-14" -> "14 ส.ค. 2569" (Buddhist calendar, matching every other
 * Thai date on this site — see Dashboard.tsx's own date formatting). */
function formatThaiDate(iso: string): string {
  const parts = iso.split("-").map(Number);
  const [y, m, d] = parts;
  if (!y || !m || !d) return iso;
  return `${d} ${THAI_MONTHS_SHORT[m - 1] ?? ""} ${y + 543}`;
}

/** Drops blank entries (left behind mid-edit, e.g. a newly-added row the
 * person hasn't typed into yet) and guarantees at least one item survives,
 * so the printed table's "การดำเนินการ" column is never empty. Used both
 * before saving to the sheet and when rendering the print preview. */
function cleanActionOptions(list: string[]): string[] {
  const filtered = list.map((s) => s.trim()).filter(Boolean);
  return filtered.length > 0 ? filtered : ["บำรุงรักษา"];
}

const SETTINGS_FIELDS: { key: keyof ReportSettings; label: string }[] = [
  { key: "orgName", label: "ชื่อหน่วยงาน" },
  { key: "maintenanceFormTitle", label: "ชื่อแบบฟอร์ม" },
  { key: "fiscalYearLabel", label: "ปีงบประมาณ (ข้อความแสดงผล)" },
  { key: "acknowledgerName", label: "ชื่อผู้รับทราบ" },
  { key: "acknowledgerPosition", label: "ตำแหน่งผู้รับทราบ" },
  { key: "acknowledgerDepartment", label: "สังกัดผู้รับทราบ (แสดงใต้ตำแหน่ง)" },
];

export default function MaintenanceReportBuilder({
  items: initialItems,
  loadError,
  settings: initialSettings,
  currentUser,
  taskHistory,
}: {
  items: ReportEquipmentItem[];
  loadError: string | null;
  settings: ReportSettings;
  /** The logged-in IT account — auto-fills "ผู้ดำเนินการ" on the printed
   * form (see the print-area date/time line below) and attributes any
   * maintenance tasks created when this report is printed (see
   * createTasksForSelection / the print button's onClick). */
  currentUser: { username: string; displayName: string };
  /** Every maintenance task ever created (any equipment, any year) — the
   * source for the "กำลังบำรุงรักษาโดย ..." / "เสร็จสิ้นล่าสุดโดย ..."
   * badges in the picker table below. Kept as the raw list (not
   * pre-reduced to one entry per row) so the ปี filter can re-derive those
   * badges for whichever year is selected, client-side — a future year
   * with no tasks yet just shows no badges, no code change needed. */
  taskHistory: ReportTaskEntry[];
}) {
  const [items, setItems] = useState(initialItems);
  // Multi-select — an empty array means "no filter on that dimension", same
  // convention as the department/equipment-type filters on /manage and
  // /manage/it (see MultiSelect).
  const [departmentFilter, setDepartmentFilter] = useState<string[]>([]);
  const [equipmentTypeFilter, setEquipmentTypeFilter] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  // Defaults to the current พ.ศ. year (computed fresh on every load, not a
  // stored value) rather than "ทุกปี" — per the hospital's request that the
  // maintenance status "reset" year to year: on 1 ม.ค. of a new year this
  // default alone makes every item look untouched (no tasks yet that year),
  // with zero carry-over from the year before and no code change needed.
  // "" still means ทุกปี (every task ever, newest wins) internally, but per
  // the hospital's request that option is no longer offered in the dropdown
  // below (only real พ.ศ. years) — this state can just never be "" in
  // practice now. Left in place rather than ripped out since it's harmless
  // and easy to bring back if "ดูประวัติทั้งหมด" is ever wanted again.
  const [maintenanceYearFilter, setMaintenanceYearFilter] = useState(() =>
    String(new Date().getFullYear() + 543)
  );
  // Companion to ปีที่บำรุงรักษา — narrows the "กำลังบำรุงรักษาโดย .../
  // เสร็จสิ้นล่าสุดโดย ..." badge and the "X ครั้ง" count (see the useMemo
  // below) down to one เดือน within that ปี, defaulting to the current
  // month. Per the hospital's request, this is what makes that status
  // "reset" every month instead of only every year: on day 1 of a new
  // month this default alone makes every item look untouched again for
  // that badge, with no code change and no data actually deleted — the
  // month-strip below still shows the full year's history regardless of
  // this filter (it only restricts monthlyTasks by ปี, never by this), so
  // nothing about past months is ever hidden, only what counts as "current".
  const [maintenanceMonthFilter, setMaintenanceMonthFilter] = useState(() =>
    String(new Date().getMonth() + 1)
  );
  // Unlike ปีที่บำรุงรักษา (which only reshapes the badges/counts above),
  // this one actually hides non-matching rows from the picker table below —
  // per the hospital's explicit request for a real filter, same behavior as
  // กลุ่มงาน/ประเภทครุภัณฑ์. Classified per row from the same
  // inProgress/lastCompleted lookups (already scoped to maintenanceYearFilter),
  // so picking a status is always relative to whichever ปีที่บำรุงรักษา is
  // selected — e.g. "ยังไม่เคยบำรุงรักษา" means "no task logged in that ปี".
  const [maintenanceStatusFilter, setMaintenanceStatusFilter] = useState<"" | "in_progress" | "done" | "none">("");
  const [selectedRowNumbers, setSelectedRowNumbers] = useState<number[]>([]);
  const [formDepartment, setFormDepartment] = useState("");
  const [visitDate, setVisitDate] = useState("");
  const [timeFrom, setTimeFrom] = useState("");
  const [timeTo, setTimeTo] = useState("");
  const [overrides, setOverrides] = useState<
    Record<number, { location: string; titlePrefix: string; nameOnly: string }>
  >({});
  const [rowSaveStatus, setRowSaveStatus] = useState<Record<number, SaveStatus>>({});
  const [rowSaveError, setRowSaveError] = useState<Record<number, string>>({});
  const [savingAll, setSavingAll] = useState(false);
  // Collapsed by default — this used to be a separate settings toggle on
  // /manage/it, moved here (and hidden behind a button, same UX pattern) so
  // there's a single place to edit the report template text, right next to
  // where it's actually used.
  const [showSettings, setShowSettings] = useState(false);
  // Also collapsed behind a button, same reasoning — the location/
  // responsible-person override editor used to sit inline on the page at
  // all times once anything was selected, which pushed the actual printable
  // form preview further and further down the page.
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  // Chrome (and most other browsers) hide their own print-dialog "Layout"
  // (portrait/landscape) control once a page declares @page { size: ... } —
  // which this page always does, to keep the printed A4 size/margins
  // consistent regardless of a printer's own defaults. So orientation has
  // to be a control of our own instead, feeding the same @page rule below.
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("landscape");
  // Printing is the moment a maintenance task is considered "started" (see
  // handlePrint below) — creatingTasks disables the print button for the
  // one round-trip that takes, and taskCreateError surfaces a failure
  // without ever blocking the actual print (the paper form is what matters
  // most; task tracking is secondary).
  const [creatingTasks, setCreatingTasks] = useState(false);
  const [taskCreateError, setTaskCreateError] = useState<string | null>(null);

  // Form header / signature text — editable right here (pre-filled from the
  // saved ReportSettings) so a one-off change (a substitute signee, say)
  // doesn't require a trip to the settings panel on /manage/it. "บันทึกเป็น
  // ค่าเริ่มต้น" below writes it back to ReportSettings for next time;
  // without pressing that, an edit here only affects this one printout.
  const [formSettings, setFormSettings] = useState<ReportSettings>(initialSettings);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const departmentOptions = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) if (it.department) set.add(it.department);
    return [...set].sort((a, b) => a.localeCompare(b, "th")).map((value) => ({ value }));
  }, [items]);

  const equipmentTypeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) if (it.equipmentType) set.add(it.equipmentType);
    return [...set].sort((a, b) => a.localeCompare(b, "th")).map((value) => ({ value }));
  }, [items]);

  // Every พ.ศ. year any task was created in, newest first, plus the current
  // year always available even before anything's been logged for it yet —
  // same "offer only years with real (or current) data" approach as the
  // ปี filter on /manage/it/tasks.
  const maintenanceYearOptions = useMemo(() => {
    const set = new Set<string>([String(new Date().getFullYear() + 543)]);
    for (const t of taskHistory) {
      const y = new Date(t.createdAt).getFullYear();
      if (!Number.isNaN(y)) set.add(String(y + 543));
    }
    return [...set].sort((a, b) => Number(b) - Number(a));
  }, [taskHistory]);

  // Assigns each distinct "การดำเนินการ" text a fixed color from
  // ACTION_COLOR_PALETTE, in first-ever-recorded order across the WHOLE task
  // history (not scoped by the ปี/เดือน filters) — so a color stays the same
  // for a given action no matter which year/month is being viewed. Capped at
  // the 8 palette slots; anything beyond that shares ACTION_OTHER_COLOR
  // rather than generating a new, no-longer-distinguishable hue.
  const actionColorMap = useMemo(() => {
    const seen: string[] = [];
    const sorted = [...taskHistory].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    for (const t of sorted) {
      for (const raw of t.actionsTaken) {
        const name = raw.trim();
        if (name && !seen.includes(name)) seen.push(name);
      }
    }
    const map = new Map<string, ActionColor>();
    seen.forEach((name, idx) => {
      map.set(name, ACTION_COLOR_PALETTE[idx] ?? ACTION_OTHER_COLOR);
    });
    return map;
  }, [taskHistory]);

  const colorForAction = (name: string): ActionColor =>
    actionColorMap.get(name.trim()) ?? ACTION_OTHER_COLOR;

  // Legend shown above the picker table — every action that got its own
  // palette color, plus a single "อื่นๆ" entry standing in for however many
  // additional distinct actions overflowed into ACTION_OTHER_COLOR (never
  // one legend row per overflowing action — that would just repeat the same
  // gray swatch over and over).
  const actionLegend = useMemo(() => {
    const primary: { name: string; color: ActionColor }[] = [];
    let hasOther = false;
    for (const [name, color] of actionColorMap.entries()) {
      if (color === ACTION_OTHER_COLOR) hasOther = true;
      else primary.push({ name, color });
    }
    return { primary, hasOther };
  }, [actionColorMap]);

  // Re-derives the "กำลังบำรุงรักษาโดย ..." / "เสร็จสิ้นล่าสุดโดย ..." badge
  // lookups, plus a plain per-equipment visit count (visitCounts — every
  // task counts once regardless of status, since printing the report is
  // itself the visit; see the badge below), restricted to the selected ปี
  // (created year) AND เดือน — per the hospital's request this is what
  // "resets" the badge every month, not just every year. monthlyTasks is
  // the same data grouped one step further, by เดือน (0 = ม.ค. ... 11 =
  // ธ.ค.) — it drives the 12-month strip in the picker table below (and its
  // click popup) and is deliberately restricted by ปี ONLY, never by เดือน,
  // so the strip always shows the whole selected year's history regardless
  // of which single เดือน the badge above is currently focused on — nothing
  // about a past month's color/detail is ever hidden, only what counts as
  // "current status" for the badge.
  const { inProgress, lastCompleted, visitCounts, monthlyTasks } = useMemo(() => {
    const inProgress: Record<number, { displayName: string; createdAt: string }> = {};
    const lastCompleted: Record<number, { displayName: string; completedAt: string }> = {};
    const visitCounts: Record<number, number> = {};
    const monthlyTasks: Record<number, ReportTaskEntry[][]> = {};
    for (const t of taskHistory) {
      if (maintenanceYearFilter) {
        const y = new Date(t.createdAt).getFullYear() + 543;
        if (String(y) !== maintenanceYearFilter) continue;
      }
      const monthIdx = new Date(t.createdAt).getMonth();
      if (!Number.isNaN(monthIdx)) {
        if (!monthlyTasks[t.equipmentRowNumber]) {
          monthlyTasks[t.equipmentRowNumber] = Array.from({ length: 12 }, () => []);
        }
        monthlyTasks[t.equipmentRowNumber][monthIdx].push(t);
      }
      if (maintenanceMonthFilter && String(monthIdx + 1) !== maintenanceMonthFilter) continue;
      visitCounts[t.equipmentRowNumber] = (visitCounts[t.equipmentRowNumber] ?? 0) + 1;
      if (t.status === "in_progress") {
        const existing = inProgress[t.equipmentRowNumber];
        if (!existing || t.createdAt > existing.createdAt) {
          inProgress[t.equipmentRowNumber] = { displayName: t.displayName, createdAt: t.createdAt };
        }
      } else {
        const existing = lastCompleted[t.equipmentRowNumber];
        if (!existing || t.completedAt > existing.completedAt) {
          lastCompleted[t.equipmentRowNumber] = { displayName: t.displayName, completedAt: t.completedAt };
        }
      }
    }
    return { inProgress, lastCompleted, visitCounts, monthlyTasks };
  }, [taskHistory, maintenanceYearFilter, maintenanceMonthFilter]);

  // Which month-strip tick's task list is open, shown as a small centered
  // modal (see the JSX below) — click-only, no hover tracking. An earlier
  // version tried a hover-following tooltip positioned with
  // getBoundingClientRect()/position:fixed, but that's exactly what crashed
  // the page: the tooltip could render close enough to the cursor to steal
  // the mouseleave/mouseenter pair from the tick underneath it, causing an
  // open→close→open loop that pegged the tab. A plain click-to-open modal
  // (same pattern as showSettings/showAdjustModal above) has no hover state
  // to fight over, so that failure mode can't happen here.
  const [monthPopup, setMonthPopup] = useState<{ rowNumber: number; month: number } | null>(null);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (departmentFilter.length > 0 && !departmentFilter.includes(it.department)) return false;
      if (equipmentTypeFilter.length > 0 && !equipmentTypeFilter.includes(it.equipmentType)) return false;
      if (maintenanceStatusFilter) {
        const status = inProgress[it.rowNumber] ? "in_progress" : lastCompleted[it.rowNumber] ? "done" : "none";
        if (status !== maintenanceStatusFilter) return false;
      }
      if (q) {
        const hay = `${it.assetNumber} ${it.brandModel} ${it.equipmentType} ${it.installLocation} ${it.responsiblePerson}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, departmentFilter, equipmentTypeFilter, maintenanceStatusFilter, inProgress, lastCompleted, search]);

  function toggleItem(rowNumber: number) {
    setSelectedRowNumbers((prev) =>
      prev.includes(rowNumber) ? prev.filter((n) => n !== rowNumber) : [...prev, rowNumber]
    );
  }

  function selectAllFiltered() {
    setSelectedRowNumbers((prev) => {
      const next = new Set(prev);
      for (const it of filteredItems) next.add(it.rowNumber);
      return [...next];
    });
  }

  function clearSelection() {
    setSelectedRowNumbers([]);
  }

  function updateOverride(rowNumber: number, field: "location" | "titlePrefix" | "nameOnly", value: string) {
    const source = items.find((it) => it.rowNumber === rowNumber);
    setOverrides((prev) => ({
      ...prev,
      [rowNumber]: {
        location: prev[rowNumber]?.location ?? source?.installLocation ?? "",
        titlePrefix: prev[rowNumber]?.titlePrefix ?? source?.titlePrefix ?? "",
        nameOnly: prev[rowNumber]?.nameOnly ?? source?.nameOnly ?? "",
        [field]: value,
      },
    }));
    // A fresh edit invalidates whatever save result was showing for this row.
    setRowSaveStatus((prev) => ({ ...prev, [rowNumber]: "idle" }));
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
        const location = o?.location ?? it.installLocation;
        const titlePrefix = o?.titlePrefix ?? it.titlePrefix;
        const nameOnly = o?.nameOnly ?? it.nameOnly;
        const responsiblePerson = [titlePrefix, nameOnly].filter(Boolean).join("");
        return {
          rowNumber: it.rowNumber,
          assetNumber: it.assetNumber,
          description: [it.equipmentType, it.brandModel].filter(Boolean).join(" — "),
          equipmentType: it.equipmentType,
          brandModel: it.brandModel,
          department: it.department,
          location,
          responsiblePerson,
          titlePrefix,
          nameOnly,
          canSaveResponsiblePerson: it.canSaveResponsiblePerson,
          snapshotHash: it.snapshotHash,
          locationChanged: location !== it.installLocation,
          responsiblePersonChanged: titlePrefix !== it.titlePrefix || nameOnly !== it.nameOnly,
        };
      });
  }, [selectedRowNumbers, items, overrides]);

  // Distinct กลุ่มงาน among the selected equipment, in first-picked order —
  // drives one "ผู้ตรวจสอบ" signature block per department below the table
  // (see the print area), so a single printout can cover several
  // departments' PM work in one day instead of one department per sheet.
  // Falls back to the old generic label when none of the selected rows
  // carry a department (e.g. that column is blank in the sheet).
  const selectedDepartments = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const row of selectedRows) {
      const dep = row.department.trim();
      if (dep && !seen.has(dep)) {
        seen.add(dep);
        list.push(dep);
      }
    }
    return list.length > 0 ? list : ["กลุ่มงานผู้รับบริการ"];
  }, [selectedRows]);

  // A responsible-person edit only counts as "savable" when the sheet uses
  // one combined name column (see canSaveResponsiblePerson) — otherwise
  // there is nothing this row could send the API that it would accept, so
  // treating it as dirty would just produce a confusing 400 on save.
  function hasSavableChange(row: SelectedRow): boolean {
    return row.locationChanged || (row.responsiblePersonChanged && row.canSaveResponsiblePerson);
  }

  const dirtyRowCount = selectedRows.filter(hasSavableChange).length;

  async function saveRow(row: SelectedRow) {
    if (!hasSavableChange(row)) return true;
    setRowSaveStatus((prev) => ({ ...prev, [row.rowNumber]: "saving" }));
    setRowSaveError((prev) => ({ ...prev, [row.rowNumber]: "" }));
    try {
      const body: Record<string, string> = { expectedSnapshotHash: row.snapshotHash };
      if (row.locationChanged) body.installLocation = row.location;
      if (row.responsiblePersonChanged && row.canSaveResponsiblePerson) {
        // Sent as a pair — see /api/manage/it/records/[rowNumber], which
        // needs both halves together regardless of which sheet shape (one
        // combined column, or split คำนำหน้า/ชื่อ-นามสกุล) it ends up in.
        body.responsibleTitlePrefix = row.titlePrefix;
        body.responsibleName = row.nameOnly;
      }
      const res = await fetch(`/api/manage/it/records/${row.rowNumber}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setRowSaveStatus((prev) => ({ ...prev, [row.rowNumber]: "error" }));
        setRowSaveError((prev) => ({ ...prev, [row.rowNumber]: json.error ?? "บันทึกไม่สำเร็จ" }));
        return false;
      }
      // Fold the saved values back into the base item so the row reads as
      // "up to date" (no longer "changed") and the next save's optimistic-
      // concurrency check uses the fresh snapshotHash instead of a stale one.
      setItems((prev) =>
        prev.map((it) =>
          it.rowNumber === row.rowNumber
            ? {
                ...it,
                installLocation: row.locationChanged ? row.location : it.installLocation,
                responsiblePerson:
                  row.responsiblePersonChanged && row.canSaveResponsiblePerson
                    ? row.responsiblePerson
                    : it.responsiblePerson,
                titlePrefix:
                  row.responsiblePersonChanged && row.canSaveResponsiblePerson ? row.titlePrefix : it.titlePrefix,
                nameOnly: row.responsiblePersonChanged && row.canSaveResponsiblePerson ? row.nameOnly : it.nameOnly,
                snapshotHash: json.snapshotHash ?? it.snapshotHash,
              }
            : it
        )
      );
      setRowSaveStatus((prev) => ({ ...prev, [row.rowNumber]: "saved" }));
      return true;
    } catch {
      setRowSaveStatus((prev) => ({ ...prev, [row.rowNumber]: "error" }));
      setRowSaveError((prev) => ({ ...prev, [row.rowNumber]: "บันทึกไม่สำเร็จ กรุณาลองใหม่" }));
      return false;
    }
  }

  async function saveAllChanged() {
    setSavingAll(true);
    try {
      for (const row of selectedRows) {
        if (hasSavableChange(row)) {
          await saveRow(row);
        }
      }
    } finally {
      setSavingAll(false);
    }
  }

  // CRUD for the "การดำเนินการ" checklist — see the SETTINGS_FIELDS-adjacent
  // section in the settings modal below. Blank rows are allowed while
  // editing (so a freshly-added row isn't yanked away before anyone can
  // type into it); cleanActionOptions strips them out at save/print time.
  function updateActionOption(index: number, value: string) {
    setFormSettings((prev) => ({
      ...prev,
      actionOptions: prev.actionOptions.map((v, i) => (i === index ? value : v)),
    }));
    setSettingsSaved(false);
  }

  function addActionOption() {
    setFormSettings((prev) => ({ ...prev, actionOptions: [...prev.actionOptions, ""] }));
    setSettingsSaved(false);
  }

  function removeActionOption(index: number) {
    setFormSettings((prev) =>
      prev.actionOptions.length <= 1 ? prev : { ...prev, actionOptions: prev.actionOptions.filter((_, i) => i !== index) }
    );
    setSettingsSaved(false);
  }

  async function saveSettingsAsDefault() {
    setSettingsSaving(true);
    setSettingsError(null);
    setSettingsSaved(false);
    try {
      const payload: ReportSettings = { ...formSettings, actionOptions: cleanActionOptions(formSettings.actionOptions) };
      const res = await fetch("/api/manage/it/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        setSettingsError(json.error ?? "บันทึกไม่สำเร็จ");
        return;
      }
      setFormSettings(json.settings);
      setSettingsSaved(true);
    } catch {
      setSettingsError("บันทึกไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setSettingsSaving(false);
    }
  }

  /** Logs one "in progress" maintenance task per selected item (see
   * /manage/it/tasks) and then opens the print dialog — printing this form
   * is the point a maintenance round is considered to have started. Task
   * logging never blocks the actual print: on failure it just leaves
   * taskCreateError up for the person to notice, since the paper form is
   * the part that has to happen regardless. */
  async function handlePrint() {
    if (selectedRows.length === 0) return;
    setCreatingTasks(true);
    setTaskCreateError(null);
    try {
      const res = await fetch("/api/manage/it/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: selectedRows.map((row) => ({
            equipmentRowNumber: row.rowNumber,
            assetNumber: row.assetNumber,
            equipmentType: row.equipmentType,
            brandModel: row.brandModel,
            department: row.department,
            location: row.location,
          })),
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setTaskCreateError(json.error ?? "บันทึกงานเข้าระบบติดตามไม่สำเร็จ — พิมพ์รายงานต่อได้ตามปกติ");
      }
    } catch {
      setTaskCreateError("บันทึกงานเข้าระบบติดตามไม่สำเร็จ — พิมพ์รายงานต่อได้ตามปกติ");
    } finally {
      setCreatingTasks(false);
    }
    window.print();
  }

  const displayDate = visitDate ? formatThaiDate(visitDate) : "";
  const timeRangeLabel = timeFrom && timeTo ? `${timeFrom} - ${timeTo}` : timeFrom || timeTo || "";
  // Blank rows mid-edit in the settings modal never leak into the printed
  // table — see cleanActionOptions.
  const printActionOptions = cleanActionOptions(formSettings.actionOptions);
  // One ผู้ตรวจสอบ block per department, then ผู้รับทราบ last — all rendered
  // from a single grid below so they pair up left/right instead of
  // ผู้รับทราบ always getting shoved onto its own row. See that grid's
  // comment for why.
  const signatureBlocks = [
    ...selectedDepartments.map((dep) => ({
      key: `inspector-${dep}`,
      heading: "ลงชื่อ ....................................................... ผู้ตรวจสอบ",
      nameLine: "(.......................................................)",
      positionLine: "ตำแหน่ง .......................................................",
      subLabel: dep,
    })),
    {
      key: "acknowledger",
      heading: "ลงชื่อ ....................................................... ผู้รับทราบ",
      nameLine: `(${formSettings.acknowledgerName})`,
      positionLine: `ตำแหน่ง ${formSettings.acknowledgerPosition}`,
      subLabel: formSettings.acknowledgerDepartment,
    },
  ];

  return (
    // translate="no" (+ the "notranslate" class, for older Chrome builds
    // that still key off it) tells Chrome's built-in page-translate feature
    // to leave this whole page alone. Without it, translating this page
    // lets Chrome rewrite text nodes behind React's back; the next time
    // React updates the DOM here (e.g. the month-strip popup below
    // appearing/disappearing on hover) it can crash trying to remove/update
    // a node Translate already altered — a well-known React ↔ Chrome
    // Translate conflict, not specific to this page's own logic. Since this
    // dashboard is Thai-only by design anyway, there's no reason to ever
    // offer translation on it.
    <main
      translate="no"
      className="notranslate flex w-full flex-1 justify-center bg-[var(--page-bg)] px-4 py-8 print:block print:bg-white print:px-0 print:py-0 sm:px-6 lg:px-10"
    >
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
                onClick={() => setShowSettings((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <Settings size={16} strokeWidth={2} aria-hidden="true" />
                ตั้งค่าแบบฟอร์มรายงาน
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

          {showSettings && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
              onClick={() => setShowSettings(false)}
              role="presentation"
            >
              <div
                className={`${CARD} flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden`}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between gap-3 border-b border-emerald-900/10 px-4 py-3 dark:border-emerald-400/10">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                    <Settings size={15} strokeWidth={2} aria-hidden="true" />
                    ตั้งค่าแบบฟอร์มรายงาน
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowSettings(false)}
                    className="rounded-full p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
                    aria-label="ปิด"
                  >
                    <X size={16} strokeWidth={2} aria-hidden="true" />
                  </button>
                </div>

                <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
                  {settingsError && (
                    <div
                      role="alert"
                      className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
                    >
                      {settingsError}
                    </div>
                  )}

                  {/* Each setting group gets its own bordered card — kept
                      visually distinct instead of one long form, since
                      these three are edited on different occasions (rarely
                      for the header text, often for the checklist). */}
                  <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
                    <p className="text-sm font-bold text-zinc-800 dark:text-zinc-100">ข้อความหัวแบบฟอร์ม</p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {SETTINGS_FIELDS.map(({ key, label }) => (
                        <label key={key} className="flex flex-col gap-1 text-sm text-zinc-500 dark:text-zinc-400">
                          {label}
                          <input
                            type="text"
                            value={formSettings[key]}
                            onChange={(e) => {
                              setFormSettings((prev) => ({ ...prev, [key]: e.target.value }));
                              setSettingsSaved(false);
                            }}
                            className={INPUT_CLASS}
                          />
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
                    <p className="text-sm font-bold text-zinc-800 dark:text-zinc-100">รายการ &quot;การดำเนินการ&quot;</p>
                    <div className="flex flex-col gap-2">
                      {formSettings.actionOptions.map((opt, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={opt}
                            onChange={(e) => updateActionOption(idx, e.target.value)}
                            placeholder="เช่น อัพเดทโปรแกรม Hosxp 3 เป็นเวอร์ชัน ...."
                            className={`${INPUT_CLASS} flex-1`}
                          />
                          <button
                            type="button"
                            onClick={() => removeActionOption(idx)}
                            disabled={formSettings.actionOptions.length <= 1}
                            title={formSettings.actionOptions.length <= 1 ? "ต้องมีอย่างน้อย 1 รายการ" : "ลบรายการนี้"}
                            aria-label="ลบรายการนี้"
                            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-zinc-200 disabled:hover:bg-transparent disabled:hover:text-zinc-500 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-red-900/50 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                          >
                            <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={addActionOption}
                      className="inline-flex w-fit items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      <Plus size={14} strokeWidth={2} aria-hidden="true" />
                      เพิ่มรายการ
                    </button>
                  </div>

                  <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
                    <p className="text-sm font-bold text-zinc-800 dark:text-zinc-100">แนวกระดาษที่พิมพ์</p>
                    {/* Chrome hides its own print-dialog "Layout" control
                        once the page's @page CSS sets a size, so this is
                        what actually switches orientation — see the
                        `orientation` state comment above. Defaults to
                        landscape since the table is wide enough that
                        that's the right choice almost every time. */}
                    <div
                      role="group"
                      aria-label="แนวกระดาษ"
                      className="inline-flex w-fit items-center rounded-full border border-zinc-200 p-0.5 dark:border-zinc-700"
                    >
                      <button
                        type="button"
                        onClick={() => setOrientation("portrait")}
                        aria-pressed={orientation === "portrait"}
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                          orientation === "portrait"
                            ? "bg-[var(--brand)] text-[var(--brand-contrast)]"
                            : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        }`}
                      >
                        <RectangleVertical size={16} strokeWidth={2} aria-hidden="true" />
                        แนวตั้ง
                      </button>
                      <button
                        type="button"
                        onClick={() => setOrientation("landscape")}
                        aria-pressed={orientation === "landscape"}
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                          orientation === "landscape"
                            ? "bg-[var(--brand)] text-[var(--brand-contrast)]"
                            : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        }`}
                      >
                        <RectangleHorizontal size={16} strokeWidth={2} aria-hidden="true" />
                        แนวนอน
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 border-t border-emerald-900/10 px-4 py-3 dark:border-emerald-400/10">
                  <button
                    type="button"
                    onClick={saveSettingsAsDefault}
                    disabled={settingsSaving}
                    className="inline-flex items-center gap-2 rounded-full bg-[var(--brand)] px-5 py-2.5 text-sm font-semibold text-[var(--brand-contrast)] shadow-sm transition-colors hover:bg-[var(--brand-strong)] disabled:opacity-60"
                  >
                    {settingsSaving ? (
                      <Loader2 size={16} strokeWidth={2} className="animate-spin" aria-hidden="true" />
                    ) : (
                      <Save size={16} strokeWidth={2} aria-hidden="true" />
                    )}
                    บันทึกเป็นค่าเริ่มต้น
                  </button>
                  {settingsSaved && (
                    <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                      <Check size={15} strokeWidth={2} aria-hidden="true" />
                      บันทึกแล้ว
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className={`${CARD} flex flex-col gap-3 p-4`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
              <MultiSelect
                label="กรองตามกลุ่มงาน"
                options={departmentOptions}
                selected={departmentFilter}
                onChange={setDepartmentFilter}
                className="sm:max-w-xs sm:flex-1"
              />
              <MultiSelect
                label="กรองตามประเภทครุภัณฑ์"
                options={equipmentTypeOptions}
                selected={equipmentTypeFilter}
                onChange={setEquipmentTypeFilter}
                className="sm:max-w-xs sm:flex-1"
              />
              <label className="flex flex-col gap-1 text-sm text-zinc-500 dark:text-zinc-400">
                เดือนที่บำรุงรักษา
                <select
                  value={maintenanceMonthFilter}
                  onChange={(e) => setMaintenanceMonthFilter(e.target.value)}
                  aria-label="กรองสถานะบำรุงรักษาตามเดือน"
                  className={INPUT_CLASS}
                >
                  {THAI_MONTHS_FULL.map((label, idx) => (
                    <option key={label} value={idx + 1}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-zinc-500 dark:text-zinc-400">
                ปีที่บำรุงรักษา
                <select
                  value={maintenanceYearFilter}
                  onChange={(e) => setMaintenanceYearFilter(e.target.value)}
                  aria-label="กรองสถานะบำรุงรักษาตามปี"
                  className={INPUT_CLASS}
                >
                  {maintenanceYearOptions.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-zinc-500 dark:text-zinc-400">
                กรองสถานะ
                <select
                  value={maintenanceStatusFilter}
                  onChange={(e) => setMaintenanceStatusFilter(e.target.value as typeof maintenanceStatusFilter)}
                  aria-label="กรองรายการตามสถานะบำรุงรักษา"
                  className={INPUT_CLASS}
                >
                  <option value="">ทั้งหมด</option>
                  <option value="in_progress">กำลังดำเนินการ</option>
                  <option value="done">เสร็จสิ้นแล้ว</option>
                  <option value="none">ยังไม่เคยบำรุงรักษา</option>
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
            </div>
            <p className="text-xs text-zinc-400">
              &quot;เดือน/ปีที่บำรุงรักษา&quot; กรองป้ายสถานะและจำนวนครั้งด้านล่างให้ตรงกับเดือนนั้นโดยเฉพาะ (ค่าเริ่มต้นคือเดือน/ปีปัจจุบันเสมอ — สถานะจึงรีเซ็ตใหม่ทุกเดือน) — &quot;กรองสถานะ&quot; ใช้ผลจากเดือนเดียวกันนี้มาซ่อนรายการที่ไม่ตรงเงื่อนไขออกจากตารางด้านล่างด้วย แถบ 12 เดือนในตารางยังแสดงประวัติทั้งปีให้ย้อนดูได้เสมอ ไม่ถูกซ่อนตามตัวกรองนี้
            </p>
            {(actionLegend.primary.length > 0 || actionLegend.hasOther) && (
              <div
                className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400"
                aria-label="คำอธิบายสีของรายการที่ดำเนินการในแถบ 12 เดือน"
              >
                <span className="text-zinc-400 dark:text-zinc-500">สีในแถบเดือน:</span>
                {actionLegend.primary.map(({ name, color }) => (
                  <span key={name} className="inline-flex items-center gap-1">
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--seg-c)] dark:bg-[var(--seg-c-dark)]"
                      style={actionColorStyle(color)}
                      aria-hidden="true"
                    />
                    {name}
                  </span>
                ))}
                {actionLegend.hasOther && (
                  <span className="inline-flex items-center gap-1">
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--seg-c)] dark:bg-[var(--seg-c-dark)]"
                      style={actionColorStyle(ACTION_OTHER_COLOR)}
                      aria-hidden="true"
                    />
                    อื่นๆ
                  </span>
                )}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={selectAllFiltered}
                disabled={filteredItems.length === 0}
                className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <Check size={13} strokeWidth={2} aria-hidden="true" />
                เลือกทั้งหมดที่กรองอยู่ ({filteredItems.length.toLocaleString("th-TH")})
              </button>
              {selectedRowNumbers.length > 0 && (
                <button
                  type="button"
                  onClick={clearSelection}
                  className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  <X size={13} strokeWidth={2} aria-hidden="true" />
                  ล้างที่เลือก
                </button>
              )}
              <span className="text-sm text-zinc-400 sm:ml-auto">
                เลือกแล้ว {selectedRowNumbers.length.toLocaleString("th-TH")} รายการ
              </span>
            </div>
            <div className="max-h-80 overflow-y-auto rounded-lg border border-zinc-100 dark:border-zinc-800">
              <table className="w-full table-fixed text-left text-xs sm:text-sm">
                {/* Explicit column widths — เดือนที่บำรุงรักษา gets the extra
                    room freed up from ผู้รับผิดชอบครุภัณฑ์, whose content
                    (a name) rarely needs as much width as an unconstrained
                    table would otherwise give it (see the user's screenshot
                    pointing at that dead space). */}
                <colgroup>
                  <col className="w-10" />
                  <col className="w-[30%]" />
                  <col className="w-[24%]" />
                  <col className="w-[20%]" />
                  <col className="w-[18%]" />
                </colgroup>
                <thead className="sticky top-0 bg-white dark:bg-zinc-900">
                  <tr className="border-b border-zinc-100 text-[10px] uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
                    <th scope="col" className="px-2 py-2 font-medium">เลือก</th>
                    <th scope="col" className="px-2 py-2 font-medium">เดือนที่บำรุงรักษา</th>
                    <th scope="col" className="px-2 py-2 font-medium">รายการ</th>
                    <th scope="col" className="px-2 py-2 font-medium">กลุ่มงาน / สถานที่ตั้ง</th>
                    <th scope="col" className="px-2 py-2 font-medium">ผู้รับผิดชอบครุภัณฑ์</th>
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
                      <td className="px-2 py-1.5 align-top">
                        <div
                          className="flex items-start gap-[3px]"
                          role="group"
                          aria-label={`เดือนที่บำรุงรักษาในปี ${maintenanceYearFilter || "ทุกปี"}`}
                        >
                          {THAI_MONTHS_SHORT.map((label, monthIdx) => {
                            const monthTasks = monthlyTasks[it.rowNumber]?.[monthIdx] ?? [];
                            const hasInProgress = monthTasks.some((t) => t.status === "in_progress");
                            const isFilteredMonth = String(monthIdx + 1) === maintenanceMonthFilter;
                            const isEmpty = monthTasks.length === 0;
                            // Every "การดำเนินการ" item logged by any visit
                            // that month, combined — a month with 2+ visits
                            // (each with its own actionsTaken list) shows all
                            // of them together, flattened in order, per the
                            // hospital's request to see the whole month's
                            // work at a glance rather than only the latest
                            // visit.
                            const allActions = hasInProgress
                              ? []
                              : monthTasks.flatMap((t) =>
                                  t.actionsTaken.map((a) => a.trim()).filter(Boolean)
                                );
                            // De-dotted ("ม.ค." -> "มค") so the abbreviation
                            // reads cleanly as its own small label under the
                            // bar — the full-dotted form is still used
                            // everywhere else (title/aria-label, dates, the
                            // popup heading).
                            const shortLabel = label.replace(/\./g, "");
                            return (
                              <div key={monthIdx} className="flex shrink-0 flex-col items-center gap-0.5">
                                <button
                                  type="button"
                                  onClick={() => setMonthPopup({ rowNumber: it.rowNumber, month: monthIdx })}
                                  title={`${label}: บำรุงรักษา ${monthTasks.length.toLocaleString("th-TH")} ครั้ง${
                                    allActions.length > 0 ? ` — ${allActions.join(", ")}` : ""
                                  } — คลิกเพื่อดูรายละเอียด`}
                                  aria-label={`${label}: บำรุงรักษา ${monthTasks.length.toLocaleString("th-TH")} ครั้ง${
                                    allActions.length > 0 ? ` — ${allActions.join(", ")}` : ""
                                  } — คลิกเพื่อดูรายละเอียด`}
                                  className={`flex h-7 w-3.5 flex-col overflow-hidden rounded-[3px] transition-colors ${
                                    isFilteredMonth
                                      ? "ring-2 ring-[var(--brand)] ring-offset-1 ring-offset-white dark:ring-offset-zinc-900"
                                      : ""
                                  }`}
                                >
                                  {isEmpty ? (
                                    <span className="h-full w-full bg-zinc-200 dark:bg-zinc-700" />
                                  ) : hasInProgress ? (
                                    <span className="h-full w-full bg-amber-500 dark:bg-amber-400" />
                                  ) : allActions.length === 0 ? (
                                    <span className="h-full w-full bg-emerald-500 dark:bg-emerald-400" />
                                  ) : (
                                    <span className="flex h-full w-full flex-col gap-px bg-white dark:bg-zinc-900">
                                      {allActions.map((name, i) => (
                                        <span
                                          key={i}
                                          className="min-h-0 flex-1 bg-[var(--seg-c)] dark:bg-[var(--seg-c-dark)]"
                                          style={actionColorStyle(colorForAction(name))}
                                        />
                                      ))}
                                    </span>
                                  )}
                                </button>
                                <span className="text-[7px] leading-none font-medium text-zinc-400 select-none dark:text-zinc-500">
                                  {shortLabel}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                        {visitCounts[it.rowNumber] > 0 && (
                          <p className="mt-1 text-[9px] text-zinc-400 dark:text-zinc-500">
                            {visitCounts[it.rowNumber].toLocaleString("th-TH")} ครั้ง (
                            {THAI_MONTHS_SHORT[Number(maintenanceMonthFilter) - 1] ?? ""})
                          </p>
                        )}
                        {(() => {
                          // Chip list of the currently-filtered month's
                          // distinct actions, color-matched to the segments
                          // above — lets the hospital see what was done
                          // without clicking into the popup, for whichever
                          // month "เดือนที่บำรุงรักษา" is currently set to.
                          const filteredMonthIdx = Number(maintenanceMonthFilter) - 1;
                          const filteredMonthTasks = monthlyTasks[it.rowNumber]?.[filteredMonthIdx] ?? [];
                          const names = [
                            ...new Set(
                              filteredMonthTasks.flatMap((t) =>
                                t.actionsTaken.map((a) => a.trim()).filter(Boolean)
                              )
                            ),
                          ];
                          if (names.length === 0) return null;
                          return (
                            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                              {names.map((name) => (
                                <span
                                  key={name}
                                  className="inline-flex items-center gap-1 text-[9px] text-zinc-500 dark:text-zinc-400"
                                >
                                  <span
                                    className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--seg-c)] dark:bg-[var(--seg-c-dark)]"
                                    style={actionColorStyle(colorForAction(name))}
                                    aria-hidden="true"
                                  />
                                  {name}
                                </span>
                              ))}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-2 py-1.5 text-zinc-700 dark:text-zinc-300 align-top">
                        <div className="font-medium">{it.equipmentType || "—"}</div>
                        <div className="text-[10px] leading-snug text-zinc-400 dark:text-zinc-500">
                          {[it.assetNumber, it.brandModel].filter(Boolean).join(" · ") || "—"}
                        </div>
                        {inProgress[it.rowNumber] ? (
                          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                            <Wrench size={10} strokeWidth={2} aria-hidden="true" />
                            กำลังบำรุงรักษาโดย {inProgress[it.rowNumber].displayName}
                          </span>
                        ) : (
                          lastCompleted[it.rowNumber] && (
                            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                              <CheckCircle2 size={10} strokeWidth={2} aria-hidden="true" />
                              เสร็จสิ้นล่าสุดโดย {lastCompleted[it.rowNumber].displayName}
                              {lastCompleted[it.rowNumber].completedAt &&
                                ` เมื่อ ${formatThaiDate(lastCompleted[it.rowNumber].completedAt.slice(0, 10))}`}
                            </span>
                          )
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-zinc-700 dark:text-zinc-300 align-top">
                        <div>{it.department || "—"}</div>
                        <div className="text-[10px] leading-snug text-zinc-400 dark:text-zinc-500">
                          {it.installLocation || "—"}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-zinc-700 dark:text-zinc-300 align-top">
                        {it.responsiblePerson || "—"}
                      </td>
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

          {/* Month-strip popup — a small centered modal listing the
              maintenance tasks for whichever tick was clicked (see
              monthPopup state above). Click-only, same
              backdrop-click-to-close pattern as showSettings/showAdjustModal
              below — deliberately NOT a hover-following tooltip (an earlier
              version was, and a tooltip rendered close enough to the cursor
              ended up stealing the mouseleave/mouseenter pair from the tick
              underneath it, looping open→close→open fast enough to crash
              the tab). A modal has no hover state to fight over. */}
          {monthPopup && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
              onClick={() => setMonthPopup(null)}
              role="presentation"
            >
              <div
                className={`${CARD} flex max-h-[70vh] w-full max-w-sm flex-col overflow-hidden`}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between gap-3 border-b border-emerald-900/10 px-4 py-3 dark:border-emerald-400/10">
                  <div>
                    <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                      {THAI_MONTHS_FULL[monthPopup.month]} {maintenanceYearFilter || String(new Date().getFullYear() + 543)}
                    </p>
                    {(() => {
                      const item = items.find((it) => it.rowNumber === monthPopup.rowNumber);
                      return item ? (
                        <p className="text-xs text-zinc-400 dark:text-zinc-500">
                          {[item.equipmentType, item.assetNumber].filter(Boolean).join(" · ") || "—"}
                        </p>
                      ) : null;
                    })()}
                  </div>
                  <button
                    type="button"
                    onClick={() => setMonthPopup(null)}
                    className="rounded-full p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
                    aria-label="ปิด"
                  >
                    <X size={16} strokeWidth={2} aria-hidden="true" />
                  </button>
                </div>
                <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-4 text-sm">
                  {(monthlyTasks[monthPopup.rowNumber]?.[monthPopup.month] ?? []).length === 0 ? (
                    <p className="text-zinc-400">ไม่มีการบำรุงรักษาในเดือนนี้</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {(monthlyTasks[monthPopup.rowNumber]?.[monthPopup.month] ?? []).map((t, i) => (
                        <li key={i} className="flex flex-col gap-1 rounded-lg border border-zinc-100 p-2 dark:border-zinc-800">
                          <div className="flex items-start gap-1.5">
                            {t.status === "in_progress" ? (
                              <Wrench size={13} strokeWidth={2} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                            ) : (
                              <CheckCircle2 size={13} strokeWidth={2} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                            )}
                            <span className="text-zinc-700 dark:text-zinc-300">
                              {formatThaiDate((t.status === "in_progress" ? t.createdAt : t.completedAt || t.createdAt).slice(0, 10))} — {t.displayName}
                              {t.status === "in_progress" && " (กำลังดำเนินการ)"}
                            </span>
                          </div>
                          {t.actionsTaken.length === 0 && t.inspectionChecks.length === 0 ? (
                            <p className="pl-[19px] text-xs text-zinc-400 italic">ยังไม่ได้บันทึกรายละเอียดการดำเนินการ</p>
                          ) : (
                            <>
                              {t.actionsTaken.length > 0 && (
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-[19px] text-xs text-zinc-500 dark:text-zinc-400">
                                  <span className="font-medium text-zinc-600 dark:text-zinc-300">การดำเนินการ:</span>
                                  {t.actionsTaken.map((name, actionIdx) => (
                                    <span key={actionIdx} className="inline-flex items-center gap-1">
                                      <span
                                        className="inline-block h-2 w-2 shrink-0 rounded-full bg-[var(--seg-c)] dark:bg-[var(--seg-c-dark)]"
                                        style={actionColorStyle(colorForAction(name))}
                                        aria-hidden="true"
                                      />
                                      {name.trim()}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {t.inspectionChecks.length > 0 && (
                                <p className="pl-[19px] text-xs text-zinc-500 dark:text-zinc-400">
                                  <span className="font-medium text-zinc-600 dark:text-zinc-300">ผลตรวจสอบโดย IT:</span>{" "}
                                  {formatInspectionResult(t)}
                                </p>
                              )}
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}

          {showAdjustModal && selectedRows.length > 0 && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
              onClick={() => setShowAdjustModal(false)}
              role="presentation"
            >
              <div
                className={`${CARD} flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden`}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between gap-3 border-b border-emerald-900/10 px-4 py-3 dark:border-emerald-400/10">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                    <MapPin size={15} strokeWidth={2} aria-hidden="true" />
                    แก้ไข &quot;สถานที่ตั้ง&quot; / &quot;ผู้รับผิดชอบครุภัณฑ์&quot; ก่อนพิมพ์
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAdjustModal(false)}
                    className="rounded-full p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
                    aria-label="ปิด"
                  >
                    <X size={16} strokeWidth={2} aria-hidden="true" />
                  </button>
                </div>

                <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
                  <div className="flex flex-col gap-2">
                    {selectedRows.map((row) => {
                      const status = rowSaveStatus[row.rowNumber] ?? "idle";
                      return (
                        <div
                          key={row.rowNumber}
                          className="grid grid-cols-1 gap-2 border-b border-zinc-50 pb-2 last:border-0 sm:grid-cols-[1fr_1fr_0.7fr_1fr_auto] dark:border-zinc-800/60"
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
                          <select
                            value={row.titlePrefix}
                            onChange={(e) => updateOverride(row.rowNumber, "titlePrefix", e.target.value)}
                            aria-label="คำนำหน้า"
                            title={
                              row.canSaveResponsiblePerson
                                ? undefined
                                : "ชีตนี้ไม่มีคอลัมน์ชื่อผู้รับผิดชอบครุภัณฑ์ — แก้ไขได้เฉพาะรายงานนี้ บันทึกลงระบบไม่ได้"
                            }
                            className={INPUT_CLASS}
                          >
                            <option value="">คำนำหน้า</option>
                            {TITLE_PREFIX_OPTIONS.map((p) => (
                              <option key={p} value={p}>
                                {p}
                              </option>
                            ))}
                          </select>
                          <input
                            type="text"
                            value={row.nameOnly}
                            onChange={(e) => updateOverride(row.rowNumber, "nameOnly", e.target.value)}
                            placeholder="ชื่อ-นามสกุล"
                            title={
                              row.canSaveResponsiblePerson
                                ? undefined
                                : "ชีตนี้ไม่มีคอลัมน์ชื่อผู้รับผิดชอบครุภัณฑ์ — แก้ไขได้เฉพาะรายงานนี้ บันทึกลงระบบไม่ได้"
                            }
                            className={INPUT_CLASS}
                          />
                          <div className="flex items-center gap-1.5 self-center text-xs">
                            {status === "saving" && (
                              <Loader2 size={14} strokeWidth={2} className="animate-spin text-zinc-400" aria-hidden="true" />
                            )}
                            {status === "saved" && (
                              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                                <Check size={14} strokeWidth={2} aria-hidden="true" />
                                บันทึกแล้ว
                              </span>
                            )}
                            {status === "error" && (
                              <span className="text-red-600 dark:text-red-400" title={rowSaveError[row.rowNumber]}>
                                บันทึกไม่สำเร็จ
                              </span>
                            )}
                            {hasSavableChange(row) && status !== "saving" && (
                              <button
                                type="button"
                                onClick={() => saveRow(row)}
                                className="inline-flex items-center gap-1 rounded-full border border-zinc-200 px-2 py-1 font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                              >
                                <Save size={12} strokeWidth={2} aria-hidden="true" />
                                บันทึก
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center gap-3 border-t border-emerald-900/10 px-4 py-3 dark:border-emerald-400/10">
                  <button
                    type="button"
                    onClick={saveAllChanged}
                    disabled={dirtyRowCount === 0 || savingAll}
                    className="inline-flex items-center gap-2 rounded-full bg-[var(--brand)] px-5 py-2.5 text-sm font-semibold text-[var(--brand-contrast)] shadow-sm transition-colors hover:bg-[var(--brand-strong)] disabled:opacity-60"
                  >
                    {savingAll ? (
                      <Loader2 size={16} strokeWidth={2} className="animate-spin" aria-hidden="true" />
                    ) : (
                      <Save size={16} strokeWidth={2} aria-hidden="true" />
                    )}
                    บันทึกข้อมูลที่แก้ไขลงระบบ{dirtyRowCount > 0 ? ` (${dirtyRowCount})` : ""}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* The printable form itself — kept visible on screen too (as a live
            preview) so what ends up on paper is never a surprise. */}
        <div className="print-area rounded-2xl border border-zinc-200 bg-white p-8 text-zinc-900 shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
          <div className="flex flex-col items-center gap-1 text-center">
            <p className="text-base font-bold">{formSettings.orgName}</p>
            <p className="text-base font-bold">{formSettings.maintenanceFormTitle}</p>
            <p className="text-sm">{formSettings.fiscalYearLabel}</p>
            {formDepartment && <p className="mt-1 text-sm">กลุ่มงาน: {formDepartment}</p>}
          </div>

          <div className="mt-4">
            <p className="mb-2 text-sm font-semibold">ข้อมูลครุภัณฑ์ที่ดำเนินการบำรุงรักษา</p>
            <table className="w-full border-collapse text-[10px] leading-snug">
              <colgroup>
                <col className="w-[4%]" />
                <col className="w-[13%]" />
                <col className="w-[20%]" />
                <col className="w-[14%]" />
                <col className="w-[14%]" />
                <col className="w-[14%]" />
                <col className="w-[21%]" />
              </colgroup>
              <thead>
                <tr>
                  <th className="border border-zinc-400 px-1 py-1 font-medium">ลำดับ</th>
                  <th className="border border-zinc-400 px-1 py-1 font-medium">หมายเลขครุภัณฑ์</th>
                  <th className="border border-zinc-400 px-1 py-1 font-medium">รายการครุภัณฑ์</th>
                  <th className="border border-zinc-400 px-1 py-1 font-medium">สถานที่ตั้ง</th>
                  <th className="border border-zinc-400 px-1 py-1 font-medium">ผู้รับผิดชอบครุภัณฑ์</th>
                  <th className="border border-zinc-400 px-1 py-1 font-medium">การดำเนินการ</th>
                  <th className="border border-zinc-400 px-1 py-1 font-medium">ผลการตรวจสอบโดย IT</th>
                </tr>
              </thead>
              <tbody>
                {selectedRows.map((row, i) => (
                  <tr key={row.rowNumber}>
                    <td className="border border-zinc-400 px-1 py-1 text-center align-top">{i + 1}</td>
                    <td className="border border-zinc-400 px-1 py-1 align-top whitespace-nowrap text-[9px]">
                      {row.assetNumber || "—"}
                    </td>
                    <td className="border border-zinc-400 px-1 py-1 align-top">
                      <div className="font-medium">{row.equipmentType || "—"}</div>
                      {row.brandModel && (
                        <div className="text-[8.5px] leading-snug text-zinc-500">{row.brandModel}</div>
                      )}
                    </td>
                    <td className="border border-zinc-400 px-1 py-1 align-top">
                      {row.department && (
                        <div className="text-[8.5px] leading-snug text-zinc-500">{row.department}</div>
                      )}
                      <div>{row.location || "—"}</div>
                    </td>
                    <td className="border border-zinc-400 px-1 py-1 align-top">{row.responsiblePerson || "—"}</td>
                    <td className="border border-zinc-400 px-1 py-1 align-top text-[9px] leading-snug">
                      <div className="flex flex-col gap-0.5">
                        {printActionOptions.map((label) => (
                          <span key={label}>☐ {label}</span>
                        ))}
                      </div>
                    </td>
                    <td className="border border-zinc-400 px-1 py-1 align-top">
                      <div className="grid grid-cols-2 gap-x-1 gap-y-0.5 whitespace-nowrap text-[9px]">
                        <span>☐ ปกติ</span>
                        <span>☐ เปลี่ยนอะไหล่ ................</span>
                        <span>☐ ส่งซ่อม</span>
                        <span>☐ อื่นๆ ระบุ .....................</span>
                      </div>
                    </td>
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

          <div className="mt-4 text-sm print:break-inside-avoid">
            <div className="flex flex-wrap gap-x-8 gap-y-2">
              <span>วันที่ดำเนินการ {displayDate || "............................................."}</span>
              <span>ช่วงเวลา {timeRangeLabel || "....................."}</span>
              <span>ผู้ดำเนินการ {currentUser.displayName || currentUser.username}</span>
            </div>
          </div>

          {/* One "ผู้ตรวจสอบ" block per department represented in the
              selection (see selectedDepartments above), plus ผู้รับทราบ as
              the final block in the very same grid — so with one
              department it pairs up naturally as ผู้ตรวจสอบ-left /
              ผู้รับทราบ-right instead of ผู้รับทราบ always being forced onto
              its own row below (wasting the row's other half). Lets one
              printout cover several departments' PM visits in a single day.
              print:break-inside-avoid on each block stops a page break from
              ever landing mid-signature; an odd one out (here, whichever
              block ends up alone) spans both columns instead of sitting
              lopsided in a half-filled row. */}
          <div className="mt-6 grid grid-cols-1 gap-x-8 gap-y-8 text-center text-sm sm:grid-cols-2">
            {signatureBlocks.map((block, idx) => (
              <div
                key={block.key}
                className={`flex flex-col items-center gap-1.5 print:break-inside-avoid ${
                  signatureBlocks.length % 2 === 1 && idx === signatureBlocks.length - 1 ? "sm:col-span-2" : ""
                }`}
              >
                {/* pt-6 leaves blank room above the dotted line for an
                    actual pen signature — the dots alone (no space above
                    them) left no room to sign without touching the block
                    above. */}
                <p className="pt-6">{block.heading}</p>
                <p>{block.nameLine}</p>
                <p>{block.positionLine}</p>
                <p>{block.subLabel}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Actions for the preview above — moved below it (rather than the
            page header) so they read as "do this to the form you just
            reviewed" instead of being disconnected from it up top. */}
        <div className="no-print flex flex-col items-end gap-2 print:hidden">
          {taskCreateError && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {taskCreateError}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowAdjustModal(true)}
              disabled={selectedRows.length === 0}
              title={selectedRows.length === 0 ? "เลือกครุภัณฑ์อย่างน้อย 1 รายการก่อน" : undefined}
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <MapPin size={16} strokeWidth={2} aria-hidden="true" />
              แก้ไขสถานที่ตั้ง / ผู้รับผิดชอบ
              {dirtyRowCount > 0 && (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-xs font-semibold text-white">
                  {dirtyRowCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={handlePrint}
              disabled={selectedRows.length === 0 || creatingTasks}
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--brand)] px-4 py-2 text-sm font-medium text-[var(--brand-contrast)] transition-colors hover:bg-[var(--brand-strong)] disabled:opacity-50"
            >
              {creatingTasks ? (
                <Loader2 size={16} strokeWidth={2} className="animate-spin" aria-hidden="true" />
              ) : (
                <PrinterIcon size={16} strokeWidth={2} aria-hidden="true" />
              )}
              พิมพ์ / บันทึกเป็น PDF
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          @page { size: A4 ${orientation}; margin: 14mm; }
          html, body { background: #fff !important; }
          .no-print { display: none !important; }
          .print-area, .print-area * { color: #000 !important; border-color: #52525b !important; }
          .print-area tr { break-inside: avoid; }
        }
      `}</style>
    </main>
  );
}
