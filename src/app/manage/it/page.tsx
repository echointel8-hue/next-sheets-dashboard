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

  let initial: ITDashboardData | { error: string };
  let maintenanceLog: MaintenanceLogEntry[] = [];
  let specStandards: SpecStandards | null = null;
  let maintenanceTasks: MaintenanceTask[] = [];
  let actionOptions: string[] = [];
  try {
    const snapshot = await getEquipmentDataUnredacted();
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
  } catch (err) {
    initial = { error: err instanceof Error ? err.message : String(err) };
  }

  // Report-template text (org name/form title/acknowledger) is fetched by
  // /manage/it/report itself now, not here — see that page. Both of these
  // tolerate a missing sheet tab on their own (empty history / default
  // thresholds); this try/catch only guards an unexpected network/auth
  // failure from also breaking the rest of this page.
  try {
    maintenanceLog = await getMaintenanceLog();
    specStandards = await getSpecStandards();
  } catch {
    // Fall back to empty history + defaults, same rationale as above.
  }

  // Feeds the new "แดชบอร์ดงานบำรุงรักษา" summary (per-IT-account totals)
  // and the read-only status strip embedded in each spec table's
  // เลขครุภัณฑ์ cell (see MaintenanceStatusStrip) — both best-effort, same
  // as maintenanceLog/specStandards above: a missing/unreachable
  // MaintenanceTasks or ReportSettings tab just means an empty dashboard
  // section and colorless strips, not a broken page.
  try {
    maintenanceTasks = await getMaintenanceTasks();
  } catch {
    // Fall through with an empty list.
  }
  try {
    actionOptions = (await getReportSettings()).actionOptions;
  } catch {
    // Fall through with no colors — MaintenanceStatusStrip still renders
    // fine (everything just falls into ACTION_OTHER_COLOR).
  }

  return (
    <ITDashboard
      session={{ username: session.username, isBootstrap: session.isBootstrap }}
      initial={initial}
      initialMaintenanceLog={maintenanceLog}
      initialMaintenanceTasks={maintenanceTasks}
      actionOptions={actionOptions}
      initialSpecStandards={specStandards}
    />
  );
}
