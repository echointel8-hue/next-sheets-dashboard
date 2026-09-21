import type { Role } from "@/lib/auth";
import { hasPermission, type PermissionKey } from "@/lib/permissions";

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
  return department ? `User · ${department}` : "User";
}

/**
 * Client-safe mirror of lib/auth.ts's canAccessItDashboard() — same exact
 * rule (see that function's own comment for the full rationale), now
 * delegating to hasPermission()'s "accessItDashboard" key (lib/permissions.ts
 * — dependency-free, safe to import directly into a client bundle) instead
 * of duplicating the role/isBootstrap comparison by hand, so a per-account
 * permission override actually takes effect in the nav here too, not just
 * server-side. The two extra params are optional so every pre-existing call
 * site (which only ever passed role/isBootstrap) still compiles unchanged;
 * pass a session's extraPermissions/revokedPermissions through when
 * available for the override to actually apply. Used only to decide whether
 * AppShell's sidebar shows the "งานศูนย์คอมพิวเตอร์ (IT)" section — never for
 * an actual authorization decision, which always stays server-side.
 */
export function canAccessItDashboardClient(
  role: Role,
  isBootstrap: boolean,
  extraPermissions?: PermissionKey[],
  revokedPermissions?: PermissionKey[]
): boolean {
  return hasPermission({ role, isBootstrap, extraPermissions, revokedPermissions }, "accessItDashboard");
}

/**
 * Client-safe mirror of lib/auth.ts's canManageBookingResources() — same
 * duplication reasoning and same hasPermission()-backed upgrade as
 * canAccessItDashboardClient above ("manageBookingResources" key). Used only
 * to decide whether BookingDashboard shows the "เพิ่ม/แก้ไข/เปิด-ปิดใช้งาน"
 * controls for cars/meeting rooms — the real authorization decision always
 * stays server-side in the booking resource API routes.
 */
export function canManageBookingResourcesClient(
  role: Role,
  isBootstrap: boolean,
  extraPermissions?: PermissionKey[],
  revokedPermissions?: PermissionKey[]
): boolean {
  return hasPermission({ role, isBootstrap, extraPermissions, revokedPermissions }, "manageBookingResources");
}

/**
 * Client-safe mirror of lib/auth.ts's canAccessEquipmentRegistry() — a
 * superadmin always passes unconditionally (role check, never disturbed by
 * anything below), admin/user go through hasPermission()'s
 * "accessEquipmentRegistry" key (on by default for admin, off by default
 * for user, either grantable/revocable per account through /manage/users).
 * Used only to decide whether AppShell's sidebar shows the
 * "ครุภัณฑ์คอมพิวเตอร์" (/manage) link — the real authorization decision
 * always stays server-side (/manage's own page.tsx and every
 * /api/manage/records* route all re-check this themselves).
 */
export function canAccessEquipmentRegistryClient(
  role: Role,
  isBootstrap: boolean,
  extraPermissions?: PermissionKey[],
  revokedPermissions?: PermissionKey[]
): boolean {
  return role === "superadmin" || hasPermission({ role, isBootstrap, extraPermissions, revokedPermissions }, "accessEquipmentRegistry");
}

/**
 * Client-safe mirror for "can this account reach /manage/users" — see
 * hasPermission()'s "manageUsers" key. Used only to decide whether
 * AppShell's sidebar shows the "จัดการผู้ใช้" link — the real authorization
 * decision always stays server-side (/manage/users' page.tsx and
 * /api/manage/users both re-check this themselves).
 */
export function canManageUsersClient(
  role: Role,
  isBootstrap: boolean,
  extraPermissions?: PermissionKey[],
  revokedPermissions?: PermissionKey[]
): boolean {
  return hasPermission({ role, isBootstrap, extraPermissions, revokedPermissions }, "manageUsers");
}
