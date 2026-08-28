import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { getUsers } from "@/lib/sheets";
import UsersManager from "@/components/UsersManager";
import type { ManagedUser } from "@/components/UserFormModal";

export const dynamic = "force-dynamic";

export default async function ManageUsersPage() {
  const cookieStore = await cookies();
  const session = verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) {
    redirect("/login?next=/manage/users");
  }
  if (!session.isBootstrap) {
    // Managing users is restricted to the bootstrap account only — even a
    // superadmin created through this same UI can't get in here. Not an
    // authorization bypass either way: /api/manage/users re-checks this
    // itself regardless — this just avoids showing a page that can't do
    // anything for anyone else.
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
      })),
    };
  } catch (err) {
    initial = { error: err instanceof Error ? err.message : String(err) };
  }

  return <UsersManager username={session.username} initial={initial} />;
}
