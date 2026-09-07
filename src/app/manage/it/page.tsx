import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SESSION_COOKIE, canAccessItDashboard, verifySessionToken } from "@/lib/auth";
import {
  getEquipmentDataUnredacted,
  getMaintenanceLog,
  getReportSettings,
  getSpecStandards,
  type MaintenanceLogEntry,
  type ReportSettings,
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
  let settings: ReportSettings | null = null;
  let maintenanceLog: MaintenanceLogEntry[] = [];
  let specStandards: SpecStandards | null = null;
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
    settings = await getReportSettings();
  } catch (err) {
    initial = { error: err instanceof Error ? err.message : String(err) };
  }

  // Both tolerate a missing sheet tab on their own (empty history / default
  // thresholds) — this try/catch only guards an unexpected network/auth
  // failure from also breaking the rest of the page.
  try {
    maintenanceLog = await getMaintenanceLog();
    specStandards = await getSpecStandards();
  } catch {
    // Fall back to empty history + defaults, same rationale as settings above.
  }

  return (
    <ITDashboard
      session={{ username: session.username, isBootstrap: session.isBootstrap }}
      initial={initial}
      initialSettings={settings}
      initialMaintenanceLog={maintenanceLog}
      initialSpecStandards={specStandards}
    />
  );
}
