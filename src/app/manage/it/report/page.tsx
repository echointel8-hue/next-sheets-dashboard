import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SESSION_COOKIE, canAccessItDashboard, verifySessionToken } from "@/lib/auth";
import {
  getEquipmentDataUnredacted,
  getMaintenanceTasks,
  getReportSettings,
  getUsers,
  DEFAULT_REPORT_SETTINGS,
} from "@/lib/sheets";
import { isDeleted, isDisposed } from "@/lib/fields";
import { rowSnapshotHash } from "@/lib/recordHash";
import MaintenanceReportBuilder, {
  type ReportEquipmentItem,
  type ReportTaskEntry,
} from "@/components/MaintenanceReportBuilder";

export const dynamic = "force-dynamic";

/**
 * /manage/it/report — the printable "แบบฟอร์มการบำรุงรักษาเชิงป้องกัน..."
 * generator. Same access rule as /manage/it (see canAccessItDashboard): the
 * "it" role and the bootstrap superadmin only. Both a soft-deleted row and
 * an already-disposed one are excluded from the picker — a disposed item
 * never needs another maintenance visit, so per the hospital's explicit
 * request it's dropped from IT's list entirely rather than shown with a
 * "(จำหน่ายแล้ว)" tag as before.
 */
export default async function ManageItReportPage() {
  const cookieStore = await cookies();
  const session = verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) {
    redirect("/login?next=/manage/it/report");
  }
  if (!canAccessItDashboard(session)) {
    redirect("/manage");
  }

  let items: ReportEquipmentItem[] = [];
  let loadError: string | null = null;
  try {
    const snapshot = await getEquipmentDataUnredacted();
    items = snapshot.rows
      .filter((r) => !isDeleted(r.data, snapshot.fields) && !isDisposed(r.data, snapshot.fields))
      .map((r) => {
        const f = snapshot.fields;
        const brand = f.brand.map((h) => r.data[h]).find((v) => (v ?? "").trim())?.trim() ?? "";
        const model = f.model.map((h) => r.data[h]).find((v) => (v ?? "").trim())?.trim() ?? "";
        const brandModel = brand && model ? `${brand} / ${model}` : brand || model;
        const fullName = f.fullNameHeader
          ? (r.data[f.fullNameHeader] ?? "").trim()
          : [f.titlePrefixHeader ? r.data[f.titlePrefixHeader] : "", f.nameHeader ? r.data[f.nameHeader] : ""]
              .map((s) => (s ?? "").trim())
              .filter(Boolean)
              .join(" ");
        return {
          rowNumber: r.rowNumber,
          assetNumber: f.assetNumber ? (r.data[f.assetNumber] ?? "").trim() : "",
          equipmentType: f.equipmentType ? (r.data[f.equipmentType] ?? "").trim() : "",
          brandModel,
          department: f.department ? (r.data[f.department] ?? "").trim() : "",
          installLocation: f.installLocation ? (r.data[f.installLocation] ?? "").trim() : "",
          responsiblePerson: fullName,
          snapshotHash: rowSnapshotHash(snapshot.headers, r.data),
          // A split คำนำหน้า/ชื่อ-นามสกุล sheet can't take a single free-text
          // name back (see /api/manage/it/records/[rowNumber]) — tell the
          // client up front so it can hide that save option instead of
          // letting every attempt fail.
          canSaveResponsiblePerson: Boolean(f.fullNameHeader),
        };
      });
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  let settings = DEFAULT_REPORT_SETTINGS;
  try {
    settings = await getReportSettings();
  } catch {
    // Fall back to defaults — getReportSettings already does this
    // internally for a missing tab, so this only guards an unexpected
    // network/auth failure from also breaking the report page.
  }

  // Auto-fills "ผู้ดำเนินการ" on the printed form with a real Thai name
  // instead of a blank line to hand-fill — falls back to the bare login
  // string if the Users tab is unreachable or has no matching row (e.g. the
  // env-configured bootstrap account, which isn't a Users-tab row at all).
  let displayName = session.username;
  try {
    const users = await getUsers();
    displayName = users.find((u) => u.username === session.username)?.displayName || session.username;
  } catch {
    // fall through with the bare username
  }

  // Feeds the "กำลังบำรุงรักษาโดย ..." / "เสร็จสิ้นล่าสุดโดย ..." badges in
  // the equipment picker below. Every task is sent down (not just the
  // latest-per-row summary) so the client can re-derive those badges for
  // whichever ปี the IT account picks in the year filter — supports future
  // years automatically, since a year with no tasks yet just shows no
  // badges rather than needing any code change. Best-effort: a missing
  // MaintenanceTasks tab (getMaintenanceTasks already tolerates that) or any
  // other read failure should just mean no badges this load, not break the
  // whole report page.
  let taskHistory: ReportTaskEntry[] = [];
  try {
    const tasks = await getMaintenanceTasks();
    taskHistory = tasks.map((t) => ({
      equipmentRowNumber: t.equipmentRowNumber,
      status: t.status,
      createdAt: t.createdAt,
      completedAt: t.completedAt,
      displayName: t.assignedToDisplayName || t.assignedToUsername,
      // Filled in through the "อัปเดตสถานะงาน" modal on /manage/it/tasks
      // (see TaskUpdateModal there) — carried down here so the month-strip
      // popup below can show what was actually done, not just who/when.
      actionsTaken: t.actionsTaken,
      inspectionChecks: t.inspectionChecks,
      partsChanged: t.partsChanged,
      otherDetail: t.otherDetail,
    }));
  } catch {
    // Fall through with no badges.
  }

  return (
    <MaintenanceReportBuilder
      items={items}
      loadError={loadError}
      settings={settings}
      currentUser={{ username: session.username, displayName }}
      taskHistory={taskHistory}
    />
  );
}
