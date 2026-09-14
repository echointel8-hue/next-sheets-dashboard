import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import MenuHub from "@/components/MenuHub";

// This page is just a small session-gated router in front of a static
// list of links — nothing here needs to be dynamic per se, but every other
// authenticated page in this app is force-dynamic (see /manage,
// /manage/it, /booking) so the session check never gets cached across
// accounts; kept consistent for the same reason.
export const dynamic = "force-dynamic";

/**
 * Landing page after login — a plain choice of which system to open
 * (equipment registry / vehicle booking / meeting-room booking), per the
 * hospital's explicit request instead of dropping straight into one system.
 * Reachable by every logged-in account, any role; each destination card
 * still enforces its own role rules once clicked (e.g. /manage silently
 * redirects an "it" session on to /manage/it — see that page).
 */
export default async function MenuPage() {
  const cookieStore = await cookies();
  const session = verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) {
    redirect("/login?next=/menu");
  }

  return <MenuHub session={session} />;
}
