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
  // would otherwise turn this into an open redirect.
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/manage";

  return <LoginForm next={safeNext} />;
}
