import LoginForm from "@/components/LoginForm";

// Reads the request's search params fresh every time — nothing here should
// ever be prerendered/cached.
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // Only accept an in-app path — a "next" value like "https://evil.example"
  // would otherwise turn this into an open redirect. Falls back to /menu —
  // the post-login system-choice page — rather than straight into /manage,
  // per the hospital's explicit request; a deep link into a specific
  // protected page (proxy.ts redirecting to /login?next=...) still lands
  // back on that exact page after login, unaffected by this default.
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/menu";

  return <LoginForm next={safeNext} />;
}
