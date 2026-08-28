import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
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

  let initial: ManageData | { error: string };
  try {
    const snapshot = await getEquipmentDataUnredacted();
    const scopedRows =
      session.role === "superadmin"
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
