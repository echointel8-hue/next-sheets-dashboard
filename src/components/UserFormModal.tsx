"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Loader2, Save, X } from "lucide-react";
import type { Role } from "@/lib/auth";
import { DEPARTMENT_OPTIONS } from "@/lib/fields";

const INPUT_CLASS =
  "h-11 rounded-lg border border-zinc-200 bg-white px-3 text-base text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:disabled:bg-zinc-800/60 dark:disabled:text-zinc-500";

export interface ManagedUser {
  rowNumber: number;
  username: string;
  role: Role;
  department: string;
  displayName: string;
  active: boolean;
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

    setSaving(true);
    try {
      const res = await fetch("/api/manage/users", {
        method: mode === "add" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "add"
            ? { username: username.trim(), password, role, department, displayName }
            : {
                username,
                ...(password ? { password } : {}),
                role,
                department,
                displayName,
                active,
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
                onChange={(e) => setRole(e.target.value as Role)}
                disabled={saving}
                className={INPUT_CLASS}
              >
                <option value="admin">admin (กลุ่มงานตัวเอง)</option>
                <option value="superadmin">superadmin (ทุกกลุ่มงาน)</option>
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
                className="flex h-11 items-center justify-center gap-2 rounded-full bg-[var(--brand)] px-5 text-sm font-medium text-[var(--brand-contrast)] transition-colors hover:bg-[var(--brand-strong)] disabled:opacity-60"
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
