import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SESSION_COOKIE, canAccessItDashboard, verifySessionToken } from "@/lib/auth";
import {
  getEquipmentDataUnredacted,
  getMaintenanceLog,
  getMaintenanceTasks,
  getReportSettings,
  getSpecStandards,
  type MaintenanceLogEntry,
  type MaintenanceTask,
  type SpecStandards,
} from "@/lib/sheets";
import { isDeleted } from "@/lib/fields";
import { rowSnapshotHash } from "@/lib/recordHash";
import ITDashboard, { type ITDashboardData } from "@/components/ITDashboard";

export const dynamic = "force-dynamic";

/**
 * /manage/it — the technical dashboard (spec tables split PC vs printer)
 * and printable maintenance-report generator. Read-only: reachable by the
 * "it" role and the single bootstrap superadmin account only, per the
 * hospital's request — see canAccessItDashboard(). A regular superadmin
 * account (created later through /manage/users) is redirected to the
 * general /manage table instead, same as admin.
 */
export default async function ManageItPage() {
  const cookieStore = await cookies();
  const session = verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) {
    redirect("/login?next=/manage/it");
  }
  if (!canAccessItDashboard(session)) {
    redirect("/manage");
  }

  // Five independent reads — none of them depend on another's result, so
  // run them all together instead of one after another. This page used to
  // await each in turn (5 separate round trips to Google Sheets back to
  // back); now its total wait is however long the single slowest one
  // takes, which is what actually made /manage/it feel slow to load.
  const [equipmentResult, logResult, specResult, tasksResult, settingsResult] = await Promise.allSettled([
    getEquipmentDataUnredacted(),
    getMaintenanceLog(),
    getSpecStandards(),
    getMaintenanceTasks(),
    getReportSettings(),
  ]);

  let initial: ITDashboardData | { error: string };
  if (equipmentResult.status === "fulfilled") {
    const snapshot = equipmentResult.value;
    // Deleted rows never reach any /manage view, IT included — same rule
    // as /api/manage/records and the general /manage table.
    const notDeleted = snapshot.rows.filter((r) => !isDeleted(r.data, snapshot.fields));
    initial = {
      headers: snapshot.headers,
      fields: snapshot.fields,
      rows: notDeleted.map((r) => ({
        rowNumber: r.rowNumber,
        values: r.data,
        snapshotHash: rowSnapshotHash(snapshot.headers, r.data),
      })),
    };
  } else {
    initial = { error: equipmentResult.reason instanceof Error ? equipmentResult.reason.message : String(equipmentResult.reason) };
  }

  // Report-template text (org name/form title/acknowledger) is fetched by
  // /manage/it/report itself now, not here — see that page. Both of these
  // tolerate a missing sheet tab on their own (empty history / default
  // thresholds); falling back to an empty/null value here only covers an
  // unexpected network/auth failure from also breaking the rest of this
  // page.
  const maintenanceLog: MaintenanceLogEntry[] = logResult.status === "fulfilled" ? logResult.value : [];
  const specStandards: SpecStandards | null = specResult.status === "fulfilled" ? specResult.value : null;

  // Feeds the new "แดชบอร์ดงานบำรุงรักษา" summary (per-IT-account totals)
  // and the read-only status strip embedded in each spec table's
  // เลขครุภัณฑ์ cell (see MaintenanceStatusStrip) — both best-effort, same
  // as maintenanceLog/specStandards above: a missing/unreachable
  // MaintenanceTasks or ReportSettings tab just means an empty dashboard
  // section and colorless strips, not a broken page.
  const maintenanceTasks: MaintenanceTask[] = tasksResult.status === "fulfilled" ? tasksResult.value : [];
  const actionOptions: string[] = settingsResult.status === "fulfilled" ? settingsResult.value.actionOptions : [];
  const actionColorOrder: string[] =
    settingsResult.status === "fulfilled" ? settingsResult.value.actionColorOrder : [];

  return (
    <ITDashboard
      session={{ username: session.username, displayName: session.displayName, isBootstrap: session.isBootstrap }}
      initial={initial}
      initialMaintenanceLog={maintenanceLog}
      initialMaintenanceTasks={maintenanceTasks}
      actionOptions={actionOptions}
      actionColorOrder={actionColorOrder}
      initialSpecStandards={specStandards}
    />
  );
}
