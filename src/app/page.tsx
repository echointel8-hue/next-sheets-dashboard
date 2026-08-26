import { Suspense } from "react";
import DashboardData from "@/components/DashboardData";
import DashboardSkeleton from "@/components/DashboardSkeleton";

// The sheet changes at any time — never bake a stale snapshot into a static page.
export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardData />
    </Suspense>
  );
}
