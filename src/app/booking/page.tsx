import { redirect } from "next/navigation";

/**
 * /booking no longer renders anything itself — "จองรถ" and "จองห้องประชุม"
 * are genuinely separate pages/menu items now (see ./car/page.tsx and
 * ./room/page.tsx), not one combined page with an internal switcher, per
 * the hospital's explicit request. This bare route just forwards old links
 * (bookmarks, the previous ?type=car/?type=room query-param form) to the
 * matching new page — proxy.ts's auth gate already covers everything under
 * /booking/, so the target page handles its own session check.
 */
export default async function BookingPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type } = await searchParams;
  redirect(type === "room" ? "/booking/room" : "/booking/car");
}
