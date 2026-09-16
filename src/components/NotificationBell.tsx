"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Check, Loader2, X as XIcon } from "lucide-react";
import { formatBookingDateTime, isBookingCancelled, type Booking } from "@/lib/booking";

// No websocket/push available — the backend is Google Sheets, read on
// every request — so "live" here means polling. True real-time would need
// an external pub/sub service (Pusher/Ably/Supabase Realtime etc.), which
// needs its own account + API keys; per explicit choice, faster polling is
// the tradeoff instead — every 15 seconds, still per authenticated screen
// (this mounts once per session via AppShell) rather than a true push.
const POLL_INTERVAL_MS = 15_000;
const TOAST_DURATION_MS = 6000;

interface Toast {
  id: string;
  text: string;
}

/**
 * Bell notification for pending car-booking approvals — shown only to
 * superadmin accounts (see canApproveCarBooking in lib/booking.ts; the
 * `enabled` prop is computed by each AppShell caller from its own
 * session/currentUser). Mounted once inside AppShell so it keeps polling
 * and can pop a toast no matter which authenticated page is open,
 * including right after login (the first poll's already-pending count
 * summarizes as a toast too) and while the app is left open on any screen.
 *
 * Reuses the existing GET /api/booking/bookings list (already used by
 * BookingDashboard) rather than a dedicated endpoint — filtered
 * client-side to car + pending + not cancelled — and the existing PATCH
 * /api/booking/bookings/[bookingId] for the approve/reject buttons in the
 * panel, so no new server-side surface was needed for this feature.
 *
 * Per explicit scope choices: no persisted notification history — "seen"
 * bookingIds live only in this tab's memory for this session, and the
 * panel always shows exactly "what's pending right now" (scrollable if
 * there are several), not a permanent log of past decisions.
 */
export default function NotificationBell({ enabled }: { enabled: boolean }) {
  const [pending, setPending] = useState<Booking[]>([]);
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [actingId, setActingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // null = no poll has completed yet, so the very first result is treated
  // as "what's already waiting" (one summary toast) rather than diffed
  // against an empty set (which would also work, but this reads clearer).
  const seenIds = useRef<Set<string> | null>(null);

  const pushToast = useCallback((text: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((prev) => [...prev, { id, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_DURATION_MS);
  }, []);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/booking/bookings", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const bookings: Booking[] = Array.isArray(data.bookings) ? data.bookings : [];
      const stillPending = bookings
        .filter((b) => b.resourceType === "car" && b.approvalStatus === "pending" && !isBookingCancelled(b))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      const currentIds = new Set(stillPending.map((b) => b.bookingId));
      if (seenIds.current) {
        const newOnes = stillPending.filter((b) => !seenIds.current!.has(b.bookingId));
        if (newOnes.length === 1) {
          const requester = newOnes[0].bookedByDisplayName || newOnes[0].bookedByUsername;
          pushToast(`มีรายการจองรถรออนุมัติใหม่: ${newOnes[0].resourceName} (${requester})`);
        } else if (newOnes.length > 1) {
          pushToast(`มีรายการจองรถรออนุมัติใหม่ ${newOnes.length} รายการ`);
        }
      } else if (stillPending.length > 0) {
        pushToast(
          stillPending.length === 1
            ? "มีรายการจองรถรออนุมัติ 1 รายการ"
            : `มีรายการจองรถรออนุมัติ ${stillPending.length} รายการ`
        );
      }
      seenIds.current = currentIds;
      setPending(stillPending);
    } catch {
      // Best-effort — a transient poll failure just tries again next
      // interval, same philosophy as other background refreshes here.
    }
  }, [pushToast]);

  useEffect(() => {
    if (!enabled) return;
    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [enabled, poll]);

  async function decide(bookingId: string, approvalStatus: "approved" | "rejected") {
    setActingId(bookingId);
    setActionError(null);
    try {
      const res = await fetch(`/api/booking/bookings/${bookingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalStatus }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || "เกิดข้อผิดพลาด");
        return;
      }
      setPending((prev) => prev.filter((b) => b.bookingId !== bookingId));
      seenIds.current?.delete(bookingId);
    } catch {
      setActionError("เกิดข้อผิดพลาดในการเชื่อมต่อ");
    } finally {
      setActingId(null);
    }
  }

  if (!enabled) return null;

  return (
    <>
      {/* Fixed, not embedded in the sidebar/topbar markup, so the same
          trigger appears in a stable spot across both the desktop sidebar
          layout and the mobile topbar without duplicating it in each. On
          mobile it sits just below the 56px topbar; on desktop (no topbar)
          it sits near the very top of the viewport instead. */}
      <div className="fixed right-3 top-[68px] z-50 lg:right-4 lg:top-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="การแจ้งเตือนรายการรออนุมัติ"
          className="relative flex h-10 w-10 items-center justify-center rounded-full border border-emerald-900/10 bg-white text-zinc-600 shadow-sm transition-colors hover:bg-emerald-50 hover:text-emerald-700 dark:border-emerald-400/10 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-emerald-950/40"
        >
          <Bell size={18} strokeWidth={2} aria-hidden="true" />
          {pending.length > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
              {pending.length > 99 ? "99+" : pending.length}
            </span>
          )}
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
            <div className="absolute right-0 z-50 mt-2 w-[22rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl border border-emerald-900/10 bg-white shadow-xl dark:border-emerald-400/10 dark:bg-zinc-900">
              <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
                <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">การจองรถรออนุมัติ</span>
                <span className="text-xs text-zinc-400 dark:text-zinc-500">{pending.length} รายการ</span>
              </div>
              {actionError && <p className="px-4 py-2 text-xs text-red-600 dark:text-red-400">{actionError}</p>}
              <div className="max-h-[22rem] overflow-y-auto p-2">
                {pending.length === 0 ? (
                  <p className="px-3 py-6 text-center text-sm text-zinc-400 dark:text-zinc-500">
                    ไม่มีรายการรออนุมัติ
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {pending.map((b) => (
                      <li key={b.bookingId} className="rounded-xl border border-zinc-100 p-3 dark:border-zinc-800">
                        <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{b.resourceName}</p>
                        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                          {formatBookingDateTime(b.startTime)} – {formatBookingDateTime(b.endTime)}
                        </p>
                        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                          {b.bookedByDisplayName || b.bookedByUsername}
                          {b.department ? ` · ${b.department}` : ""}
                        </p>
                        {b.purpose && <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">{b.purpose}</p>}
                        <div className="mt-2 flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => decide(b.bookingId, "approved")}
                            disabled={actingId === b.bookingId}
                            className="inline-flex items-center gap-1 rounded-full border border-emerald-200 px-2 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-50 disabled:opacity-60 dark:border-emerald-900/50 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
                          >
                            {actingId === b.bookingId ? (
                              <Loader2 size={12} strokeWidth={2} className="animate-spin" aria-hidden="true" />
                            ) : (
                              <Check size={12} strokeWidth={2} aria-hidden="true" />
                            )}
                            อนุมัติ
                          </button>
                          <button
                            type="button"
                            onClick={() => decide(b.bookingId, "rejected")}
                            disabled={actingId === b.bookingId}
                            className="inline-flex items-center gap-1 rounded-full border border-red-200 px-2 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-60 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/30"
                          >
                            <XIcon size={12} strokeWidth={2} aria-hidden="true" />
                            ไม่อนุมัติ
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Toast stack — independent of the panel above (visible whether or
          not it's open) so a new pending request is noticed even while the
          admin is looking at something else entirely. */}
      <div className="fixed bottom-4 right-4 z-50 flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setOpen(true);
              setToasts((prev) => prev.filter((x) => x.id !== t.id));
            }}
            className="flex items-start gap-2 rounded-xl border border-emerald-900/10 bg-white px-4 py-3 text-left text-sm text-zinc-700 shadow-lg dark:border-emerald-400/10 dark:bg-zinc-900 dark:text-zinc-200"
          >
            <Bell
              size={16}
              strokeWidth={2}
              className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400"
              aria-hidden="true"
            />
            <span>{t.text}</span>
          </button>
        ))}
      </div>
    </>
  );
}
