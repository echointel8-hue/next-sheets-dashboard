import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { getBookingResources, getBookings } from "@/lib/sheets";
import BookingDashboard, { type BookingLoadResult } from "@/components/BookingDashboard";

// Always live — see the API routes' own "always live" comments; a page
// load should never show a stale view of what's already booked.
export const dynamic = "force-dynamic";

/** Top-level booking page — reachable by every logged-in account, any
 * role, per the hospital's explicit request (proxy.ts already redirects to
 * /login if there's no session at all; no further role check here). */
export default async function BookingPage() {
  const cookieStore = await cookies();
  const session = verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) {
    redirect("/login?next=/booking");
  }

  let initial: BookingLoadResult;
  try {
    const [resources, bookings] = await Promise.all([getBookingResources(), getBookings()]);
    initial = { resources, bookings };
  } catch (err) {
    initial = { error: err instanceof Error ? err.message : String(err) };
  }

  return <BookingDashboard session={session} initial={initial} />;
}
