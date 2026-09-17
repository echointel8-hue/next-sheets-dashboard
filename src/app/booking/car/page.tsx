import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { getBookingResources, getBookings, getTripOrders } from "@/lib/sheets";
import BookingDashboard, { type BookingLoadResult } from "@/components/BookingDashboard";

// Overrides ../layout.tsx's generic booking-subtree title with this page's
// own, same as every other subroute's layout override in this app.
export const metadata: Metadata = {
  title: "ระบบจองรถ โรงพยาบาลท่าตะเกียบ",
};

// Always live — see the API routes' own "always live" comments; a page
// load should never show a stale view of what's already booked.
export const dynamic = "force-dynamic";

/** จองรถ — reachable by every logged-in account, any role, per the
 * hospital's explicit request (proxy.ts already redirects to /login if
 * there's no session at all; no further role check here for *viewing* or
 * *booking*). Genuinely separate from /booking/room now — see that page's
 * own comment and BookingDashboard's. */
export default async function BookingCarPage() {
  const cookieStore = await cookies();
  const session = verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) {
    redirect("/login");
  }

  let initial: BookingLoadResult;
  try {
    const [resources, bookings, tripOrders] = await Promise.all([
      getBookingResources(),
      getBookings(),
      getTripOrders(),
    ]);
    initial = { resources, bookings, tripOrders };
  } catch (err) {
    initial = { error: err instanceof Error ? err.message : String(err) };
  }

  return <BookingDashboard session={session} initial={initial} type="car" />;
}
