"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Loader2, Save, X } from "lucide-react";
import type { Role } from "@/lib/auth";
import { DEPARTMENT_OPTIONS } from "@/lib/fields";
import {
  PERMISSION_KEYS,
  PERMISSION_LABELS,
  defaultPermissionsForRole,
  isGrantablePermission,
  type PermissionKey,
} from "@/lib/permissions";

const INPUT_CLASS =
  "h-11 rounded-lg border border-zinc-200 bg-white px-3 text-base text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:disabled:bg-zinc-800/60 dark:disabled:text-zinc-500";

export interface ManagedUser {
  rowNumber: number;
  username: string;
  role: Role;
  department: string;
  displayName: string;
  active: boolean;
  extraPermissions?: PermissionKey[];
  revokedPermissions?: PermissionKey[];
}

/**
 * Add/edit form for one account in the Users tab. Mirrors the accessible
 * modal pattern in EquipmentFormModal.tsx (focus trap, Esc-to-close,
 * portal). On edit, the password field is optional — leaving it blank
 * keeps the existing password unchanged; typing something resets it.
 * Username is fixed once created (it's how rows are looked up server-side).
 */
export default function UserFormModal({
  mode,
  user,
  onClose,
  onSaved,
}: {
  mode: "add" | "edit";
  user?: ManagedUser;
  onClose: () => void;
  onSaved: (user: ManagedUser) => void;
}) {
  const [username, setUsername] = useState(user?.username ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>(user?.role ?? "admin");
  const [department, setDepartment] = useState(user?.department ?? "");
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [active, setActive] = useState(user?.active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-account permission overrides (see lib/permissions.ts) — what this
  // account can do beyond/instead of its role's own defaults. Starts at the
  // role's defaults, with the account's own saved extraPermissions layered
  // on top (added) and revokedPermissions layered on top (removed) — so
  // editing an existing account shows exactly what it can do right now, not
  // just the raw override lists. Never bootstrap (env-configured, not
  // editable through this UI, and immune to revocation anyway).
  const [checkedPermissions, setCheckedPermissions] = useState<Set<PermissionKey>>(() => {
    const base = defaultPermissionsForRole(user?.role ?? "admin", false);
    const next = new Set(base);
    for (const k of user?.extraPermissions ?? []) next.add(k);
    for (const k of user?.revokedPermissions ?? []) next.delete(k);
    return next;
  });

  /** Changing the role resets the checkbox list back to that role's plain
   * defaults, discarding any manual ticks made under the previous role —
   * simplest predictable behavior (no hidden "leftover override from a role
   * you're no longer on"), and matches how rarely an account's role
   * actually changes after creation. */
  function handleRoleChange(nextRole: Role) {
    setRole(nextRole);
    setCheckedPermissions(defaultPermissionsForRole(nextRole, false));
  }

  function togglePermission(key: PermissionKey) {
    setCheckedPermissions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const dialogRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    firstInputRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === "add" && username.trim() === "") {
      setError("กรุณาระบุชื่อผู้ใช้");
      return;
    }
    if (mode === "add" && password.length < 4) {
      setError("รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร");
      return;
    }
    if (password && password.length < 4) {
      setError("รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร");
      return;
    }
    if (role === "admin" && department.trim() === "") {
      setError("admin ต้องระบุกลุ่มงานที่รับผิดชอบ");
      return;
    }

    // Diff the ticked checkboxes against the role's plain defaults — only
    // the deviations get sent/stored, exactly what hasPermission()
    // (lib/permissions.ts) expects in extraPermissions/revokedPermissions.
    const roleDefaults = defaultPermissionsForRole(role, false);
    const extraPermissions = PERMISSION_KEYS.filter((k) => checkedPermissions.has(k) && !roleDefaults.has(k));
    const revokedPermissions = PERMISSION_KEYS.filter((k) => !checkedPermissions.has(k) && roleDefaults.has(k));

    setSaving(true);
    try {
      const res = await fetch("/api/manage/users", {
        method: mode === "add" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "add"
            ? { username: username.trim(), password, role, department, displayName, extraPermissions, revokedPermissions }
            : {
                username,
                ...(password ? { password } : {}),
                role,
                department,
                displayName,
                active,
                extraPermissions,
                revokedPermissions,
              }
        ),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "บันทึกไม่สำเร็จ");
        setSaving(false);
        return;
      }
      onSaved(json.user as ManagedUser);
    } catch {
      setError("บันทึกไม่สำเร็จ กรุณาลองใหม่");
      setSaving(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-form-modal-title"
        className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-zinc-900"
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <h2 id="user-form-modal-title" className="text-base font-semibold text-zinc-800 dark:text-zinc-100">
            {mode === "add" ? "เพิ่มผู้ใช้ใหม่" : `แก้ไขผู้ใช้ "${user?.username}"`}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดหน้าต่าง"
            className="rounded-full p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
          >
            <X size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {error && (
              <p role="alert" className="flex items-start gap-2 text-sm text-red-700 dark:text-red-300">
                <AlertTriangle size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
                {error}
              </p>
            )}

            <label className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-300">
              ชื่อผู้ใช้ (สำหรับ login)
              <input
                ref={firstInputRef}
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={saving || mode === "edit"}
                className={INPUT_CLASS}
              />
            </label>

            <label className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-300">
              {mode === "add" ? "รหัสผ่าน" : "ตั้งรหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)"}
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={saving}
                autoComplete="new-password"
                className={INPUT_CLASS}
              />
            </label>

            <label className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-300">
              ชื่อที่แสดง
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={saving}
                className={INPUT_CLASS}
              />
            </label>

            <label className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-300">
              สิทธิ์
              <select
                value={role}
                onChange={(e) => handleRoleChange(e.target.value as Role)}
                disabled={saving}
                className={INPUT_CLASS}
              >
                <option value="admin">admin (กลุ่มงานตัวเอง)</option>
                <option value="superadmin">superadmin (ทุกกลุ่มงาน)</option>
                <option value="it">it (ดูข้อมูล + ออกรายงานทุกกลุ่มงาน)</option>
              </select>
            </label>

            {role === "admin" && (
              <label className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-300">
                กลุ่มงานที่รับผิดชอบ
                <select
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  disabled={saving}
                  className={INPUT_CLASS}
                >
                  <option value="">— เลือกกลุ่มงาน —</option>
                  {DEPARTMENT_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                  {department && !DEPARTMENT_OPTIONS.includes(department) && (
                    <option value={department}>{department}</option>
                  )}
                </select>
              </label>
            )}

            <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">สิทธิ์เฉพาะบัญชี</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                เริ่มต้นตามสิทธิ์ &quot;{role}&quot; ด้านบน — ติ๊กเพิ่มเพื่อให้สิทธิ์พิเศษ หรือปลดติ๊กเพื่อ
                ตัดสิทธิ์ที่สิทธิ์นี้ปกติจะได้ (เปลี่ยนสิทธิ์หลักด้านบนจะรีเซ็ตรายการนี้กลับเป็นค่าเริ่มต้น) — บาง
                รายการติ๊กเพิ่มไม่ได้ (จางไว้) เพราะสงวนไว้เฉพาะบัญชีผู้ดูแลระบบหลักเท่านั้น
              </p>
              <div className="flex flex-col gap-1.5">
                {PERMISSION_KEYS.map((key) => {
                  const checked = checkedPermissions.has(key);
                  // Can always untick (revoke) — the cap only blocks
                  // *granting* a bootstrap-reserved key to an account that
                  // wouldn't otherwise have it (see isGrantablePermission /
                  // NON_GRANTABLE_KEYS in lib/permissions.ts). The real
                  // boundary is server-side in /api/manage/users; this just
                  // keeps the UI from offering something that would bounce.
                  const locked = !checked && !isGrantablePermission(key, role);
                  return (
                    <label
                      key={key}
                      className={`flex items-start gap-2 text-sm ${
                        locked
                          ? "text-zinc-400 dark:text-zinc-600"
                          : "text-zinc-600 dark:text-zinc-300"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => togglePermission(key)}
                        disabled={saving || locked}
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-300 text-[var(--brand)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]"
                      />
                      {PERMISSION_LABELS[key]}
                      {locked && <span className="text-xs">(เฉพาะผู้ดูแลระบบหลัก)</span>}
                    </label>
                  );
                })}
              </div>
            </div>

            {mode === "edit" && (
              <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                  disabled={saving}
                  className="h-4 w-4 rounded border-zinc-300 text-[var(--brand)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]"
                />
                เปิดใช้งานบัญชีนี้ (ปิดไว้เพื่อระงับการ login โดยไม่ต้องลบบัญชี)
              </label>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="h-11 rounded-full border border-zinc-200 px-5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex h-11 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[var(--brand)] to-[var(--brand-2)] px-5 text-sm font-medium text-[var(--brand-contrast)] transition-colors hover:from-[var(--brand-strong)] disabled:opacity-60"
              >
                {saving ? (
                  <Loader2 size={16} strokeWidth={2} className="animate-spin" aria-hidden="true" />
                ) : (
                  <Save size={16} strokeWidth={2} aria-hidden="true" />
                )}
                บันทึก
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body
  );
}
