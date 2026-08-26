// Categorical color assignment for equipment-type breakdowns.
// Colors are CSS custom properties (see globals.css) so light/dark tracks
// the OS setting via CSS alone — no JS state needed.

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

// Shared color for anything beyond the 8 categorical slots (folded into
// "Other") and for values with no color assigned.
export const OTHER_COLOR = "var(--chart-text-muted)";

/**
 * Assigns a stable color to each label in `orderedLabels` (already ranked,
 * most important/frequent first) — up to the categorical palette's 8 slots.
 * Compute this once from the FULL, unfiltered dataset so a label's color
 * never changes when a filter narrows what's on screen (color follows the
 * entity, never its rank). Labels beyond the 8th get no entry — the caller
 * folds them into an "Other" bucket colored with OTHER_COLOR.
 */
export function assignCategoryColors(orderedLabels: string[]): Map<string, string> {
  const map = new Map<string, string>();
  orderedLabels.slice(0, CATEGORICAL_VARS.length).forEach((label, i) => {
    map.set(label, CATEGORICAL_VARS[i]);
  });
  return map;
}
