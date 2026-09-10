import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SESSION_COOKIE, canAccessItDashboard, verifySessionToken } from "@/lib/auth";
import {
  getMaintenanceTasks,
  getReportSettings,
  getUsers,
  DEFAULT_REPORT_SETTINGS,
  type MaintenanceTask,
} from "@/lib/sheets";
import MaintenanceTasksBoard from "@/components/MaintenanceTasksBoard";

export const dynamic = "force-dynamic";

/**
 * /manage/it/tasks — "งานบำรุงรักษา (Task)": every equipment item an IT
 * account has printed a maintenance report for shows up here as a task
 * (see createMaintenanceTasks, triggered from /manage/it/report's print
 * button), so IT can come back and record what was actually done, and
 * whoever leads the team can see everyone's in-progress/completed work in
 * one place. Same access rule as the rest of /manage/it — see
 * canAccessItDashboard() — since this hospital's "หัวหน้า" IT view is just
 * the existing IT-dashboard access, not a separate role.
 */
export default async function ManageItTasksPage() {
  const cookieStore = await cookies();
  const session = verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) {
    redirect("/login?next=/manage/it/tasks");
  }
  if (!canAccessItDashboard(session)) {
    redirect("/manage");
  }

  let tasks: MaintenanceTask[] = [];
  let loadError: string | null = null;
  try {
    tasks = await getMaintenanceTasks();
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  let actionOptions = DEFAULT_REPORT_SETTINGS.actionOptions;
  let hiddenActionOptions = DEFAULT_REPORT_SETTINGS.hiddenActionOptions;
  try {
    const settings = await getReportSettings();
    actionOptions = settings.actionOptions;
    hiddenActionOptions = settings.hiddenActionOptions;
  } catch {
    // Fall back to the default single option — same tolerance as every
    // other ReportSettings reader in this app.
  }

  // Shows a real Thai name in the page header instead of the bare login —
  // same lookup/fallback as /manage/it/report's "ผู้ดำเนินการ" auto-fill.
  let displayName = session.username;
  try {
    const users = await getUsers();
    displayName = users.find((u) => u.username === session.username)?.displayName || session.username;
  } catch {
    // fall through with the bare username
  }

  return (
    <MaintenanceTasksBoard
      session={{ username: session.username, displayName, isBootstrap: session.isBootstrap }}
      initialTasks={tasks}
      loadError={loadError}
      actionOptions={actionOptions}
      hiddenActionOptions={hiddenActionOptions}
    />
  );
}
