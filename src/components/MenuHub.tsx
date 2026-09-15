"use client";

import Link from "next/link";
import { Car, DoorOpen, Package } from "lucide-react";
import type { Role } from "@/lib/auth";
import { canAccessItDashboardClient, roleLabelFor } from "@/lib/roleLabel";
import AppShell from "@/components/AppShell";

const CARD =
  "rounded-2xl border border-emerald-900/10 bg-white shadow-[0_1px_2px_rgba(4,120,87,0.04),0_4px_16px_-4px_rgba(4,120,87,0.14)] dark:border-emerald-400/10 dark:bg-zinc-900 dark:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_4px_16px_-4px_rgba(0,0,0,0.45)]";

interface MenuItem {
  href: string;
  title: string;
  description: string;
  icon: React.ReactNode;
}

/**
 * The post-login landing page — a plain choice of which system to open,
 * per the hospital's explicit request ("อยากให้เมื่อ login เข้าไปเสร็จแล้ว
 * ให้เจอหน้าเมนูซึ่งเป็นทางเลือกใช้งานระบบ") instead of dropping straight
 * into /manage the way login used to. Every card is shown to every
 * logged-in account regardless of role — each destination page still
 * enforces its own rules once clicked (e.g. /manage redirects an "it"
 * session on to /manage/it automatically, see that page's own comment).
 */
export default function MenuHub({
  session,
}: {
  session: { username: string; displayName: string; role: Role; department: string; isBootstrap: boolean };
}) {
  const items: MenuItem[] = [
    {
      href: "/manage",
      title: "ระบบทะเบียนครุภัณฑ์คอมพิวเตอร์",
      description: "เพิ่ม/แก้ไข/จำหน่ายครุภัณฑ์ ดูรายงานสเปกและงานบำรุงรักษา",
      icon: <Package size={22} strokeWidth={2} aria-hidden="true" />,
    },
    {
      href: "/booking?type=car",
      title: "ระบบจองรถ",
      description: "จองรถของโรงพยาบาล ดูช่วงเวลาที่ว่าง และรายการที่จองไว้",
      icon: <Car size={22} strokeWidth={2} aria-hidden="true" />,
    },
    {
      href: "/booking?type=room",
      title: "ระบบจองห้องประชุม",
      description: "จองห้องประชุม ดูช่วงเวลาที่ว่าง และรายการที่จองไว้",
      icon: <DoorOpen size={22} strokeWidth={2} aria-hidden="true" />,
    },
  ];

  return (
    <AppShell
      roleLabel={roleLabelFor(session.role, session.department, session.isBootstrap)}
      username={session.username}
      displayName={session.displayName}
      canAccessManage={session.role !== "it"}
      canManageUsers={session.isBootstrap}
      canAccessIt={canAccessItDashboardClient(session.role, session.isBootstrap)}
    >
      <main className="flex w-full flex-1 justify-center px-4 py-10 sm:px-6 lg:px-10">
        <div className="flex w-full max-w-4xl flex-col gap-6">
          <header>
            <h1 className="text-xl font-bold text-zinc-950 dark:text-zinc-50 sm:text-2xl">
              เลือกระบบที่ต้องการใช้งาน
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {session.displayName || session.username} · {session.role}
              {session.department ? ` · ${session.department}` : ""}
            </p>
          </header>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`${CARD} group flex flex-col gap-4 p-6 transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]`}
              >
                <span
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--brand)] to-[var(--brand-2)] text-[var(--brand-contrast)] shadow-sm transition-transform group-hover:scale-105"
                  aria-hidden="true"
                >
                  {item.icon}
                </span>
                <div>
                  <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">{item.title}</h2>
                  <p className="mt-1 text-sm leading-6 text-zinc-500 dark:text-zinc-400">{item.description}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </main>
    </AppShell>
  );
}
