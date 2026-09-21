import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken, canAccessEquipmentRegistry } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getEquipmentDataUnredacted } from "@/lib/sheets";
import { rowSnapshotHash } from "@/lib/recordHash";
import ManageDashboard, { type ManageData } from "@/components/ManageDashboard";

export const dynamic = "force-dynamic";

function fieldValue(row: Record<string, string>, header: string | null): string {
  if (!header) return "";
  return (row[header] ?? "").trim();
}

export default async function ManagePage() {
  const cookieStore = await cookies();
  const session = verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) {
    redirect("/login?next=/manage");
  }
  // Accounts without accessEquipmentRegistry (default off for "user", and
  // revocable per-account for "admin") never see the general equipment
  // table — send them back to the menu instead of an empty/wrong page.
  if (!canAccessEquipmentRegistry(session)) {
    redirect("/menu");
  }

  let initial: ManageData | { error: string };
  try {
    const snapshot = await getEquipmentDataUnredacted();
    const scopedRows =
      session.role === "superadmin" || hasPermission(session, "manageEquipmentAllDept")
        ? snapshot.rows
        : snapshot.rows.filter(
            (r) => fieldValue(r.data, snapshot.fields.department) === session.department,
          );
    initial = {
      headers: snapshot.headers,
      fields: snapshot.fields,
      rows: scopedRows.map((r) => ({
        rowNumber: r.rowNumber,
        values: r.data,
        snapshotHash: rowSnapshotHash(snapshot.headers, r.data),
      })),
    };
  } catch (err) {
    initial = { error: err instanceof Error ? err.message : String(err) };
  }

  return <ManageDashboard session={session} initial={initial} />;
}
