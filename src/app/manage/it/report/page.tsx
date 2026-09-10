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
  /** ?reprintTaskId=... — set only when reached via the "พิมพ์ซ้ำ" button
   * on /manage/it/tasks (see MaintenanceTasksBoard). Absent on every normal
   * visit to this page. */
  searchParams: Promise<{ reprintTaskId?: string }>;
}) {
  const { reprintTaskId } = await searchParams;
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
  // Set only when reprintTaskId names a task that still exists — see
  // MaintenanceReportBuilder's ReprintTaskInfo/isReprint for what this
  // drives. Deliberately looked up from the very same getMaintenanceTasks()
  // call as taskHistory just below, rather than a second read.
  let reprintTask: ReprintTaskInfo | null = null;
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

    if (reprintTaskId) {
      const found = tasks.find((t) => t.taskId === reprintTaskId);
      if (found) {
        reprintTask = {
          taskId: found.taskId,
          equipmentRowNumber: found.equipmentRowNumber,
          department: found.department,
          createdAt: found.createdAt,
        };
        // The equipment picker/print table only ever draws from `items`
        // above, which already excludes disposed/deleted rows — normal for
        // a fresh printout, but a reprint can easily point at equipment
        // that's since been disposed (that's often *why* someone wants a
        // reprint of an old record in the first place). Rather than let the
        // reprint silently come up with nothing to select, splice in a
        // best-effort stand-in row built from the task's own saved fields
        // when the real one isn't in `items` anymore.
        if (!items.some((it) => it.rowNumber === found.equipmentRowNumber)) {
          items = [
            ...items,
            {
              rowNumber: found.equipmentRowNumber,
              assetNumber: found.assetNumber,
              equipmentType: found.equipmentType,
              brandModel: found.brandModel,
              department: found.department,
              installLocation: found.location,
              responsiblePerson: "",
              titlePrefix: "",
              nameOnly: "",
              snapshotHash: "",
              // No live sheet row backs this stand-in, so there's nothing
              // to save location/responsible-person edits back to.
              canSaveResponsiblePerson: false,
            },
          ];
        }
      }
    }
  } catch {
    // Fall through with no badges, and no reprint pre-fill.
  }

  return (
    <MaintenanceReportBuilder
      items={items}
      loadError={loadError}
      settings={settings}
      currentUser={{ username: session.username, displayName, isBootstrap: session.isBootstrap }}
      taskHistory={taskHistory}
      reprintTask={reprintTask}
    />
  );
}
