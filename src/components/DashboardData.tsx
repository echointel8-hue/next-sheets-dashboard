import Dashboard from "@/components/Dashboard";
import { getEquipmentData } from "@/lib/sheets";

// Server Component: does the (potentially slow) Google Sheets round-trip.
// Rendered inside a <Suspense> boundary in page.tsx so the page shell
// (DashboardSkeleton) paints immediately instead of blocking on this fetch.
export default async function DashboardData() {
  let initial;
  try {
    initial = await getEquipmentData();
  } catch (err) {
    initial = { error: err instanceof Error ? err.message : String(err) };
  }

  return <Dashboard initial={initial} />;
}
