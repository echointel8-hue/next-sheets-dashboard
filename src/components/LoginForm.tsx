"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, LogIn } from "lucide-react";

const INPUT_CLASS =
  "h-11 rounded-lg border border-zinc-200 bg-white px-3 text-base text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100";

/** Login form for the /manage area. Takes the post-login destination as a
 * plain prop (resolved server-side in app/login/page.tsx from the "next"
 * search param) rather than reading it here with useSearchParams, which
 * would require wrapping this in a Suspense boundary for production
 * builds. */
export default function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
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
    <main className="flex min-h-screen items-center justify-center bg-[var(--page-bg)] px-4">
      <div className="w-full max-w-sm rounded-2xl border border-emerald-900/10 bg-white p-6 shadow-sm dark:border-emerald-400/10 dark:bg-zinc-900">
        <h1 className="mb-1 text-xl font-bold text-zinc-950 dark:text-zinc-50">เข้าสู่ระบบจัดการ</h1>
        <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
          สำหรับผู้ดูแลระบบและผู้รับผิดชอบครุภัณฑ์แต่ละกลุ่มงาน
        </p>
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
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              disabled={loading}
              className={INPUT_CLASS}
            />
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
    </main>
  );
}
