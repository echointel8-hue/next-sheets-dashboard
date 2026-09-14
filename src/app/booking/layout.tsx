import type { Metadata } from "next";

// Same reasoning as src/app/manage/it/layout.tsx — overrides the root
// layout's browser-tab title just for this subtree.
export const metadata: Metadata = {
  title: "ระบบจองรถ / ห้องประชุม โรงพยาบาลท่าตะเกียบ",
};

export default function BookingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
