import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SESSION_COOKIE, canAccessItDashboard, verifySessionToken } from "@/lib/auth";
import { getEquipmentDataUnredacted, getReportSettings, DEFAULT_REPORT_SETTINGS } from "@/lib/sheets";
import { isDeleted, isDisposed } from "@/lib/fields";
import MaintenanceReportBuilder, { type ReportEquipmentItem } from "@/components/MaintenanceReportBuilder";

export const dynamic = "force-dynamic";

/**
 * /manage/it/report — the printable "แบบฟอร์มการบำรุงรักษาเชิงป้องกัน..."
 * generator. Same access rule as /manage/it (see canAccessItDashboard): the
 * "it" role and the bootstrap superadmin only. A disposed item can still be
 * picked (a maintenance visit can legitimately be the reason it got
 * disposed), but a soft-deleted one never shows up, same as everywhere else.
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
      .filter((r) => !isDeleted(r.data, snapshot.fields))
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
          disposed: isDisposed(r.data, f),
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

  return <MaintenanceReportBuilder items={items} loadError={loadError} settings={settings} />;
}
