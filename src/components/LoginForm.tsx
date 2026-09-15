"use client";

import { useState, type FormEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { AlertTriangle, Eye, EyeOff, Loader2, LogIn } from "lucide-react";

const INPUT_CLASS =
  "h-11 rounded-lg border border-zinc-200 bg-white px-3 text-base text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100";

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
 * brand colors instead of the reference's navy blue, and no "ลืมรหัสผ่าน?"
 * link is included since this app has no password-reset flow yet. */
export default function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
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
          <h2 className="mb-5 text-center text-base font-semibold text-zinc-700 dark:text-zinc-200">เข้าสู่ระบบ</h2>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-300">
              ชื่อผู้ใช้
              <input
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
            <label className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-300">
              รหัสผ่าน
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  disabled={loading}
                  className={`${INPUT_CLASS} w-full pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  disabled={loading}
                  aria-label={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-zinc-400 transition-colors hover:text-zinc-600 disabled:opacity-60 dark:hover:text-zinc-300"
                >
                  {showPassword ? (
                    <EyeOff size={18} strokeWidth={2} aria-hidden="true" />
                  ) : (
                    <Eye size={18} strokeWidth={2} aria-hidden="true" />
                  )}
                </button>
              </div>
            </label>
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
          </form>
        </div>
      </div>
    </main>
  );
}
