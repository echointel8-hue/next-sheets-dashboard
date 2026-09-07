"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Loader2,
  MapPin,
  Printer as PrinterIcon,
  RectangleHorizontal,
  RectangleVertical,
  Save,
  Settings,
  X,
} from "lucide-react";
import type { ReportSettings } from "@/lib/sheets";
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
  responsiblePerson: string;
  disposed: boolean;
  /** For the optimistic-concurrency check on save-back — see
   * /api/manage/it/records/[rowNumber]. */
  snapshotHash: string;
  /** False when the sheet splits คำนำหน้า/ชื่อ-นามสกุล into separate
   * columns — a free-text name can't be saved back to two cells reliably,
   * so the save button for this one field is hidden in that case (editing
   * it for just this printout still works). */
  canSaveResponsiblePerson: boolean;
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
  location: string;
  responsiblePerson: string;
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

/** "2026-08-14" -> "14 ส.ค. 2569" (Buddhist calendar, matching every other
 * Thai date on this site — see Dashboard.tsx's own date formatting). */
function formatThaiDate(iso: string): string {
  const parts = iso.split("-").map(Number);
  const [y, m, d] = parts;
  if (!y || !m || !d) return iso;
  return `${d} ${THAI_MONTHS_SHORT[m - 1] ?? ""} ${y + 543}`;
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
}: {
  items: ReportEquipmentItem[];
  loadError: string | null;
  settings: ReportSettings;
}) {
  const [items, setItems] = useState(initialItems);
  // Multi-select — an empty array means "no filter on that dimension", same
  // convention as the department/equipment-type filters on /manage and
  // /manage/it (see MultiSelect).
  const [departmentFilter, setDepartmentFilter] = useState<string[]>([]);
  const [equipmentTypeFilter, setEquipmentTypeFilter] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [selectedRowNumbers, setSelectedRowNumbers] = useState<number[]>([]);
  const [formDepartment, setFormDepartment] = useState("");
  const [visitDate, setVisitDate] = useState("");
  const [timeFrom, setTimeFrom] = useState("");
  const [timeTo, setTimeTo] = useState("");
  const [overrides, setOverrides] = useState<
    Record<number, { location: string; responsiblePerson: string }>
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
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("portrait");

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

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (departmentFilter.length > 0 && !departmentFilter.includes(it.department)) return false;
      if (equipmentTypeFilter.length > 0 && !equipmentTypeFilter.includes(it.equipmentType)) return false;
      if (q) {
        const hay = `${it.assetNumber} ${it.brandModel} ${it.equipmentType} ${it.installLocation} ${it.responsiblePerson}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, departmentFilter, equipmentTypeFilter, search]);

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
        const responsiblePerson = o?.responsiblePerson ?? it.responsiblePerson;
        return {
          rowNumber: it.rowNumber,
          assetNumber: it.assetNumber,
          description: [it.equipmentType, it.brandModel].filter(Boolean).join(" — "),
          equipmentType: it.equipmentType,
          brandModel: it.brandModel,
          location,
          responsiblePerson,
          canSaveResponsiblePerson: it.canSaveResponsiblePerson,
          snapshotHash: it.snapshotHash,
          locationChanged: location !== it.installLocation,
          responsiblePersonChanged: responsiblePerson !== it.responsiblePerson,
        };
      });
  }, [selectedRowNumbers, items, overrides]);

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
        body.responsiblePerson = row.responsiblePerson;
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

  async function saveSettingsAsDefault() {
    setSettingsSaving(true);
    setSettingsError(null);
    setSettingsSaved(false);
    try {
      const res = await fetch("/api/manage/it/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formSettings),
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
                onClick={() => setShowSettings((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <Settings size={16} strokeWidth={2} aria-hidden="true" />
                ตั้งค่าแบบฟอร์มรายงาน
              </button>
              <button
                type="button"
                onClick={() => setShowAdjustModal(true)}
                disabled={selectedRows.length === 0}
                title={
                  selectedRows.length === 0
                    ? "เลือกครุภัณฑ์อย่างน้อย 1 รายการก่อน"
                    : undefined
                }
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
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    ข้อความหัวแบบฟอร์ม / ผู้รับทราบ — แก้ไขที่นี่จะใช้กับรายงานฉบับนี้ทันที กด &quot;บันทึกเป็นค่าเริ่มต้น&quot;
                    ด้านล่างเพิ่ม ถ้าต้องการให้ใช้ในรายงานครั้งถัดไปด้วย
                  </p>
                  {settingsError && (
                    <div
                      role="alert"
                      className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
                    >
                      {settingsError}
                    </div>
                  )}
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

                  <div className="mt-1 flex flex-col gap-1.5 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                    <span className="text-sm text-zinc-500 dark:text-zinc-400">
                      แนวกระดาษที่พิมพ์ (ตารางกว้างหลายคอลัมน์ — เลือกแนวนอนถ้าพอดีกว่า)
                    </span>
                    {/* Chrome hides its own print-dialog "Layout" control
                        once the page's @page CSS sets a size, so this is
                        what actually switches orientation — see the
                        `orientation` state comment above. */}
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
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    ใช้เมื่อข้อมูลในระบบไม่ตรงกับปัจจุบัน — แก้ไขที่นี่ใช้กับรายงานฉบับนี้ทันที กด &quot;บันทึกข้อมูลที่แก้ไขลงระบบ&quot;
                    ด้านล่างเพิ่ม ถ้าต้องการแก้ไขข้อมูลจริงในฐานข้อมูลด้วย (จะบันทึกลง log การแก้ไขเหมือนการแก้ไขทั่วไป)
                  </p>
                  <div className="flex flex-col gap-2">
                    {selectedRows.map((row) => {
                      const status = rowSaveStatus[row.rowNumber] ?? "idle";
                      return (
                        <div
                          key={row.rowNumber}
                          className="grid grid-cols-1 gap-2 border-b border-zinc-50 pb-2 last:border-0 sm:grid-cols-[1fr_1fr_1fr_auto] dark:border-zinc-800/60"
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
                            title={
                              row.canSaveResponsiblePerson
                                ? undefined
                                : "ชีตนี้แยกคอลัมน์คำนำหน้า/ชื่อ-นามสกุล — แก้ไขได้เฉพาะรายงานนี้ บันทึกลงระบบไม่ได้"
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

          <div className="mt-5">
            <p className="mb-2 text-sm font-semibold">ส่วนที่ 1 ข้อมูลครุภัณฑ์ที่ดำเนินการบำรุงรักษา</p>
            <table className="w-full border-collapse text-[10px] leading-snug">
              <colgroup>
                <col className="w-[4%]" />
                <col className="w-[13%]" />
                <col className="w-[20%]" />
                <col className="w-[14%]" />
                <col className="w-[14%]" />
                <col className="w-[10%]" />
                <col className="w-[25%]" />
              </colgroup>
              <thead>
                <tr>
                  <th className="border border-zinc-400 px-1 py-1 font-medium">ลำดับ</th>
                  <th className="border border-zinc-400 px-1 py-1 font-medium">หมายเลขครุภัณฑ์</th>
                  <th className="border border-zinc-400 px-1 py-1 font-medium">รายการครุภัณฑ์</th>
                  <th className="border border-zinc-400 px-1 py-1 font-medium">สถานที่ตั้ง</th>
                  <th className="border border-zinc-400 px-1 py-1 font-medium">ผู้รับผิดชอบครุภัณฑ์</th>
                  <th className="border border-zinc-400 px-1 py-1 font-medium">สถานะการดำเนินการ</th>
                  <th className="border border-zinc-400 px-1 py-1 font-medium">ผลการพิจารณาโดย IT</th>
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
                    <td className="border border-zinc-400 px-1 py-1 align-top">{row.location || "—"}</td>
                    <td className="border border-zinc-400 px-1 py-1 align-top">{row.responsiblePerson || "—"}</td>
                    <td className="border border-zinc-400 px-1 py-1 align-top whitespace-nowrap text-center text-[9px]">
                      ☐ บำรุงรักษา
                    </td>
                    <td className="border border-zinc-400 px-1 py-1 align-top">
                      <div className="flex flex-col gap-0.5 whitespace-nowrap text-[9px]">
                        <span>☐ ปกติ</span>
                        <span>☐ ส่งซ่อม</span>
                        <span>☐ เปลี่ยนอะไหล่</span>
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

          <div className="mt-6">
            <p className="mb-2 text-sm font-semibold">ส่วนที่ 2 ผลการบำรุงรักษา</p>
            <div className="flex flex-col gap-3 text-sm">
              <div className="flex flex-wrap gap-x-8 gap-y-2">
                <span>วันที่ดำเนินการ {displayDate || "............................................."}</span>
                <span>ช่วงเวลา {timeRangeLabel || "....................."}</span>
                <span>ผู้ดำเนินการ .............................................</span>
              </div>
              <div>
                <p>ผลการตรวจเช็ค</p>
                <div className="mt-1 flex flex-col gap-3">
                  <span className="block border-b border-zinc-400">&nbsp;</span>
                  <span className="block border-b border-zinc-400">&nbsp;</span>
                </div>
              </div>
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
              <p>({formSettings.acknowledgerName})</p>
              <p>ตำแหน่ง {formSettings.acknowledgerPosition}</p>
              <p>{formSettings.acknowledgerDepartment}</p>
            </div>
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
