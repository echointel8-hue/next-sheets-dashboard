import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
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
