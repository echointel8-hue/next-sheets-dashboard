import type { Metadata } from "next";

// Every page under /manage/it (the dashboard, the maintenance report
// builder, the tasks board) is IT's own working area — this overrides the
// root layout's browser-tab title just for that subtree, so the tab reads
// as "their" system rather than the hospital-wide equipment registry title
// used everywhere else (the public dashboard, /manage, /manage/users).
// Nothing else from the root layout's metadata (description, notranslate)
// needs overriding here — Next.js merges those in from the parent.
export const metadata: Metadata = {
  title: "ระบบงาน IT โรงพยาบาลท่าตะเกียบ",
};

export default function ManageItLayout({ children }: { children: React.ReactNode }) {
  return children;
}
