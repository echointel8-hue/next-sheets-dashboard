// Shared "การดำเนินการ" (maintenance action) categorical color logic —
// used by both /manage/it/report (MaintenanceReportBuilder: month-strip
// segments, legend, settings-modal swatches) and /manage/it/tasks
// (MaintenanceTasksBoard: the action picker in TaskUpdateModal), so a given
// action text always renders in the exact same color everywhere in the app.
// Pure/no external deps (same convention as fields.ts), safe to import from
// client or server code.

export type ActionColor = { light: string; dark: string };

/** Fixed, colorblind-validated categorical order (8 hues, from the
 * dataviz skill's reference palette — worst-case CVD ΔE 9.1 light / 8.4
 * dark, both well clear of the >=8 target) used to color each distinct
 * "การดำเนินการ" text automatically — never picked by hand, never
 * re-cycled, so a color always means the same action everywhere it
 * appears. A 9th-and-later distinct action folds into ACTION_OTHER_COLOR
 * instead of generating a new hue, since colorblind-safe categorical
 * palettes top out around 8 distinguishable steps. */
export const ACTION_COLOR_PALETTE: ActionColor[] = [
  { light: "#2a78d6", dark: "#3987e5" }, // blue
  { light: "#eb6834", dark: "#d95926" }, // orange
  { light: "#1baf7a", dark: "#199e70" }, // aqua
  { light: "#eda100", dark: "#c98500" }, // yellow
  { light: "#e87ba4", dark: "#d55181" }, // magenta
  { light: "#008300", dark: "#008300" }, // green
  { light: "#4a3aa7", dark: "#9085e9" }, // violet
  { light: "#e34948", dark: "#e66767" }, // red
];

/** Deliberately neutral/gray — never impersonates one of the 8 real
 * categorical colors above — used once a 9th distinct action shows up. */
export const ACTION_OTHER_COLOR: ActionColor = { light: "#a1a1aa", dark: "#71717a" };

/** Builds a name -> color map from an ordered list of action names —
 * index-based (first item gets slot 1, etc.), so a color only changes if
 * this list's order/membership itself changes. Callers that want a color
 * to survive a plain reorder of ReportSettings.actionOptions (the
 * up/down-arrow buttons in the settings list) should pass
 * resolveColorOrder(actionOptions, actionColorOrder) here instead of
 * actionOptions directly — see that function below for why a separate
 * order is needed. Blank entries (a not-yet-named row mid-edit in the
 * settings modal) are skipped so they don't consume a color slot or shift
 * later entries' colors. */
export function buildActionColorMap(actionOptions: string[]): Map<string, ActionColor> {
  const map = new Map<string, ActionColor>();
  let idx = 0;
  for (const raw of actionOptions) {
    const name = raw.trim();
    if (!name || map.has(name)) continue;
    map.set(name, ACTION_COLOR_PALETTE[idx] ?? ACTION_OTHER_COLOR);
    idx += 1;
  }
  return map;
}

/** Looks up one action's color, falling back to ACTION_OTHER_COLOR for
 * anything not in the map (e.g. a legacy actionsTaken value recorded before
 * this feature, or before the text was renamed). */
export function colorForAction(map: Map<string, ActionColor>, name: string): ActionColor {
  return map.get(name.trim()) ?? ACTION_OTHER_COLOR;
}

/** The order buildActionColorMap should actually assign colors in — NOT the
 * same as the live, ordered ReportSettings.actionOptions list (which also
 * drives display/print order and can be freely reordered with the
 * up/down-arrow buttons in the settings list), but the separately
 * persisted ReportSettings.actionColorOrder, which only changes when a name
 * is truly added or removed. Reordering actionOptions alone
 * (moveActionOption in MaintenanceReportBuilder) never touches
 * actionColorOrder, so an entry keeps the exact color it already had no
 * matter where it's moved to — only a genuinely new name (first time it's
 * ever been saved) gets appended at the end and picks up the next open
 * color slot; a name removed from actionOptions drops out here too, so
 * later names shift up and reclaim that slot, same as this always behaved
 * before actionColorOrder existed. A rename (editing an existing entry's
 * text in place) is treated as removing the old name and adding a new one
 * — same convention this app already uses for hiddenActionOptions/
 * detailRequiredActionOptions, which are also keyed by exact name text, not
 * array position.
 *
 * Safe to call with an empty/stale colorOrder (e.g. a ReportSettings tab
 * saved before this field existed) — every actionOptions name just falls
 * through to being treated as new and gets appended in actionOptions' own
 * order, matching the original index-based behavior exactly for anyone who
 * hasn't touched anything since. */
export function resolveColorOrder(actionOptions: string[], colorOrder: string[]): string[] {
  const live = new Set<string>();
  const cleanedOptions: string[] = [];
  for (const raw of actionOptions) {
    const name = raw.trim();
    if (!name || live.has(name)) continue;
    live.add(name);
    cleanedOptions.push(name);
  }
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const raw of colorOrder) {
    const name = raw.trim();
    if (!name || seen.has(name) || !live.has(name)) continue;
    seen.add(name);
    ordered.push(name);
  }
  for (const name of cleanedOptions) {
    if (!seen.has(name)) {
      seen.add(name);
      ordered.push(name);
    }
  }
  return ordered;
}

/** CSS custom properties for one action-color swatch/segment — pair with
 * className="bg-[var(--seg-c)] dark:bg-[var(--seg-c-dark)]" (a static
 * Tailwind arbitrary-value class works the same for every element; only the
 * variable's actual value changes per element via this inline style). */
export function actionColorVars(color: ActionColor): Record<string, string> {
  return { "--seg-c": color.light, "--seg-c-dark": color.dark };
}
