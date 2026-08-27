import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_Thai } from "next/font/google";
import "./globals.css";

// Inter covers the Latin glyphs (numbers, "Desktop PC"-style labels) with
// the crisp, modern grotesque look common to polished dashboard UIs; Noto
// Sans Thai is Google's own purpose-built Thai UI typeface — properly
// designed Thai letterforms instead of the plain system-fallback look Thai
// text got when the body font was hard-coded to Arial. Listed together in
// body's font-family below, the browser picks per-glyph: Inter renders
// anything it has (Latin/numerals), Noto Sans Thai covers the rest — no
// visible seam between scripts. Both are open-licensed Google Fonts, not
// anything lifted from a particular product's own (usually proprietary)
// typeface.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const notoSansThai = Noto_Sans_Thai({
  variable: "--font-noto-thai",
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "ทะเบียนครุภัณฑ์คอมพิวเตอร์ โรงพยาบาลท่าตะเกียบ",
  description: "ระบบติดตามและค้นหาข้อมูลครุภัณฑ์คอมพิวเตอร์ โรงพยาบาลท่าตะเกียบ จากแบบฟอร์มลงทะเบียน",
};

// Explicit viewport config (Next.js sets a sensible default automatically,
// but declaring it keeps mobile scaling behavior obvious and auditable).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="th"
      className={`${inter.variable} ${notoSansThai.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Skip link: hidden until keyboard-focused, lets keyboard/screen-reader
            users jump past the header straight to the dashboard content. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-[var(--brand)] focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-[var(--brand-contrast)] focus:outline-none focus:ring-2 focus:ring-offset-2"
        >
          ข้ามไปยังเนื้อหาหลัก
        </a>
        {children}
      </body>
    </html>
  );
}
