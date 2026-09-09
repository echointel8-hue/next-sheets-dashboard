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

/** Builds a name -> color map from the canonical, ordered
 * ReportSettings.actionOptions list — index-based (first item gets slot 1,
 * etc.), so a color only ever changes if the list itself is reordered or an
 * earlier entry is removed — both of which are restricted to the bootstrap
 * account (see /api/manage/it/settings). Blank entries (a not-yet-named row
 * mid-edit in the settings modal) are skipped so they don't consume a color
 * slot or shift later entries' colors. */
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

/** CSS custom properties for one action-color swatch/segment — pair with
 * className="bg-[var(--seg-c)] dark:bg-[var(--seg-c-dark)]" (a static
 * Tailwind arbitrary-value class works the same for every element; only the
 * variable's actual value changes per element via this inline style). */
export function actionColorVars(color: ActionColor): Record<string, string> {
  return { "--seg-c": color.light, "--seg-c-dark": color.dark };
}
