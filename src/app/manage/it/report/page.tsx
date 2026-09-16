import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SESSION_COOKIE, canAccessItDashboard, verifySessionToken } from "@/lib/auth";
import {
  getEquipmentDataUnredacted,
  getMaintenanceTasks,
  getReportSettings,
  DEFAULT_REPORT_SETTINGS,
  type MaintenanceTask,
} from "@/lib/sheets";
import { isDeleted, isDisposed, TITLE_PREFIX_OPTIONS } from "@/lib/fields";
import { rowSnapshotHash } from "@/lib/recordHash";
import MaintenanceReportBuilder, {
  type ReportEquipmentItem,
  type ReportTaskEntry,
  type ReprintTaskInfo,
} from "@/components/MaintenanceReportBuilder";

export const dynamic = "force-dynamic";

/** Best-effort split of a combined "คำนำหน้า+ชื่อ-นามสกุล" string into its
 * two parts, for sheets that only have the one combined column — lets the
 * "แก้ไข ... ก่อนพิมพ์" modal offer the same คำนำหน้า dropdown either way
 * instead of a free-text prefix. TITLE_PREFIX_OPTIONS is already ordered
 * "นางสาว" before "นาง" (a prefix of "นางสาว" as a string), which matters
 * here — matching "นาง" first would wrongly chop "นางสาว...” down to
 * "นาง" + "สาว...". Falls back to no detected prefix (blank คำนำหน้า, the
 * whole string as the name) when nothing matches, e.g. an already-blank
 * cell or a name typed without any prefix at all. */
function splitTitlePrefix(fullName: string): { titlePrefix: string; nameOnly: string } {
  const trimmed = fullName.trim();
  for (const prefix of TITLE_PREFIX_OPTIONS) {
    if (trimmed.startsWith(prefix)) {
      return { titlePrefix: prefix, nameOnly: trimmed.slice(prefix.length).trim() };
    }
  }
  return { titlePrefix: "", nameOnly: trimmed };
}

/**
 * /manage/it/report — the printable "แบบฟอร์มการบำรุงรักษาเชิงป้องกัน..."
 * generator. Same access rule as /manage/it (see canAccessItDashboard): the
 * "it" role and the bootstrap superadmin only. Both a soft-deleted row and
 * an already-disposed one are excluded from the picker — a disposed item
 * never needs another maintenance visit, so per the hospital's explicit
 * request it's dropped from IT's list entirely rather than shown with a
 * "(จำหน่ายแล้ว)" tag as before.
 */
export default async function ManageItReportPage({
  searchParams,
}: {
  /** ?reprintTaskIds=id1,id2,... — set only when reached via the central
   * "พิมพ์ซ้ำ (N)" button on /manage/it/tasks (see MaintenanceTasksBoard's
   * printReprintBatch). Absent on every normal visit to this page. */
  searchParams: Promise<{ reprintTaskIds?: string }>;
}) {
  const { reprintTaskIds: reprintTaskIdsParam } = await searchParams;
  const reprintTaskIdSet = new Set(
    (reprintTaskIdsParam ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
  const cookieStore = await cookies();
  const session = verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) {
    redirect("/login?next=/manage/it/report");
  }
  if (!canAccessItDashboard(session)) {
    redirect("/manage");
  }

  // These three reads are independent of each other — run them together
  // instead of one after another so this page's total wait is however long
  // the slowest of the three takes, not their sum.
  const [equipmentResult, settingsResult, tasksResult] = await Promise.allSettled([
    getEquipmentDataUnredacted(),
    getReportSettings(),
    getMaintenanceTasks(),
  ]);

  let items: ReportEquipmentItem[] = [];
  let loadError: string | null = null;
  if (equipmentResult.status === "fulfilled") {
    const snapshot = equipmentResult.value;
    items = snapshot.rows
      .filter((r) => !isDeleted(r.data, snapshot.fields) && !isDisposed(r.data, snapshot.fields))
      .map((r) => {
        const f = snapshot.fields;
        const brand = f.brand.map((h) => r.data[h]).find((v) => (v ?? "").trim())?.trim() ?? "";
        const model = f.model.map((h) => r.data[h]).find((v) => (v ?? "").trim())?.trim() ?? "";
        const brandModel = brand && model ? `${brand} / ${model}` : brand || model;
        // Either shape (one combined column, or split
        // คำนำหน้า/ชื่อ-นามสกุล columns) ends up as the same titlePrefix +
        // nameOnly pair here, so the "แก้ไข ... ก่อนพิมพ์" modal can offer
        // one consistent คำนำหน้า dropdown + ชื่อ-นามสกุล box regardless of
        // which shape this particular sheet uses — see
        // /api/manage/it/records/[rowNumber] for how each shape gets saved
        // back on its own side.
        let titlePrefix: string;
        let nameOnly: string;
        if (f.fullNameHeader) {
          ({ titlePrefix, nameOnly } = splitTitlePrefix(r.data[f.fullNameHeader] ?? ""));
        } else {
          titlePrefix = f.titlePrefixHeader ? (r.data[f.titlePrefixHeader] ?? "").trim() : "";
          nameOnly = f.nameHeader ? (r.data[f.nameHeader] ?? "").trim() : "";
        }
        const fullName = [titlePrefix, nameOnly].filter(Boolean).join("");
        return {
          rowNumber: r.rowNumber,
          assetNumber: f.assetNumber ? (r.data[f.assetNumber] ?? "").trim() : "",
          equipmentType: f.equipmentType ? (r.data[f.equipmentType] ?? "").trim() : "",
          brandModel,
          department: f.department ? (r.data[f.department] ?? "").trim() : "",
          installLocation: f.installLocation ? (r.data[f.installLocation] ?? "").trim() : "",
          responsiblePerson: fullName,
          titlePrefix,
          nameOnly,
          snapshotHash: rowSnapshotHash(snapshot.headers, r.data),
          // Now savable either way: a combined column gets
          // "titlePrefix nameOnly" written back as one string, a split pair
          // gets each part written to its own column — see
          // /api/manage/it/records/[rowNumber].
          canSaveResponsiblePerson: Boolean(f.fullNameHeader) || Boolean(f.titlePrefixHeader && f.nameHeader),
        };
      });
  } else {
    loadError = equipmentResult.reason instanceof Error ? equipmentResult.reason.message : String(equipmentResult.reason);
  }

  // Falls back to defaults either way — getReportSettings already does
  // this internally for a missing tab, so this only guards an unexpected
  // network/auth failure from also breaking the report page.
  const settings = settingsResult.status === "fulfilled" ? settingsResult.value : DEFAULT_REPORT_SETTINGS;

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
  // One entry per taskId named in reprintTaskIds that still exists — see
  // MaintenanceReportBuilder's ReprintTaskInfo/isReprint for what this
  // drives. Deliberately looked up from the very same getMaintenanceTasks()
  // result as taskHistory just below, rather than a second read.
  let reprintTasks: ReprintTaskInfo[] = [];
  if (tasksResult.status === "fulfilled") {
    const tasks: MaintenanceTask[] = tasksResult.value;
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

    if (reprintTaskIdSet.size > 0) {
      const found = tasks.filter((t) => reprintTaskIdSet.has(t.taskId));
      reprintTasks = found.map((t) => ({
        taskId: t.taskId,
        equipmentRowNumber: t.equipmentRowNumber,
        department: t.department,
        createdAt: t.createdAt,
      }));
      // The equipment picker/print table only ever draws from `items`
      // above, which already excludes disposed/deleted rows — normal for a
      // fresh printout, but a reprint can easily point at equipment that's
      // since been disposed (that's often *why* someone wants a reprint of
      // an old record in the first place). Rather than let the reprint
      // silently come up with nothing to select for that item, splice in a
      // best-effort stand-in row built from the task's own saved fields for
      // any that aren't in `items` anymore.
      const missing = found.filter((t) => !items.some((it) => it.rowNumber === t.equipmentRowNumber));
      if (missing.length > 0) {
        items = [
          ...items,
          ...missing.map((t) => ({
            rowNumber: t.equipmentRowNumber,
            assetNumber: t.assetNumber,
            equipmentType: t.equipmentType,
            brandModel: t.brandModel,
            department: t.department,
            installLocation: t.location,
            responsiblePerson: "",
            titlePrefix: "",
            nameOnly: "",
            snapshotHash: "",
            // No live sheet row backs this stand-in, so there's nothing to
            // save location/responsible-person edits back to.
            canSaveResponsiblePerson: false,
          })),
        ];
      }
    }
  }
  // else: fall through with no badges, and no reprint pre-fill — same
  // tolerance as before (a missing MaintenanceTasks tab, or any other read
  // failure, just means no badges this load, not a broken report page).

  return (
    <MaintenanceReportBuilder
      items={items}
      loadError={loadError}
      settings={settings}
      // displayName comes straight off the session cookie now (looked up
      // once at login — see the SessionPayload comment in lib/auth.ts)
      // instead of a separate getUsers() call on every visit to this page.
      currentUser={{
        username: session.username,
        displayName: session.displayName,
        role: session.role,
        isBootstrap: session.isBootstrap,
        extraPermissions: session.extraPermissions,
        revokedPermissions: session.revokedPermissions,
      }}
      taskHistory={taskHistory}
      reprintTasks={reprintTasks}
    />
  );
}
