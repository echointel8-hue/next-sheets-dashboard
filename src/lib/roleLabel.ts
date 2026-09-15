import type { Role } from "@/lib/auth";

/**
 * Short role label shown in AppShell's sidebar footer chip. A pure,
 * dependency-free module — same reasoning as lib/specEvaluation.ts vs
 * lib/sheets.ts (see the comment above the lib/specEvaluation import in
 * ManageDashboard.tsx): lib/auth.ts pulls in Node's `crypto`, so a client
 * component can only take a `type Role` (type-only, erased at build) from
 * it, never a value like this function — this file exists so every page
 * can share one consistent wording instead of re-deriving it seven times.
 */
export function roleLabelFor(role: Role, department: string, isBootstrap: boolean): string {
  if (role === "superadmin") return isBootstrap ? "Superadmin (Bootstrap)" : "Superadmin";
  if (role === "admin") return department ? `Admin · ${department}` : "Admin";
  return "IT";
}

/**
 * Client-safe mirror of lib/auth.ts's canAccessItDashboard() — same exact
 * rule (see that function's own comment for the full rationale), just
 * duplicated here rather than imported, because lib/auth.ts imports Node's
 * `crypto` and can't be pulled into a client bundle as a value import (only
 * `import type` from it is safe — see the lib/specEvaluation.ts comment in
 * ManageDashboard.tsx for the same split applied elsewhere). Used only to
 * decide whether AppShell's sidebar shows the "งานศูนย์คอมพิวเตอร์ (IT)"
 * section — never for an actual authorization decision, which always stays
 * server-side in lib/auth.ts's real canAccessItDashboard().
 */
export function canAccessItDashboardClient(role: Role, isBootstrap: boolean): boolean {
  return role === "it" || (role === "superadmin" && isBootstrap);
}

/**
 * Client-safe mirror of lib/auth.ts's canManageBookingResources() — same
 * duplication reasoning as canAccessItDashboardClient above. Used only to
 * decide whether BookingDashboard shows the "เพิ่ม/แก้ไข/เปิด-ปิดใช้งาน"
 * controls for cars/meeting rooms — the real authorization decision always
 * stays server-side in the booking resource API routes.
 */
export function canManageBookingResourcesClient(role: Role, isBootstrap: boolean): boolean {
  return role === "it" || (role === "superadmin" && isBootstrap);
}
