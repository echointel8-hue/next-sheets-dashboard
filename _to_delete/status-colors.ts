// Status → visual role mapping for the equipment dashboard.
// Colors follow the dataviz skill's validated status palette (fixed, never
// themed). The categorical fallback is referenced as CSS custom properties
// (defined in globals.css, swapped per color-scheme) so light/dark tracks
// the OS setting live via CSS — no JS state, no hydration mismatch.

export type StatusRole = "good" | "warning" | "serious" | "critical" | "neutral";

// role hex is mode-invariant (chosen to clear contrast on both surfaces)
export const STATUS_HEX: Record<StatusRole, string> = {
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
  neutral: "#898781",
};

const KEYWORDS: { role: StatusRole; patterns: RegExp }[] = [
  { role: "good", patterns: /พร้อมใช้งาน|พร้อม|ใช้งานได้|ปกติ|available|ready|active|ok\b/i },
  { role: "warning", patterns: /กำลังซ่อม|ซ่อมแซม|รอซ่อม|pending|in.?progress|repair(ing)?/i },
  { role: "critical", patterns: /ชำรุด|เสีย|ยกเลิก|จำหน่ายออก|broken|damaged|discontinued|retired/i },
  { role: "serious", patterns: /ไม่พร้อม|ตรวจสอบ|inspect|review|issue/i },
];

export function classifyStatus(status: string): StatusRole {
  for (const { role, patterns } of KEYWORDS) {
    if (patterns.test(status)) return role;
  }
  return "neutral";
}

// Categorical fallback (fixed order) for statuses that don't match any
// known keyword — e.g. a custom status value from the sheet. These are CSS
// variable references (see globals.css) so they swap for dark mode via CSS
// alone, without any client-side theme detection.
const CATEGORICAL_VARS = [
  "var(--cat-1)",
  "var(--cat-2)",
  "var(--cat-3)",
  "var(--cat-4)",
  "var(--cat-5)",
  "var(--cat-6)",
  "var(--cat-7)",
  "var(--cat-8)",
];

/**
 * Assigns a display color per distinct status label. Known statuses get
 * their semantic status-palette color (mode-invariant hex); unrecognized
 * ones fall back to the fixed categorical CSS-variable order so colors
 * stay stable, colorblind-safe, and theme-aware.
 */
export function buildStatusColorMap(
  statuses: string[]
): Map<string, { color: string; role: StatusRole }> {
  const map = new Map<string, { color: string; role: StatusRole }>();
  let catIndex = 0;
  for (const status of statuses) {
    const role = classifyStatus(status);
    if (role !== "neutral") {
      map.set(status, { color: STATUS_HEX[role], role });
    } else {
      const color = CATEGORICAL_VARS[catIndex % CATEGORICAL_VARS.length];
      catIndex += 1;
      map.set(status, { color, role: "neutral" });
    }
  }
  return map;
}
