import type { NextConfig } from "next";

// Baseline security headers, applied to every response. X-Frame-Options,
// nosniff, Referrer-Policy and Permissions-Policy are safe in dev and
// production alike. The Content-Security-Policy is production-only — the
// Turbopack dev server's own hot-reload client needs allowances a strict
// CSP would fight with, and there's no security benefit to restricting a
// server only ever reached at localhost during development.
const BASE_SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  // Harmless over plain HTTP (browsers ignore it there) and effective once
  // the app is served over HTTPS.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

// One Content-Security-Policy header, one entry per directive — a prior
// hand-edit accidentally listed "script-src" twice and dropped "style-src"
// entirely, which made the browser blank the whole policy's inline
// allowances (visible in devtools as "Ignoring duplicate ... 'script-src'"
// plus every inline style/script call being blocked). Keep this as a single
// source of truth per directive so that can't happen again.
//
// 'unsafe-inline' is required on both directives, not just style-src:
// - style-src: React's inline `style={{...}}` attribute (used throughout
//   Dashboard.tsx and the recharts chart) has no nonce/hash alternative —
//   CSP nonces don't cover the style *attribute*, only <style>/<link> tags.
// - script-src: Next.js's App Router streams Suspense boundaries (this app
//   wraps <DashboardData> in <Suspense>) by pushing RSC flight data through
//   inline <script> tags it injects itself. Without an allowance here those
//   get blocked too, breaking hydration (seen as "Minified React error
//   #412"). The strict, nonce-based version of this is documented at
//   https://nextjs.org/docs/app/guides/content-security-policy but needs a
//   request-scoped nonce via middleware — 'unsafe-inline' is the simpler,
//   still-meaningful tradeoff for an internal hospital-LAN tool: it still
//   blocks loading scripts/styles/fonts/frames from any other origin.
const PRODUCTION_ONLY_HEADERS = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  reactCompiler: true,
  // The dashboard is opened from other computers on the hospital LAN (e.g.
  // http://192.168.10.22:3001), not just localhost. Next.js's dev server
  // blocks cross-origin requests for its own dev-only assets/endpoints
  // (chart JS chunk, HMR websocket) by default — visible in the browser
  // console as "Failed to load resource: 403" and failed "_next/hmr"
  // websocket connections — unless the requesting origin is allowlisted
  // here. Only affects `next dev`; irrelevant to a production build.
  allowedDevOrigins: ["192.168.10.22", "192.168.10.*"],
  async headers() {
    const headers = [...BASE_SECURITY_HEADERS];
    if (process.env.NODE_ENV === "production") {
      headers.push(...PRODUCTION_ONLY_HEADERS);
    }
    return [{ source: "/:path*", headers }];
  },
};

export default nextConfig;
