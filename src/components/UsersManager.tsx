"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, LogOut, Pencil, Plus, ShieldCheck, UserRound } from "lucide-react";
import UserFormModal, { type ManagedUser } from "@/components/UserFormModal";

const CARD = "rounded-2xl border border-emerald-900/10 bg-white shadow-sm dark:border-emerald-400/10 dark:bg-zinc-900";
const ACTION_BUTTON =
  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

type LoadResult = { users: ManagedUser[] } | { error: string };

function isError(data: LoadResult): data is { error: string } {
  return "error" in data;
}

/**
 * "จัดการผู้ใช้" — superadmin-only account management for the /manage area.
 * Accessed only after src/app/manage/users/page.tsx has already verified
 * the session is a superadmin server-side; this component still calls
 * /api/manage/users, which independently re-checks the same thing.
 */
export default function UsersManager({
  username,
  initial,
}: {
  username: string;
  initial: LoadResult;
}) {
  const router = useRouter();
  const [data, setData] = useState<LoadResult>(initial);
  const [modal, setModal] = useState<{ mode: "add" | "edit"; user?: ManagedUser } | null>(null);

  const users = !isError(data) ? data.users : [];

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  function handleSaved(user: ManagedUser) {
    setData((prev) => {
      if (isError(prev)) return prev;
      const existingIndex = prev.users.findIndex((u) => u.username === user.username);
      const nextUsers =
        existingIndex === -1
          ? [...prev.users, user]
          : prev.users.map((u, i) => (i === existingIndex ? user : u));
      return { users: nextUsers };
    });
    setModal(null);
  }

  return (
    <main className="flex w-full flex-1 justify-center bg-[var(--page-bg)] px-4 py-8 sm:px-8 lg:px-12">
      <div className="flex w-full max-w-4xl flex-col gap-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-zinc-950 dark:text-zinc-50 sm:text-2xl">จัดการผู้ใช้</h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{username} · superadmin</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/manage"
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <ArrowLeft size={16} strokeWidth={2} aria-hidden="true" />
              จัดการข้อมูลครุภัณฑ์
            </Link>
            <button
              type="button"
              onClick={logout}
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--brand)] px-4 py-2 text-sm font-medium text-[var(--brand-contrast)] transition-colors hover:bg-[var(--brand-strong)]"
            >
              <LogOut size={16} strokeWidth={2} aria-hidden="true" />
              ออกจากระบบ
            </button>
          </div>
        </header>

        {isError(data) && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-900 shadow-sm dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
          >
            <AlertTriangle size={22} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
            <p className="flex-1 text-base leading-7">{data.error}</p>
          </div>
        )}

        {!isError(data) && (
          <>
            <div className={`${CARD} flex items-center justify-between p-4`}>
              <span className="text-sm text-zinc-400">{users.length.toLocaleString("th-TH")} บัญชีทั้งหมด</span>
              <button
                type="button"
                onClick={() => setModal({ mode: "add" })}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[var(--brand)] px-5 text-sm font-medium text-[var(--brand-contrast)] transition-colors hover:bg-[var(--brand-strong)]"
              >
                <Plus size={16} strokeWidth={2} aria-hidden="true" />
                เพิ่มผู้ใช้ใหม่
              </button>
            </div>

            <div className={CARD}>
              <div className="max-w-full overflow-x-auto">
                <table className="w-full text-left text-base">
                  <thead>
                    <tr className="border-b border-emerald-900/15 text-sm uppercase tracking-wide text-zinc-400 dark:border-emerald-400/15">
                      <th scope="col" className="whitespace-nowrap px-4 py-3 font-medium">ชื่อผู้ใช้</th>
                      <th scope="col" className="whitespace-nowrap px-4 py-3 font-medium">ชื่อที่แสดง</th>
                      <th scope="col" className="whitespace-nowrap px-4 py-3 font-medium">สิทธิ์</th>
                      <th scope="col" className="whitespace-nowrap px-4 py-3 font-medium">กลุ่มงาน</th>
                      <th scope="col" className="whitespace-nowrap px-4 py-3 font-medium">สถานะ</th>
                      <th scope="col" className="whitespace-nowrap px-4 py-3 font-medium">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr
                        key={u.username}
                        className="border-b border-zinc-100 transition-colors last:border-0 hover:bg-emerald-50/70 dark:border-zinc-800/60 dark:hover:bg-emerald-900/10"
                      >
                        <td className="whitespace-nowrap px-4 py-2.5 font-medium text-zinc-900 dark:text-zinc-100">
                          {u.username}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-zinc-700 dark:text-zinc-300">
                          {u.displayName || "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5">
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-sm font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                            {u.role === "superadmin" ? (
                              <ShieldCheck size={14} strokeWidth={2} aria-hidden="true" />
                            ) : (
                              <UserRound size={14} strokeWidth={2} aria-hidden="true" />
                            )}
                            {u.role}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-zinc-700 dark:text-zinc-300">
                          {u.department || "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5">
                          {u.active ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-sm font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                              เปิดใช้งาน
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-300 bg-zinc-50 px-2.5 py-1 text-sm font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                              ปิดใช้งาน
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5">
                          <button
                            type="button"
                            onClick={() => setModal({ mode: "edit", user: u })}
                            className={`${ACTION_BUTTON} border-emerald-900/15 text-emerald-700 hover:bg-emerald-50 focus-visible:outline-[var(--brand)] dark:border-emerald-400/20 dark:text-emerald-300 dark:hover:bg-emerald-900/20`}
                          >
                            <Pencil size={14} strokeWidth={2} aria-hidden="true" />
                            แก้ไข
                          </button>
                        </td>
                      </tr>
                    ))}
                    {users.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-10 text-center text-zinc-400">
                          ยังไม่มีผู้ใช้ในระบบ
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      {modal && (
        <UserFormModal
          mode={modal.mode}
          user={modal.user}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}
    </main>
  );
}
