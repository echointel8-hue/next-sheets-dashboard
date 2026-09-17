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
// HIERARCHY CAP (added right after this feature first shipped, in response
// to the hospital noticing an admin account could otherwise be ticked all
// the way up to look exactly like a superadmin, making the role dropdown
// itself meaningless) — two layers, both enforced server-side (the real
// boundary, in /api/manage/users) and client-side (so UserFormModal's
// checkbox list never even offers something the server would reject):
//   1. Six keys — manageBookingResources, deleteEquipment,
//      accessItDashboard, manageUsers, manageReportActionList,
//      viewAllMaintenanceTasks — stay reserved to the literal bootstrap
//      account and can never be granted to anyone else via
//      extraPermissions, full stop, even to a superadmin. See
//      NON_GRANTABLE_KEYS below.
//   2. On top of that, a role can have its own narrower allow-list for the
//      remaining "superadmin ทั่วไป" tier keys (approveCarBooking,
//      editBookingData, cancelAnyBooking, manageEquipmentAllDept,
//      addEquipment, disposeRestoreEquipment) — currently just "admin",
//      narrowed to addEquipment alone, since even that whole tier was still
//      enough to make an admin account indistinguishable from a superadmin.
//      See GRANTABLE_EXTRA_KEYS_BY_ROLE below.
// isGrantablePermission(key, role) is the one function that combines both
// layers — always use that, never NON_GRANTABLE_KEYS or
// GRANTABLE_EXTRA_KEYS_BY_ROLE directly.
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
  | "editBookingData"
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
  "editBookingData",
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
  approveCarBooking: "อนุมัติ/ไม่อนุมัติ/ออกใบสั่งงานการจองรถ",
  editBookingData: "แก้ไขข้อมูลรายละเอียดการจอง (วัตถุประสงค์/ปลายทาง/ผู้ร่วมเดินทาง ฯลฯ)",
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

/** Keys reserved to the bootstrap account by default — never grantable to
 * any other account through extraPermissions, no matter its role. Without
 * this cap, an admin account could be ticked up through every checkbox and
 * end up functionally indistinguishable from a superadmin (or even from
 * bootstrap itself), which would make the role dropdown meaningless — a
 * concern the hospital raised directly after this feature first shipped.
 * The chosen fix: a per-account override can raise an account's ceiling up
 * to (but never past) what a plain, non-bootstrap superadmin already gets
 * by default — the five keys below stay behind the literal bootstrap
 * account, full stop. Revoking one of these from an account that already
 * has it by role default (i.e. "it" and manageBookingResources/
 * accessItDashboard/viewAllMaintenanceTasks) is still always allowed —
 * this only blocks *granting* one of these keys to an account that
 * wouldn't otherwise have it. Enforced both server-side (readNewUserPayload/
 * readUpdateUserPayload in /api/manage/users, the real boundary) and
 * client-side (UserFormModal disables the checkbox), so this list is the
 * single source of truth for both. */
export const NON_GRANTABLE_KEYS: PermissionKey[] = [
  "manageBookingResources",
  "deleteEquipment",
  "accessItDashboard",
  "manageUsers",
  "manageReportActionList",
  "viewAllMaintenanceTasks",
];

/** A second, per-role ceiling on top of NON_GRANTABLE_KEYS — added when the
 * hospital pointed out that even the "superadmin ทั่วไป" tier (the keys NOT
 * in NON_GRANTABLE_KEYS: approveCarBooking, editBookingData,
 * cancelAnyBooking, manageEquipmentAllDept, addEquipment,
 * disposeRestoreEquipment) was too much to let an "admin" account reach in
 * full — ticking every one of those still made an admin account functionally
 * identical to a plain superadmin, the exact problem this whole cap exists to prevent, just one
 * tier down. Only a role listed here has its grantable additions narrowed
 * further; a role with no entry keeps the plain NON_GRANTABLE_KEYS ceiling
 * (currently just "admin", narrowed to addEquipment alone, per the
 * hospital's explicit choice — "admin ให้เพิ่มได้เฉพาะเพิ่มรายการครุภัณฑ์
 * ใหม่เท่านั้น นอกนั้นซ่อนไป"). This never restricts a role's own defaults
 * (see isGrantablePermission below) — only what can be added beyond them. */
export const GRANTABLE_EXTRA_KEYS_BY_ROLE: Partial<Record<Role, PermissionKey[]>> = {
  admin: ["addEquipment"],
};

/** True if `key` can be added to some account's extraPermissions for the
 * given `role` — checked in this order: (1) the role already gets it by
 * default anyway, so "granting" it is really just re-enabling the role's
 * own default, never blocked; (2) it's one of the six bootstrap-reserved
 * keys (NON_GRANTABLE_KEYS) — never grantable as an addition to anyone;
 * (3) the role has its own narrower allow-list (GRANTABLE_EXTRA_KEYS_BY_ROLE)
 * — only listed keys are grantable; (4) no allow-list for this role — every
 * remaining (non-reserved) key is grantable. Use this — never a bare
 * NON_GRANTABLE_KEYS/GRANTABLE_EXTRA_KEYS_BY_ROLE check — everywhere a grant
 * is being validated. */
export function isGrantablePermission(key: PermissionKey, role: Role): boolean {
  if (defaultPermissionsForRole(role, false).has(key)) return true;
  if (NON_GRANTABLE_KEYS.includes(key)) return false;
  const allowedExtras = GRANTABLE_EXTRA_KEYS_BY_ROLE[role];
  if (allowedExtras) return allowedExtras.includes(key);
  return true;
}

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
    // canApproveCarBooking/canEditBookingByManagement/canCancelBooking in
    // lib/booking.ts and the records API routes); only the IT-only surfaces
    // stay bootstrap-only.
    return new Set<PermissionKey>([
      "approveCarBooking",
      "editBookingData",
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
