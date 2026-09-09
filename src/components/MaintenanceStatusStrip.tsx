"use client";

// Compact, VIEW-ONLY maintenance-status strip — the same 12-month
// color-coded idea as the interactive one on /manage/it/report
// (MaintenanceReportBuilder), but stripped down for embedding inside the
// general /manage/it spec tables: no month/year filters, no checkbox
// selection, no "เลือกรายการที่จะดำเนินการ" toggle — just the 12 ticks for
// the current ปี plus a click-to-open detail popup, so IT staff can see a
// machine's maintenance history at a glance from the main dashboard without
// jumping to the report page. Deliberately a separate component rather than
// a shared one with MaintenanceReportBuilder's own strip: that one has
// already been hardened through a real crash (see its comments on the
// hover-tooltip bug) and carries filter-dependent state this read-only
// context doesn't have — duplicating the small, now-stable rendering logic
// here is safer than re-touching that code path.

import { useMemo, useState, type CSSProperties } from "react";
import { CheckCircle2, Wrench, X } from "lucide-react";
import { actionColorVars, buildActionColorMap, colorForAction, type ActionColor } from "@/lib/actionColors";
import type { InspectionCheck, MaintenanceTaskStatus } from "@/lib/sheets";

const THAI_MONTHS_SHORT = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];
const THAI_MONTHS_FULL = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

export interface StripTask {
  status: MaintenanceTaskStatus;
  createdAt: string;
  completedAt: string;
  displayName: string;
  actionsTaken: string[];
  inspectionChecks: InspectionCheck[];
  partsChanged: string;
  otherDetail: string;
}

function actionColorStyle(color: ActionColor) {
  return actionColorVars(color) as CSSProperties;
}

function formatThaiDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getDate()} ${THAI_MONTHS_SHORT[d.getMonth()] ?? ""} ${d.getFullYear() + 543}`;
}

/** Joins inspectionChecks into one readable line, same convention as the
 * report page's formatInspectionResult — appends the matching free-text
 * blank in parens where one was filled in. */
function formatInspectionResult(t: StripTask): string {
  return t.inspectionChecks
    .map((check) => {
      if (check === "เปลี่ยนอะไหล่" && t.partsChanged.trim()) return `${check} (${t.partsChanged.trim()})`;
      if (check === "อื่นๆ" && t.otherDetail.trim()) return `${check} (${t.otherDetail.trim()})`;
      return check;
    })
    .join(", ");
}

/**
 * `tasks` should already be scoped to one piece of equipment (the caller
 * filters MaintenanceTask[] by equipmentRowNumber) — this component only
 * further restricts by `year` (พ.ศ., as a string) internally, same
 * "scoped by ปี only, never by a narrower period" rule as the report page's
 * month-strip, so every month in that year stays browsable regardless of
 * whatever else might be filtered elsewhere on the page.
 */
export default function MaintenanceStatusStrip({
  tasks,
  actionOptions,
  year,
  assetLabel,
}: {
  tasks: StripTask[];
  actionOptions: string[];
  year: string;
  /** Shown in the popup header for context (e.g. the asset number). */
  assetLabel?: string;
}) {
  const actionColorMap = useMemo(() => buildActionColorMap(actionOptions), [actionOptions]);
  const [openMonth, setOpenMonth] = useState<number | null>(null);

  // Buckets by the task's *effective* เดือน, not เดือนที่เปิดเคส (createdAt):
  // a "done" task anchors permanently to the เดือน it actually finished in
  // (completedAt) — that never moves again once set. A still-open task
  // instead rolls forward to the current real-world เดือน every time this
  // renders, for as long as it stays open — opened in ส.ค., still open when
  // ก.ย. arrives, the amber tick "moves" to ก.ย. (ส.ค. is now considered a
  // month it was NOT finished in), and keeps moving forward like that until
  // it's finally marked done. Matches MaintenanceReportBuilder's own
  // (deliberately duplicated, not shared) month-strip bucketing.
  const monthlyTasks = useMemo(() => {
    const buckets: StripTask[][] = Array.from({ length: 12 }, () => []);
    const nowIso = new Date().toISOString();
    for (const t of tasks) {
      const effectiveIso = t.status === "done" ? t.completedAt || t.createdAt : nowIso;
      const d = new Date(effectiveIso);
      if (String(d.getFullYear() + 543) !== year) continue;
      const m = d.getMonth();
      if (!Number.isNaN(m)) buckets[m].push(t);
    }
    return buckets;
  }, [tasks, year]);

  const hasAnyThisYear = monthlyTasks.some((m) => m.length > 0);

  // "ปัจจุบัน" ring highlight — no month/year filter exists on this read-only
  // component (unlike the report page's isFilteredMonth), so "current" here
  // just means today's real-world เดือน/ปี.
  const now = new Date();
  const currentMonthIdx = now.getMonth();
  const currentYearBE = String(now.getFullYear() + 543);

  return (
    <div className="flex flex-col gap-0.5">
      <div
        className="flex flex-nowrap items-start gap-[3px]"
        role="group"
        aria-label={`สถานะบำรุงรักษาในปี ${year}${assetLabel ? ` — ${assetLabel}` : ""}`}
      >
        {THAI_MONTHS_SHORT.map((label, monthIdx) => {
          const monthTasks = monthlyTasks[monthIdx];
          const hasInProgress = monthTasks.some((t) => t.status === "in_progress");
          const isEmpty = monthTasks.length === 0;
          const allActions = hasInProgress
            ? []
            : monthTasks.flatMap((t) => t.actionsTaken.map((a) => a.trim()).filter(Boolean));
          const shortLabel = label.replace(/\./g, "");
          const isCurrentMonth = monthIdx === currentMonthIdx && year === currentYearBE;
          return (
            <div key={monthIdx} className="flex shrink-0 flex-col items-center gap-0.5">
              <button
                type="button"
                onClick={() => setOpenMonth(monthIdx)}
                title={`${label}: บำรุงรักษา ${monthTasks.length.toLocaleString("th-TH")} ครั้ง${
                  allActions.length > 0 ? ` — ${allActions.join(", ")}` : ""
                } — คลิกเพื่อดูรายละเอียด`}
                aria-label={`${label}: บำรุงรักษา ${monthTasks.length.toLocaleString("th-TH")} ครั้ง — คลิกเพื่อดูรายละเอียด`}
                className={`flex h-7 w-3.5 shrink-0 flex-col overflow-hidden rounded-[2px] transition-opacity hover:opacity-80 ${
                  isCurrentMonth
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
                        style={actionColorStyle(colorForAction(actionColorMap, name))}
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
      {!hasAnyThisYear && (
        <span className="whitespace-nowrap text-[9px] text-zinc-300 dark:text-zinc-600">ยังไม่มีข้อมูลปีนี้</span>
      )}

      {/* Inline "X ครั้ง (เดือนย่อ)" + action-chip legend for the current
          เดือน — mirrors the report page's own legend under its strip (see
          MaintenanceReportBuilder's filteredMonthTasks block), so the action(s)
          taken are visible without clicking into the popup. Scoped to today's
          real เดือน/ปี since this read-only component has no month filter of
          its own (unlike the report page's maintenanceMonthFilter). */}
      {year === currentYearBE &&
        monthlyTasks[currentMonthIdx].length > 0 &&
        (() => {
          const currentMonthTasks = monthlyTasks[currentMonthIdx];
          const names = [
            ...new Set(
              currentMonthTasks.flatMap((t) => t.actionsTaken.map((a) => a.trim()).filter(Boolean))
            ),
          ];
          return (
            <>
              <p className="text-[9px] text-zinc-400 dark:text-zinc-500">
                {currentMonthTasks.length.toLocaleString("th-TH")} ครั้ง ({THAI_MONTHS_SHORT[currentMonthIdx]})
              </p>
              {names.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  {names.map((name) => (
                    <span
                      key={name}
                      className="inline-flex items-center gap-1 text-[9px] text-zinc-500 dark:text-zinc-400"
                    >
                      <span
                        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--seg-c)] dark:bg-[var(--seg-c-dark)]"
                        style={actionColorStyle(colorForAction(actionColorMap, name))}
                        aria-hidden="true"
                      />
                      {name}
                    </span>
                  ))}
                </div>
              )}
            </>
          );
        })()}

      {openMonth !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpenMonth(null)}
          role="presentation"
        >
          <div
            className="flex max-h-[70vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-emerald-900/10 bg-white shadow-sm dark:border-emerald-400/10 dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-emerald-900/10 px-4 py-3 dark:border-emerald-400/10">
              <div>
                <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                  {THAI_MONTHS_FULL[openMonth]} {year}
                </p>
                {assetLabel && <p className="text-xs text-zinc-400 dark:text-zinc-500">{assetLabel}</p>}
              </div>
              <button
                type="button"
                onClick={() => setOpenMonth(null)}
                className="rounded-full p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
                aria-label="ปิด"
              >
                <X size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-4 text-sm">
              {monthlyTasks[openMonth].length === 0 ? (
                <p className="text-zinc-400">ไม่มีการบำรุงรักษาในเดือนนี้</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {monthlyTasks[openMonth].map((t, i) => (
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
                                    style={actionColorStyle(colorForAction(actionColorMap, name))}
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
    </div>
  );
}
