import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { getUsers } from "@/lib/sheets";
import UsersManager from "@/components/UsersManager";
import type { ManagedUser } from "@/components/UserFormModal";
import { hasPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function ManageUsersPage() {
  const cookieStore = await cookies();
  const session = verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) {
    redirect("/login?next=/manage/users");
  }
  if (!hasPermission(session, "manageUsers")) {
    // Managing users defaults to the bootstrap account only — even a
    // superadmin created through this same UI can't get in here by default.
    // Now backed by hasPermission()'s "manageUsers" key (lib/permissions.ts)
    // rather than a hardcoded isBootstrap check, so a specific account
    // granted this permission through /manage/users can reach this page too
    // — the same key /api/manage/users itself re-checks regardless, so this
    // redirect is just UI convenience, not the real security boundary.
    redirect("/manage");
  }

  let initial: { users: ManagedUser[] } | { error: string };
  try {
    const users = await getUsers();
    initial = {
      users: users.map((u) => ({
        rowNumber: u.rowNumber,
        username: u.username,
        role: u.role,
        department: u.department,
        displayName: u.displayName,
        active: u.active,
        extraPermissions: u.extraPermissions,
        revokedPermissions: u.revokedPermissions,
      })),
    };
  } catch (err) {
    initial = { error: err instanceof Error ? err.message : String(err) };
  }

  return <UsersManager username={session.username} displayName={session.displayName} initial={initial} />;
}
