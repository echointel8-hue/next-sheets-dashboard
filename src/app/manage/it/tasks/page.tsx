import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SESSION_COOKIE, canAccessItDashboard, verifySessionToken } from "@/lib/auth";
import { getMaintenanceTasks, getReportSettings, DEFAULT_REPORT_SETTINGS, type MaintenanceTask } from "@/lib/sheets";
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

  // These two reads don't depend on each other — run them together
  // instead of one after the other so this page's total wait is however
  // long the slower of the two takes, not their sum.
  const [tasksResult, settingsResult] = await Promise.allSettled([getMaintenanceTasks(), getReportSettings()]);

  let tasks: MaintenanceTask[] = [];
  let loadError: string | null = null;
  if (tasksResult.status === "fulfilled") {
    const allTasks = tasksResult.value;
    // Per the hospital's request, a regular "it" account only ever sees its
    // own tasks here — "งานบำรุงรักษา" of one's own, not the whole team's.
    // The bootstrap superadmin account is the one exception, keeping the
    // team-wide "หัวหน้าติดตามงาน" view (see MaintenanceTasksBoard's own
    // stats/byAssignee comment) since that's still the only way anyone
    // leads/oversees the team here — there's no separate "หัวหน้า" role.
    tasks = session.isBootstrap ? allTasks : allTasks.filter((t) => t.assignedToUsername === session.username);
  } else {
    loadError = tasksResult.reason instanceof Error ? tasksResult.reason.message : String(tasksResult.reason);
  }

  // Falls back to the default single option — same tolerance as every
  // other ReportSettings reader in this app.
  const settings = settingsResult.status === "fulfilled" ? settingsResult.value : DEFAULT_REPORT_SETTINGS;

  return (
    <MaintenanceTasksBoard
      // displayName comes straight off the session cookie now (looked up
      // once at login — see the SessionPayload comment in lib/auth.ts)
      // instead of a separate getUsers() call on every visit to this page.
      session={{ username: session.username, displayName: session.displayName, isBootstrap: session.isBootstrap }}
      initialTasks={tasks}
      loadError={loadError}
      actionOptions={settings.actionOptions}
      hiddenActionOptions={settings.hiddenActionOptions}
      detailRequiredActionOptions={settings.detailRequiredActionOptions}
      actionColorOrder={settings.actionColorOrder}
    />
  );
}
