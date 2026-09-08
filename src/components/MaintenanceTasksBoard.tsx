"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ClipboardList,
  Loader2,
  Save,
  Trash2,
  Users,
  Wrench,
  X,
} from "lucide-react";
import type { InspectionCheck, MaintenanceTask, MaintenanceTaskStatus } from "@/lib/sheets";
import MultiSelect from "@/components/MultiSelect";

const CARD = "rounded-2xl border border-emerald-900/10 bg-white shadow-sm dark:border-emerald-400/10 dark:bg-zinc-900";
const INPUT_CLASS =
  "h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100";
const CHECKBOX_CLASS = "h-4 w-4 shrink-0 rounded border-zinc-300 text-[var(--brand)] dark:border-zinc-600";

const THAI_MONTHS_SHORT = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

const THAI_MONTHS_FULL = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

/** ISO timestamp -> { year: พ.ศ. (as string), month: "1".."12" } for the
 * ปี/เดือน period filter below — null when the timestamp doesn't parse
 * (never happens for a machine-generated createdAt, but guards anyway). */
function buddhistYearMonth(iso: string): { year: string; month: string } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return { year: String(d.getFullYear() + 543), month: String(d.getMonth() + 1) };
}

/** ISO timestamp -> "8 ก.ย. 2569 14:15" (Buddhist calendar, matching every
 * other Thai date on this site). Falls back to the raw string for anything
 * that doesn't parse, rather than showing "Invalid Date". */
function formatThaiDateTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.getDate();
  const month = THAI_MONTHS_SHORT[d.getMonth()] ?? "";
  const year = d.getFullYear() + 543;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${month} ${year} ${hh}:${mm}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function MaintenanceTasksBoard({
  session,
  initialTasks,
  loadError,
  actionOptions,
}: {
  session: { username: string; displayName: string; isBootstrap: boolean };
  initialTasks: MaintenanceTask[];
  loadError: string | null;
  actionOptions: string[];
}) {
  const [tasks, setTasks] = useState(initialTasks);
  const [statusFilter, setStatusFilter] = useState<"all" | MaintenanceTaskStatus>("in_progress");
  const [assigneeFilter, setAssigneeFilter] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [monthFilter, setMonthFilter] = useState(""); // "" = ทุกเดือน, else "1".."12"
  const [yearFilter, setYearFilter] = useState(""); // "" = ทุกปี, else พ.ศ. as string
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [fetchError] = useState<string | null>(loadError);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Every task's created-on (พ.ศ.) year, newest first — lets the ปี dropdown
  // only ever offer years that actually have data, plus the current year so
  // it's always selectable even before any task has been created in it.
  const yearOptions = useMemo(() => {
    const set = new Set<string>([String(new Date().getFullYear() + 543)]);
    for (const t of tasks) {
      const ym = buddhistYearMonth(t.createdAt);
      if (ym) set.add(ym.year);
    }
    return [...set].sort((a, b) => Number(b) - Number(a));
  }, [tasks]);

  // ช่วงเวลา (ปี/เดือน) filter — applied on "เริ่มเมื่อ" (createdAt), before
  // every other filter below, so the stat tiles / per-staff summary / table
  // all reflect the same selected period, not just the visible table rows.
  const periodFilteredTasks = useMemo(() => {
    if (!monthFilter && !yearFilter) return tasks;
    return tasks.filter((t) => {
      const ym = buddhistYearMonth(t.createdAt);
      if (!ym) return false;
      if (yearFilter && ym.year !== yearFilter) return false;
      if (monthFilter && ym.month !== monthFilter) return false;
      return true;
    });
  }, [tasks, monthFilter, yearFilter]);

  const assigneeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of periodFilteredTasks) if (t.assignedToDisplayName || t.assignedToUsername) set.add(t.assignedToDisplayName || t.assignedToUsername);
    return [...set].sort((a, b) => a.localeCompare(b, "th")).map((value) => ({ value }));
  }, [periodFilteredTasks]);

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return periodFilteredTasks
      .filter((t) => statusFilter === "all" || t.status === statusFilter)
      .filter((t) => {
        if (assigneeFilter.length === 0) return true;
        const name = t.assignedToDisplayName || t.assignedToUsername;
        return assigneeFilter.includes(name);
      })
      .filter((t) => {
        if (!q) return true;
        const hay = `${t.assetNumber} ${t.equipmentType} ${t.brandModel} ${t.location} ${t.department}`.toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  }, [periodFilteredTasks, statusFilter, assigneeFilter, search]);

  // The stat tiles + per-staff breakdown are the "หัวหน้าติดตามงาน" part of
  // this page — every IT-dashboard account (this hospital's whole IT team,
  // per canAccessItDashboard) sees the same view, so whoever leads the team
  // doesn't need a separate elevated role to check on everyone's progress.
  // All computed from periodFilteredTasks, so picking a ปี/เดือน here also
  // narrows these down to that period, not just the table below.
  const stats = useMemo(() => {
    const inProgress = periodFilteredTasks.filter((t) => t.status === "in_progress").length;
    const done = periodFilteredTasks.filter((t) => t.status === "done").length;
    const today = todayIso();
    const doneToday = periodFilteredTasks.filter((t) => t.status === "done" && t.completedAt.slice(0, 10) === today).length;
    const byAssignee = new Map<string, { inProgress: number; done: number }>();
    for (const t of periodFilteredTasks) {
      const name = t.assignedToDisplayName || t.assignedToUsername || "ไม่ระบุ";
      const entry = byAssignee.get(name) ?? { inProgress: 0, done: 0 };
      if (t.status === "in_progress") entry.inProgress += 1;
      else entry.done += 1;
      byAssignee.set(name, entry);
    }
    return {
      total: periodFilteredTasks.length,
      inProgress,
      done,
      doneToday,
      byAssignee: [...byAssignee.entries()].sort((a, b) => a[0].localeCompare(b[0], "th")),
    };
  }, [periodFilteredTasks]);

  const activeTask = tasks.find((t) => t.taskId === activeTaskId) ?? null;

  async function patchTask(taskId: string, updates: Record<string, unknown>): Promise<MaintenanceTask> {
    const res = await fetch(`/api/manage/it/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "บันทึกไม่สำเร็จ");
    setTasks((prev) => prev.map((t) => (t.taskId === taskId ? (json.task as MaintenanceTask) : t)));
    return json.task as MaintenanceTask;
  }

  /** Deletes a mistakenly-created task outright (wrong equipment selected,
   * duplicate print) — not the normal "close this task" flow, which is the
   * "เสร็จสิ้น" button inside the update modal instead. A "done" task is
   * kept as a completed record and can never be deleted this way — the
   * delete button is already disabled for it, but this guard covers any
   * other caller too (the API/lib layer enforces it again server-side). */
  async function deleteTask(task: MaintenanceTask) {
    if (task.status === "done") return;
    const label = [task.assetNumber, task.equipmentType].filter(Boolean).join(" — ") || "งานนี้";
    const confirmed = window.confirm(`ยืนยันลบรายการ "${label}" ใช่หรือไม่?\n\nรายการนี้จะหายไปจากตารางทันทีและกู้คืนไม่ได้`);
    if (!confirmed) return;

    setDeleteError(null);
    setDeletingTaskId(task.taskId);
    try {
      const res = await fetch(`/api/manage/it/tasks/${task.taskId}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setDeleteError(json.error ?? "ลบรายการไม่สำเร็จ");
        return;
      }
      setTasks((prev) => prev.filter((t) => t.taskId !== task.taskId));
      if (activeTaskId === task.taskId) setActiveTaskId(null);
    } catch {
      setDeleteError("ลบรายการไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setDeletingTaskId(null);
    }
  }

  return (
    <main className="flex w-full flex-1 justify-center bg-[var(--page-bg)] px-4 py-8 sm:px-6 lg:px-10">
      <div className="flex w-full max-w-[75rem] flex-col gap-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-zinc-950 dark:text-zinc-50 sm:text-2xl">งานบำรุงรักษา (Task)</h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{session.displayName || session.username}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/manage/it"
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <ArrowLeft size={16} strokeWidth={2} aria-hidden="true" />
              กลับไปแดชบอร์ด IT
            </Link>
          </div>
        </header>

        {fetchError && (
          <div
            role="alert"
            className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
          >
            {fetchError}
          </div>
        )}

        {deleteError && (
          <div
            role="alert"
            className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
          >
            {deleteError}
          </div>
        )}

        {/* Stat tiles — the at-a-glance dashboard part of this page. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className={`${CARD} flex flex-col gap-1 p-4`}>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">งานทั้งหมด</span>
            <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{stats.total.toLocaleString("th-TH")}</span>
          </div>
          <div className={`${CARD} flex flex-col gap-1 p-4`}>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">กำลังดำเนินการ</span>
            <span className="text-2xl font-bold text-amber-600 dark:text-amber-400">{stats.inProgress.toLocaleString("th-TH")}</span>
          </div>
          <div className={`${CARD} flex flex-col gap-1 p-4`}>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">เสร็จสิ้นแล้ว</span>
            <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{stats.done.toLocaleString("th-TH")}</span>
          </div>
          <div className={`${CARD} flex flex-col gap-1 p-4`}>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">เสร็จวันนี้</span>
            <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{stats.doneToday.toLocaleString("th-TH")}</span>
          </div>
        </div>

        {stats.byAssignee.length > 0 && (
          <div className={`${CARD} flex flex-col gap-3 p-4`}>
            <p className="flex items-center gap-1.5 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              <Users size={15} strokeWidth={2} aria-hidden="true" />
              สรุปงานตามผู้ดำเนินการ
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {stats.byAssignee.map(([name, counts]) => (
                <div
                  key={name}
                  className="flex items-center justify-between gap-2 rounded-lg border border-zinc-100 px-3 py-2 text-sm dark:border-zinc-800"
                >
                  <span className="truncate text-zinc-700 dark:text-zinc-200">{name}</span>
                  <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
                    กำลังทำ {counts.inProgress.toLocaleString("th-TH")} · เสร็จแล้ว {counts.done.toLocaleString("th-TH")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className={`${CARD} flex flex-col gap-3 p-4`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="flex flex-col gap-1 text-sm text-zinc-500 dark:text-zinc-400">
              สถานะ
              <div role="group" aria-label="กรองตามสถานะ" className="inline-flex w-fit items-center rounded-full border border-zinc-200 p-0.5 dark:border-zinc-700">
                {(
                  [
                    { value: "in_progress" as const, label: "กำลังดำเนินการ" },
                    { value: "done" as const, label: "เสร็จสิ้น" },
                    { value: "all" as const, label: "ทั้งหมด" },
                  ]
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setStatusFilter(opt.value)}
                    aria-pressed={statusFilter === opt.value}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                      statusFilter === opt.value
                        ? "bg-[var(--brand)] text-[var(--brand-contrast)]"
                        : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1 text-sm text-zinc-500 dark:text-zinc-400">
              ช่วงเวลา
              <div className="flex items-center gap-2">
                <select
                  value={monthFilter}
                  onChange={(e) => setMonthFilter(e.target.value)}
                  aria-label="กรองตามเดือน"
                  className={`${INPUT_CLASS} pr-1`}
                >
                  <option value="">ทุกเดือน</option>
                  {THAI_MONTHS_FULL.map((label, i) => (
                    <option key={label} value={String(i + 1)}>
                      {label}
                    </option>
                  ))}
                </select>
                <select
                  value={yearFilter}
                  onChange={(e) => setYearFilter(e.target.value)}
                  aria-label="กรองตามปี"
                  className={`${INPUT_CLASS} pr-1`}
                >
                  <option value="">ทุกปี</option>
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
                {(monthFilter || yearFilter) && (
                  <button
                    type="button"
                    onClick={() => {
                      setMonthFilter("");
                      setYearFilter("");
                    }}
                    aria-label="ล้างตัวกรองช่วงเวลา"
                    title="ล้างตัวกรองช่วงเวลา"
                    className="rounded-full p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
                  >
                    <X size={14} strokeWidth={2} aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
            <MultiSelect
              label="กรองตามผู้ดำเนินการ"
              options={assigneeOptions}
              selected={assigneeFilter}
              onChange={setAssigneeFilter}
              className="sm:max-w-xs sm:flex-1"
            />
            <label className="flex flex-col gap-1 text-sm text-zinc-500 dark:text-zinc-400 sm:max-w-xs sm:flex-1">
              ค้นหา
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="เลขครุภัณฑ์ / ประเภท / สถานที่"
                className={INPUT_CLASS}
              />
            </label>
          </div>

          <div className="overflow-x-auto rounded-lg border border-zinc-100 dark:border-zinc-800">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-800/60">
                <tr className="border-b border-zinc-100 text-[10px] uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
                  <th scope="col" className="px-3 py-2 font-medium">ครุภัณฑ์</th>
                  <th scope="col" className="px-3 py-2 font-medium">สถานที่ / กลุ่มงาน</th>
                  <th scope="col" className="px-3 py-2 font-medium">ผู้ดำเนินการ</th>
                  <th scope="col" className="px-3 py-2 font-medium">เริ่มเมื่อ</th>
                  <th scope="col" className="px-3 py-2 font-medium">สถานะ</th>
                  <th scope="col" className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {filteredTasks.map((t) => (
                  <tr key={t.taskId} className="border-b border-zinc-50 last:border-0 dark:border-zinc-800/60">
                    <td className="px-3 py-2 align-top text-zinc-700 dark:text-zinc-300">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">{t.assetNumber || "—"}</div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">
                        {[t.equipmentType, t.brandModel].filter(Boolean).join(" — ") || "—"}
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top text-zinc-700 dark:text-zinc-300">
                      <div>{t.location || "—"}</div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">{t.department}</div>
                    </td>
                    <td className="px-3 py-2 align-top text-zinc-700 dark:text-zinc-300">
                      {t.assignedToDisplayName || t.assignedToUsername || "—"}
                    </td>
                    <td className="px-3 py-2 align-top whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-400">
                      {formatThaiDateTime(t.createdAt)}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {t.status === "in_progress" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                          กำลังดำเนินการ
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                          <CheckCircle2 size={12} strokeWidth={2} aria-hidden="true" />
                          เสร็จสิ้น
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setActiveTaskId(t.taskId)}
                          className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        >
                          <Wrench size={13} strokeWidth={2} aria-hidden="true" />
                          {t.status === "in_progress" ? "อัปเดตสถานะ" : "ดูรายละเอียด"}
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteTask(t)}
                          disabled={t.status === "done" || deletingTaskId === t.taskId}
                          title={t.status === "done" ? "งานที่เสร็จสิ้นแล้วไม่สามารถลบได้" : "ลบรายการนี้"}
                          aria-label={t.status === "done" ? "งานที่เสร็จสิ้นแล้วไม่สามารถลบได้" : "ลบรายการนี้"}
                          className="inline-flex items-center justify-center rounded-full border border-zinc-200 p-1.5 text-zinc-400 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-zinc-200 disabled:hover:bg-transparent disabled:hover:text-zinc-400 dark:border-zinc-700 dark:hover:border-red-900/50 dark:hover:bg-red-950/40 dark:hover:text-red-400 dark:disabled:hover:border-zinc-700 dark:disabled:hover:bg-transparent dark:disabled:hover:text-zinc-400"
                        >
                          {deletingTaskId === t.taskId ? (
                            <Loader2 size={13} strokeWidth={2} className="animate-spin" aria-hidden="true" />
                          ) : (
                            <Trash2 size={13} strokeWidth={2} aria-hidden="true" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredTasks.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-zinc-400">
                      <ClipboardList size={20} strokeWidth={1.5} className="mx-auto mb-1" aria-hidden="true" />
                      ไม่พบงานที่ตรงกับตัวกรอง
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {activeTask && (
        <TaskUpdateModal
          task={activeTask}
          actionOptions={actionOptions}
          onClose={() => setActiveTaskId(null)}
          onPatch={(updates) => patchTask(activeTask.taskId, updates)}
        />
      )}
    </main>
  );
}

function TaskUpdateModal({
  task,
  actionOptions,
  onClose,
  onPatch,
}: {
  task: MaintenanceTask;
  actionOptions: string[];
  onClose: () => void;
  onPatch: (updates: Record<string, unknown>) => Promise<MaintenanceTask>;
}) {
  const readOnly = task.status === "done";
  const [actionsTaken, setActionsTaken] = useState<string[]>(task.actionsTaken);
  const [inspectionChecks, setInspectionChecks] = useState<InspectionCheck[]>(task.inspectionChecks);
  const [partsChanged, setPartsChanged] = useState(task.partsChanged);
  const [otherDetail, setOtherDetail] = useState(task.otherDetail);
  const [notes, setNotes] = useState(task.notes);
  const [saving, setSaving] = useState<"draft" | "done" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggleAction(v: string) {
    setActionsTaken((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  }
  function toggleCheck(v: InspectionCheck) {
    setInspectionChecks((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  }

  async function save(markDone: boolean) {
    setSaving(markDone ? "done" : "draft");
    setError(null);
    try {
      await onPatch({
        actionsTaken,
        inspectionChecks,
        partsChanged,
        otherDetail,
        notes,
        ...(markDone ? { status: "done" } : {}),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className={`${CARD} flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-emerald-900/10 px-4 py-3 dark:border-emerald-400/10">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            <Wrench size={15} strokeWidth={2} aria-hidden="true" />
            {readOnly ? "รายละเอียดงาน" : "อัปเดตสถานะงาน"}
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

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
          <div className="rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-700">
            <p className="font-medium text-zinc-800 dark:text-zinc-100">
              {task.assetNumber || "—"} · {task.equipmentType || "—"}
            </p>
            {task.brandModel && <p className="text-zinc-500 dark:text-zinc-400">{task.brandModel}</p>}
            <p className="mt-1 text-zinc-500 dark:text-zinc-400">
              {task.department}
              {task.location && ` · ${task.location}`}
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              มอบหมายให้ {task.assignedToDisplayName || task.assignedToUsername} · เริ่ม {formatThaiDateTime(task.createdAt)}
              {task.status === "done" && ` · เสร็จสิ้น ${formatThaiDateTime(task.completedAt)}`}
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
            >
              {error}
            </div>
          )}

          <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
            <p className="text-sm font-bold text-zinc-800 dark:text-zinc-100">การดำเนินการ</p>
            {actionOptions.length === 0 && <p className="text-sm text-zinc-400">ยังไม่มีรายการ — ตั้งค่าได้ที่หน้าออกรายงาน</p>}
            <div className="flex flex-col gap-1.5">
              {actionOptions.map((opt) => (
                <label
                  key={opt}
                  className={`flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200 ${readOnly ? "" : "cursor-pointer"}`}
                >
                  <input
                    type="checkbox"
                    checked={actionsTaken.includes(opt)}
                    onChange={() => toggleAction(opt)}
                    disabled={readOnly}
                    className={CHECKBOX_CLASS}
                  />
                  {opt}
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
            <p className="text-sm font-bold text-zinc-800 dark:text-zinc-100">ผลการตรวจสอบโดย IT</p>
            <div className="flex flex-col gap-2">
              <label className={`flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200 ${readOnly ? "" : "cursor-pointer"}`}>
                <input
                  type="checkbox"
                  checked={inspectionChecks.includes("ปกติ")}
                  onChange={() => toggleCheck("ปกติ")}
                  disabled={readOnly}
                  className={CHECKBOX_CLASS}
                />
                ปกติ
              </label>
              <label className={`flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200 ${readOnly ? "" : "cursor-pointer"}`}>
                <input
                  type="checkbox"
                  checked={inspectionChecks.includes("ส่งซ่อม")}
                  onChange={() => toggleCheck("ส่งซ่อม")}
                  disabled={readOnly}
                  className={CHECKBOX_CLASS}
                />
                ส่งซ่อม
              </label>
              <div className="flex items-center gap-2">
                <label className={`flex shrink-0 items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200 ${readOnly ? "" : "cursor-pointer"}`}>
                  <input
                    type="checkbox"
                    checked={inspectionChecks.includes("เปลี่ยนอะไหล่")}
                    onChange={() => toggleCheck("เปลี่ยนอะไหล่")}
                    disabled={readOnly}
                    className={CHECKBOX_CLASS}
                  />
                  เปลี่ยนอะไหล่
                </label>
                <input
                  type="text"
                  value={partsChanged}
                  onChange={(e) => setPartsChanged(e.target.value)}
                  disabled={readOnly}
                  placeholder="ระบุอะไหล่ที่เปลี่ยน"
                  className={`${INPUT_CLASS} flex-1 disabled:bg-zinc-50 disabled:text-zinc-500 dark:disabled:bg-zinc-800/60`}
                />
              </div>
              <div className="flex items-center gap-2">
                <label className={`flex shrink-0 items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200 ${readOnly ? "" : "cursor-pointer"}`}>
                  <input
                    type="checkbox"
                    checked={inspectionChecks.includes("อื่นๆ")}
                    onChange={() => toggleCheck("อื่นๆ")}
                    disabled={readOnly}
                    className={CHECKBOX_CLASS}
                  />
                  อื่นๆ ระบุ
                </label>
                <input
                  type="text"
                  value={otherDetail}
                  onChange={(e) => setOtherDetail(e.target.value)}
                  disabled={readOnly}
                  placeholder="ระบุรายละเอียด"
                  className={`${INPUT_CLASS} flex-1 disabled:bg-zinc-50 disabled:text-zinc-500 dark:disabled:bg-zinc-800/60`}
                />
              </div>
            </div>
          </div>

          <label className="flex flex-col gap-1 text-sm text-zinc-500 dark:text-zinc-400">
            หมายเหตุเพิ่มเติม
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={readOnly}
              rows={3}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 disabled:bg-zinc-50 disabled:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:disabled:bg-zinc-800/60"
            />
          </label>
        </div>

        {!readOnly && (
          <div className="flex flex-wrap items-center gap-3 border-t border-emerald-900/10 px-4 py-3 dark:border-emerald-400/10">
            <button
              type="button"
              onClick={() => save(false)}
              disabled={saving !== null}
              className="inline-flex items-center gap-2 rounded-full border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {saving === "draft" ? (
                <Loader2 size={16} strokeWidth={2} className="animate-spin" aria-hidden="true" />
              ) : (
                <Save size={16} strokeWidth={2} aria-hidden="true" />
              )}
              บันทึก
            </button>
            <button
              type="button"
              onClick={() => save(true)}
              disabled={saving !== null}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--brand)] px-5 py-2.5 text-sm font-semibold text-[var(--brand-contrast)] shadow-sm transition-colors hover:bg-[var(--brand-strong)] disabled:opacity-60"
            >
              {saving === "done" ? (
                <Loader2 size={16} strokeWidth={2} className="animate-spin" aria-hidden="true" />
              ) : (
                <Check size={16} strokeWidth={2} aria-hidden="true" />
              )}
              เสร็จสิ้น
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
