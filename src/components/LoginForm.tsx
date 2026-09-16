"use client";

import { useState, type FormEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, LogIn } from "lucide-react";

const INPUT_CLASS =
  "h-11 rounded-lg border border-zinc-200 bg-white px-3 text-base text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100";

/** A labeled password input with its own show/hide toggle — shared by the
 * login form's single password field and the reset form's three (default /
 * new / confirm), which is why this got pulled out instead of staying
 * inlined once each. Each instance keeps its own show/hide state; toggling
 * one field's visibility never affects the others. */
function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  disabled: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-300">
      {label}
      <div className="relative">
        <input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
          autoComplete={autoComplete}
          disabled={disabled}
          className={`${INPUT_CLASS} w-full pr-10`}
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          disabled={disabled}
          aria-label={show ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-zinc-400 transition-colors hover:text-zinc-600 disabled:opacity-60 dark:hover:text-zinc-300"
        >
          {show ? (
            <EyeOff size={18} strokeWidth={2} aria-hidden="true" />
          ) : (
            <Eye size={18} strokeWidth={2} aria-hidden="true" />
          )}
        </button>
      </div>
    </label>
  );
}

/** Login form shared by every protected area of the app. Takes the
 * post-login destination as a plain prop — app/login/page.tsx always
 * passes "/menu" (the system-choice page) now, per the hospital's explicit
 * request that every login land there regardless of which URL triggered
 * the login redirect — kept as a prop rather than hard-coded here so the
 * one call site stays the single place that decides it.
 *
 * Card layout (header bar + logo/title left-aligned inside it, wider card,
 * show/hide password toggle) is modeled on a Thai government e-GP login
 * page the hospital asked to use as a style reference — but per the
 * hospital's explicit choice, the header keeps the hospital's own green
 * brand colors instead of the reference's navy blue.
 *
 * Also hosts a self-service password reset (toggled via `mode` below,
 * same card) — POST /api/auth/reset-password. The flow: a superadmin/
 * bootstrap account sets a default password for a new/locked-out account
 * through /manage/users, and the account holder proves it's really them by
 * supplying that default password here, then picks their own new one.
 * There's no session yet at this point (that's the whole reason this flow
 * exists), so identity is proven by the default password itself, not a
 * cookie. See the API route for the server-side rules (rate limiting,
 * must differ from the default, kicks out any session already active for
 * that account). */
export default function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "reset">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function switchMode(next: "login" | "reset") {
    setMode(next);
    setError(null);
    setSuccessMessage(null);
  }

  async function handleLoginSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "เข้าสู่ระบบไม่สำเร็จ");
        setLoading(false);
        return;
      }
      router.push(next);
      router.refresh();
    } catch {
      setError("เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่");
      setLoading(false);
    }
  }

  async function handleResetSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 4) {
      setError("รหัสผ่านใหม่ต้องมีอย่างน้อย 4 ตัวอักษร");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, currentPassword, newPassword }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "รีเซ็ตรหัสผ่านไม่สำเร็จ");
        setLoading(false);
        return;
      }
      setPassword("");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setLoading(false);
      setMode("login");
      setError(null);
      setSuccessMessage("ตั้งรหัสผ่านใหม่สำเร็จ กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่");
    } catch {
      setError("เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่");
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--page-bg)] px-4 py-10">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-emerald-900/10 bg-white shadow-lg dark:border-emerald-400/10 dark:bg-zinc-900">
        {/* แถบหัวการ์ด — จัดผังตามตัวอย่าง e-GP ที่ผู้ใช้ส่งมา (โลโก้ + ชื่อระบบ
            ชิดซ้ายในแถบสี) แต่คงโทนสีเขียวของโรงพยาบาลไว้ตามที่เลือก */}
        <div className="flex items-center gap-3 bg-gradient-to-br from-[var(--brand)] to-[var(--brand-strong)] px-6 py-5">
          {/* ครอปโลโก้เป็นวงกลมเต็มกรอบ (object-cover ทับขอบ) แทนการวางไอคอน
              เล็กลอยอยู่กลางป้ายวงกลมสีขาว ให้ดูเป็นตราวงกลมชิ้นเดียว
              เหมือนแพตเทิร์นที่ Dashboard.tsx ใช้อยู่แล้ว (rounded + object-cover) */}
          <Image
            src="/logo.png"
            alt="ตราสัญลักษณ์โรงพยาบาลท่าตะเกียบ"
            width={56}
            height={56}
            priority
            className="h-14 w-14 shrink-0 rounded-full bg-white object-cover ring-2 ring-white/80"
          />
          <div className="h-10 w-px shrink-0 bg-white/30" aria-hidden="true" />
          <div className="min-w-0">
            <h1 className="text-lg font-bold leading-5 text-white">ระบบบริการอิเล็กทรอนิกส์กลาง</h1>
            <p className="mt-1 text-xs font-medium text-white/80">สำหรับบุคลากรโรงพยาบาลท่าตะเกียบ</p>
          </div>
        </div>
        <div className="p-6">
          {mode === "login" ? (
            <>
              <h2 className="mb-5 text-center text-base font-semibold text-zinc-700 dark:text-zinc-200">
                เข้าสู่ระบบ
              </h2>
              {successMessage && (
                <p className="mb-4 flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                  <CheckCircle2 size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
                  {successMessage}
                </p>
              )}
              <form onSubmit={handleLoginSubmit} className="flex flex-col gap-4">
                <label
                  htmlFor="login-username"
                  className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-300"
                >
                  ชื่อผู้ใช้
                  <input
                    id="login-username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    autoFocus
                    autoComplete="username"
                    disabled={loading}
                    className={INPUT_CLASS}
                  />
                </label>
                <PasswordField
                  id="login-password"
                  label="รหัสผ่าน"
                  value={password}
                  onChange={setPassword}
                  autoComplete="current-password"
                  disabled={loading}
                />
                {error && (
                  <p role="alert" className="flex items-start gap-2 text-sm text-red-700 dark:text-red-300">
                    <AlertTriangle size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
                    {error}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={loading || !username || !password}
                  className="flex h-11 items-center justify-center gap-2 rounded-full bg-[var(--brand)] px-5 text-sm font-medium text-[var(--brand-contrast)] transition-colors hover:bg-[var(--brand-strong)] disabled:opacity-60"
                >
                  {loading ? (
                    <Loader2 size={16} strokeWidth={2} className="animate-spin" aria-hidden="true" />
                  ) : (
                    <LogIn size={16} strokeWidth={2} aria-hidden="true" />
                  )}
                  เข้าสู่ระบบ
                </button>
                <button
                  type="button"
                  onClick={() => switchMode("reset")}
                  disabled={loading}
                  className="inline-flex items-center justify-center gap-1.5 text-sm font-medium text-[var(--brand-strong)] transition-colors hover:underline disabled:opacity-60 dark:text-emerald-300"
                >
                  <KeyRound size={14} strokeWidth={2} aria-hidden="true" />
                  รีเซ็ตรหัสผ่าน
                </button>
              </form>
            </>
          ) : (
            <>
              <h2 className="mb-1 text-center text-base font-semibold text-zinc-700 dark:text-zinc-200">
                รีเซ็ตรหัสผ่าน
              </h2>
              <p className="mb-5 text-center text-xs text-zinc-500 dark:text-zinc-400">
                ใช้รหัสผ่านเริ่มต้นที่ได้รับเพื่อยืนยันตัวตน แล้วตั้งรหัสผ่านใหม่ของตัวเอง
              </p>
              <form onSubmit={handleResetSubmit} className="flex flex-col gap-4">
                <label
                  htmlFor="reset-username"
                  className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-300"
                >
                  ชื่อผู้ใช้
                  <input
                    id="reset-username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    autoFocus
                    autoComplete="username"
                    disabled={loading}
                    className={INPUT_CLASS}
                  />
                </label>
                <PasswordField
                  id="reset-current-password"
                  label="รหัสผ่านเริ่มต้น"
                  value={currentPassword}
                  onChange={setCurrentPassword}
                  autoComplete="current-password"
                  disabled={loading}
                />
                <PasswordField
                  id="reset-new-password"
                  label="รหัสผ่านใหม่"
                  value={newPassword}
                  onChange={setNewPassword}
                  autoComplete="new-password"
                  disabled={loading}
                />
                <PasswordField
                  id="reset-confirm-password"
                  label="ยืนยันรหัสผ่านใหม่"
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  autoComplete="new-password"
                  disabled={loading}
                />
                {error && (
                  <p role="alert" className="flex items-start gap-2 text-sm text-red-700 dark:text-red-300">
                    <AlertTriangle size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
                    {error}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={loading || !username || !currentPassword || !newPassword || !confirmPassword}
                  className="flex h-11 items-center justify-center gap-2 rounded-full bg-[var(--brand)] px-5 text-sm font-medium text-[var(--brand-contrast)] transition-colors hover:bg-[var(--brand-strong)] disabled:opacity-60"
                >
                  {loading ? (
                    <Loader2 size={16} strokeWidth={2} className="animate-spin" aria-hidden="true" />
                  ) : (
                    <KeyRound size={16} strokeWidth={2} aria-hidden="true" />
                  )}
                  ตั้งรหัสผ่านใหม่
                </button>
                <button
                  type="button"
                  onClick={() => switchMode("login")}
                  disabled={loading}
                  className="inline-flex items-center justify-center gap-1.5 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-700 disabled:opacity-60 dark:text-zinc-400 dark:hover:text-zinc-200"
                >
                  <ArrowLeft size={14} strokeWidth={2} aria-hidden="true" />
                  กลับไปเข้าสู่ระบบ
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
