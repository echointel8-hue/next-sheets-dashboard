import LoginForm from "@/components/LoginForm";

// Every login always lands on /menu — the post-login system-choice page —
// regardless of which URL the browser happened to be on when it hit the
// login gate (a bookmarked /manage link, an idle-session bounce-back from
// /booking, or just /login itself). This used to preserve a "next" deep
// link (proxy.ts still attaches ?next=... when it redirects an
// unauthenticated request here) so a session that expired mid-work on
// /manage would land back on /manage after logging back in — but the
// hospital found that surprising in practice (any bookmarked /manage URL
// skipped the new menu entirely) and asked for the simpler, unconditional
// behavior instead. Deliberately ignores any "next" search param rather
// than reading it — see proxy.ts's own comment on why it's harmless that
// it's still attached.
export default function LoginPage() {
  return <LoginForm next="/menu" />;
}
