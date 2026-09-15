"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Calendar,
  ClipboardList,
  Globe,
  Hospital,
  LayoutGrid,
  LogOut,
  Menu,
  Package,
  Users,
  Wrench,
  X,
} from "lucide-react";

/**
 * Persistent left-sidebar app shell for every authenticated screen (/menu,
 * /manage, /manage/it, /manage/it/tasks, /manage/it/report, /manage/users,
 * /booking). Introduced to replace the old pattern of each page repeating
 * its own row of "เมนูหลัก / จองรถ/ห้องประชุม / ระบบงาน IT / ออกจากระบบ"
 * links inside its own <header> — same destinations, same role gating,
 * just declared once here instead of copy-pasted seven times (see the
 * removed per-page `logout()` + header nav <Link> clusters this replaces).
 * Each page keeps its own content (tables, modals, page-specific action
 * buttons) completely untouched; only the outer chrome moved.
 *
 * Deliberately NOT used by the public, unauthenticated dashboard at "/"
 * (see src/components/Dashboard.tsx) — that page has no session/role to
 * build a nav from, and showing internal-staff links to an anonymous
 * visitor would be wrong. It links here manually via a plain "เข้าสู่ระบบ"
 * link, same as before.
 *
 * Colors intentionally stay inside the existing green brand family
 * (--brand/--brand-2/--brand-strong, plus Tailwind's built-in emerald
 * scale for the sidebar's dark surface) rather than adopting a new palette
 * — only the layout/spacing/shadow language changes.
 */

export interface AppShellProps {
  /** Exactly what each page's own header subtitle already showed (e.g.
   * "superadmin (ทุกกลุ่มงาน)", "admin · กลุ่มงานเภสัชกรรม", "IT") — moved
   * here unchanged rather than re-derived, so wording never drifts from
   * what a returning user already recognizes. */
  roleLabel: string;
  username: string;
  displayName?: string;
  /** Show "ครุภัณฑ์คอมพิวเตอร์" (/manage) in the sidebar. */
  canAccessManage: boolean;
  /** Show "จัดการผู้ใช้" (/manage/users) in the sidebar — bootstrap only. */
  canManageUsers: boolean;
  /** Show "ระบบงาน IT" (/manage/it) + "งานบำรุงรักษา" (/manage/it/tasks). */
  canAccessIt: boolean;
  children: ReactNode;
}

function initialsOf(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 2).toUpperCase() : "??";
}

export default function AppShell({
  roleLabel,
  username,
  displayName,
  canAccessManage,
  canManageUsers,
  canAccessIt,
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  const generalItems = [
    { href: "/menu", label: "เมนูหลัก", icon: LayoutGrid, active: pathname === "/menu" },
    { href: "/booking", label: "ระบบจองรถ / ห้องประชุม", icon: Calendar, active: pathname.startsWith("/booking") },
  ];

  const registryItems = canAccessManage
    ? [{ href: "/manage", label: "ครุภัณฑ์คอมพิวเตอร์", icon: Package, active: pathname === "/manage" }]
    : [];
  if (canManageUsers) {
    registryItems.push({
      href: "/manage/users",
      label: "จัดการผู้ใช้",
      icon: Users,
      active: pathname.startsWith("/manage/users"),
    });
  }

  const itItems = canAccessIt
    ? [
        {
          href: "/manage/it",
          label: "ระบบงาน IT",
          icon: Wrench,
          active: pathname === "/manage/it" || pathname.startsWith("/manage/it/report"),
        },
        {
          href: "/manage/it/tasks",
          label: "งานบำรุงรักษา",
          icon: ClipboardList,
          active: pathname.startsWith("/manage/it/tasks"),
        },
      ]
    : [];

  const displayText = displayName || username;

  const sidebarBody = (
    <>
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-emerald-800/60 bg-emerald-950 px-6">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--brand)] to-[var(--brand-2)] text-[var(--brand-contrast)]">
          <Hospital size={18} strokeWidth={2} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight text-white">รพ.ท่าตะเกียบ</p>
          <p className="text-[11px] leading-tight text-emerald-300">ระบบบริหารจัดการภายใน</p>
        </div>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        <NavSection label="บริการทั่วไป" items={generalItems} />
        {registryItems.length > 0 && <NavSection label="ทะเบียนครุภัณฑ์" items={registryItems} />}
        {itItems.length > 0 && <NavSection label="งานศูนย์คอมพิวเตอร์ (IT)" items={itItems} />}
      </nav>

      <div className="shrink-0 border-t border-emerald-800/60 px-3 py-3">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-900 hover:text-white"
        >
          <Globe size={14} strokeWidth={2} aria-hidden="true" />
          แดชบอร์ดสาธารณะ
        </Link>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-emerald-800/60 bg-emerald-950/60 p-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--brand)] to-[var(--brand-2)] text-xs font-bold text-white">
            {initialsOf(displayText)}
          </div>
          <div className="min-w-0 text-xs">
            <p className="truncate font-medium text-white">{displayText}</p>
            <span className="mt-0.5 inline-block truncate rounded bg-emerald-800/70 px-1.5 py-0.5 text-[10px] text-emerald-200">
              {roleLabel}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={logout}
          title="ออกจากระบบ"
          className="shrink-0 rounded-lg p-2 text-emerald-300 transition-colors hover:bg-emerald-900 hover:text-rose-300"
        >
          <LogOut size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--page-bg)]">
      {/* Desktop sidebar — persistent, always visible at lg+. */}
      <aside className="app-shell-sidebar hidden w-64 shrink-0 flex-col bg-emerald-950 text-emerald-100 lg:flex">
        {sidebarBody}
      </aside>

      {/* Mobile sidebar — off-canvas drawer, toggled by the topbar's menu
          button below; a backdrop click or the drawer's own X closes it. */}
      {mobileOpen && (
        <div className="app-shell-sidebar fixed inset-0 z-40 flex lg:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative flex w-64 max-w-[80vw] flex-col bg-emerald-950 text-emerald-100 shadow-xl">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="ปิดเมนู"
              className="absolute right-2 top-2 rounded-lg p-2 text-emerald-300 hover:bg-emerald-900 hover:text-white"
            >
              <X size={18} strokeWidth={2} aria-hidden="true" />
            </button>
            {sidebarBody}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Slim mobile-only topbar — the desktop sidebar already carries
            the brand mark + nav, so this only needs to exist below the lg
            breakpoint to expose the drawer toggle. */}
        <div className="app-shell-topbar flex h-14 shrink-0 items-center gap-3 border-b border-zinc-200 bg-white px-4 lg:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="เปิดเมนู"
            className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-100"
          >
            <Menu size={20} strokeWidth={2} aria-hidden="true" />
          </button>
          <span className="text-sm font-semibold text-zinc-800">รพ.ท่าตะเกียบ</span>
        </div>

        <div className="app-shell-scroll flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function NavSection({
  label,
  items,
}: {
  label: string;
  items: { href: string; label: string; icon: typeof LayoutGrid; active: boolean }[];
}) {
  return (
    <div>
      <p className="px-3 pb-2 text-[11px] font-medium uppercase tracking-wider text-emerald-400/80">{label}</p>
      <ul className="space-y-1">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={item.active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  item.active
                    ? "bg-gradient-to-r from-[var(--brand)] to-[var(--brand-2)] text-white shadow-sm"
                    : "text-emerald-200/90 hover:bg-emerald-900 hover:text-white"
                }`}
              >
                <Icon size={16} strokeWidth={2} aria-hidden="true" />
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
