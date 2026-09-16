import type { Role } from "@/lib/auth";

// Per-account permission overrides layered on top of the existing 4-tier
// role system (superadmin / superadmin+bootstrap / admin / it) — added per
// the hospital's explicit request for finer per-account control ("อยาก
// ให้ระบบสิทธิมีรายการย่อยให้ติ๊ก... ยังไม่มีสถานการณ์เจาะจง อยากได้ไว้ก่อน
// เผื่อใช้อนาคต"). This is deliberately a HYBRID, not a replacement: every
// account still has one of the three roles, which sets a sensible default
// for each key below (see defaultPermissionsForRole); an admin creating or
// editing an account through /manage/users can then tick a key on
// ("extraPermissions") to grant something that role wouldn't normally have,
// or tick one off ("revokedPermissions") to take away something it would.
//
// Dependency-free "pure module", same convention as lib/booking.ts and
// lib/roleLabel.ts (only a type-only import from lib/auth.ts, never the
// crypto-importing runtime code) — so this can be imported directly by
// client components (UserFormModal's checkboxes) as well as every server
// route and lib/auth.ts/lib/booking.ts, without pulling `crypto`/
// `googleapis` into client bundles.
//
// IMPORTANT SECURITY NOTE (surfaced to the hospital when this shipped):
// granting a sensitive key — manageUsers, deleteEquipment,
// manageReportActionList, accessItDashboard — to a non-bootstrap account via
// extraPermissions is a real delegation of power. A regular superadmin
// granted manageUsers, for example, could create/edit other accounts
// (though still not become the true bootstrap account, and still can't grant
// itself or anyone else immunity to revocation — see the isBootstrap
// short-circuit in hasPermission below). Grant these sparingly.
//
// NOT every existing role check in the app was migrated to read through
// here — only the ones listed below, chosen because they're reasonable,
// low-risk things a hospital admin might plausibly want to grant/revoke per
// account. A few narrower rules were deliberately left as plain role checks
// because turning them into a togglable key would risk changing behavior in
// a way nobody asked for:
//   - the "it" role's blanket block from editing the general equipment table
//     (src/app/api/manage/records/[rowNumber]/route.ts) stays a hard rule;
//   - the general equipment table's "who sees every department vs. just
//     their own" list scope (src/app/api/manage/records/route.ts GET) stays
//     role-based.

export type PermissionKey =
  | "approveCarBooking"
  | "manageBookingResources"
  | "cancelAnyBooking"
  | "manageEquipmentAllDept"
  | "addEquipment"
  | "disposeRestoreEquipment"
  | "deleteEquipment"
  | "accessItDashboard"
  | "manageUsers"
  | "manageReportActionList"
  | "viewAllMaintenanceTasks";

export const PERMISSION_KEYS: PermissionKey[] = [
  "approveCarBooking",
  "manageBookingResources",
  "cancelAnyBooking",
  "manageEquipmentAllDept",
  "addEquipment",
  "disposeRestoreEquipment",
  "deleteEquipment",
  "accessItDashboard",
  "manageUsers",
  "manageReportActionList",
  "viewAllMaintenanceTasks",
];

/** Thai labels for the checkbox list in UserFormModal — kept here, next to
 * the keys themselves, so the two can never drift out of sync. */
export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  approveCarBooking: "อนุมัติ/ไม่อนุมัติการจองรถ",
  manageBookingResources: "จัดการรถ/ห้องประชุม (เพิ่ม/แก้ไข/ปิดใช้งาน)",
  cancelAnyBooking: "ยกเลิกการจองของผู้อื่นได้ (ทุกแผนก)",
  manageEquipmentAllDept: "แก้ไขรายการครุภัณฑ์ได้ทุกแผนก (ไม่จำกัดเฉพาะแผนกตัวเอง)",
  addEquipment: "เพิ่มรายการครุภัณฑ์ใหม่",
  disposeRestoreEquipment: "จำหน่าย/กู้คืนรายการครุภัณฑ์",
  deleteEquipment: "ลบรายการครุภัณฑ์ถาวร",
  accessItDashboard: "เข้าหน้าระบบงาน IT (สเปก/รายงาน/งานบำรุงรักษา)",
  manageUsers: "จัดการผู้ใช้งาน (เพิ่ม/แก้ไข/ปิดใช้งานบัญชี)",
  manageReportActionList: 'จัดการรายการ "การดำเนินการ" มาตรฐานในรายงาน',
  viewAllMaintenanceTasks: "ดูงานบำรุงรักษาของทุกคนในทีม (ไม่ใช่แค่ของตัวเอง)",
};

/** The minimal shape hasPermission()/defaultPermissionsForRole() need —
 * matches (a subset of) SessionPayload without importing it as a value. */
export interface PermissionSession {
  role: Role;
  isBootstrap: boolean;
  extraPermissions?: PermissionKey[];
  revokedPermissions?: PermissionKey[];
}

/** What each role gets out of the box, before any per-account override is
 * applied — this is exactly the pre-override behavior every one of these
 * keys' underlying checks already had, so an account with no overrides at
 * all behaves identically to before this feature existed. The single
 * env-configured bootstrap account gets every key (moot in practice, since
 * hasPermission short-circuits to true for it before ever consulting this —
 * kept here anyway so this function alone is always a correct, complete
 * description of "what can this role do"). */
export function defaultPermissionsForRole(role: Role, isBootstrap: boolean): Set<PermissionKey> {
  if (role === "superadmin" && isBootstrap) {
    return new Set(PERMISSION_KEYS);
  }
  if (role === "superadmin") {
    // Any superadmin — bootstrap or one created through /manage/users —
    // reaches equipment/booking oversight the same way today (see
    // canApproveCarBooking/canCancelBooking in lib/booking.ts and the
    // records API routes); only the IT-only surfaces stay bootstrap-only.
    return new Set<PermissionKey>([
      "approveCarBooking",
      "cancelAnyBooking",
      "manageEquipmentAllDept",
      "addEquipment",
      "disposeRestoreEquipment",
    ]);
  }
  if (role === "it") {
    // Matches canAccessItDashboard/canManageBookingResources in lib/auth.ts.
    return new Set<PermissionKey>(["manageBookingResources", "accessItDashboard"]);
  }
  // admin — booking/viewing/cancelling-your-own-booking stays open to every
  // role regardless (not a togglable key); nothing in this list is on by
  // default for admin.
  return new Set<PermissionKey>();
}

/** The single source of truth every migrated check now calls instead of
 * comparing session.role/isBootstrap directly. The one carve-out: the
 * bootstrap account is immune to revocation for every key — deliberately,
 * so a mistaken or malicious revokedPermissions entry can never lock the one
 * account that can grant/revoke everyone else's permissions out of its own
 * capabilities. For every other account: an explicit revoke always wins,
 * then the role's default, then an explicit grant. */
export function hasPermission(session: PermissionSession, key: PermissionKey): boolean {
  if (session.role === "superadmin" && session.isBootstrap) return true;

  const revoked = session.revokedPermissions;
  if (revoked && revoked.includes(key)) return false;

  if (defaultPermissionsForRole(session.role, session.isBootstrap).has(key)) return true;

  const extra = session.extraPermissions;
  return extra ? extra.includes(key) : false;
}

/** Validates that every entry in `value` is a real PermissionKey — used by
 * the /api/manage/users route to reject a malformed or hand-crafted
 * extraPermissions/revokedPermissions array instead of silently storing
 * garbage in the sheet. */
export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === "string" && (PERMISSION_KEYS as string[]).includes(value);
}
