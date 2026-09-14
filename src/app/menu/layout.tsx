import type { Metadata } from "next";

// Same reasoning as src/app/manage/it/layout.tsx / src/app/booking/layout.tsx
// — overrides the root layout's browser-tab title just for this subtree.
export const metadata: Metadata = {
  title: "เมนูหลัก โรงพยาบาลท่าตะเกียบ",
};

export default function MenuLayout({ children }: { children: React.ReactNode }) {
  return children;
}
