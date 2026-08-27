"use client";

import { useEffect, useRef, useState, type JSX } from "react";
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { OTHER_COLOR } from "@/lib/category-colors";

// Generic horizontal-bar breakdown: used for both the equipment-type chart
// and the department chart in Dashboard.tsx — same shape (label + count),
// different data and color map per chart.
export interface BreakdownEntry {
  label: string;
  count: number;
}

// Rough average pixel width of one character at the 15px tick font below
// (Arial/Helvetica) — used to decide how many characters fit on one tick
// line before wrapping. Thai combining vowel/tone marks count as extra
// characters in `.length` but add ~no visual width of their own, so this
// slightly *overestimates* — a safe direction to be wrong in (a bit of
// extra wrap headroom beats a name getting cut off, which was the actual
// bug: full department names were being clipped by the chart's edge).
const CHARS_TO_PX = 9.2;
const MIN_LABEL_WIDTH = 150;
const MAX_LABEL_WIDTH = 440;
// Leave at least this much room for the bars + count labels themselves,
// even on a narrow phone screen, rather than letting the label column
// swallow the whole chart.
const MIN_PLOT_WIDTH = 140;
const MIN_CHARS_PER_LINE = 8;
// Generous on purpose — the row height below already grows to fit however
// many lines a label actually needs, so this cap only exists as a last-
// resort safety net against a pathologically long string. It should never
// be the reason a real department/equipment-type name gets cut off.
const MAX_TICK_LINES = 6;
const TICK_LINE_HEIGHT = 17;
const TICK_FONT_SIZE = 15;

/** Tracks a wrapper element's rendered width so the label column can be
 * sized relative to the actual chart width (ResponsiveContainer only knows
 * that at render time) instead of one fixed guess that's too cramped on
 * desktop or too wide on mobile. */
function useContainerWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Hard-wraps a label into at most `maxLines` lines of ~`maxCharsPerLine`
 * characters each. Thai script commonly has no spaces to break on at all
 * (see the department names in this dashboard), so this wraps on a plain
 * character count rather than word boundaries — occasionally splitting
 * mid-word, which is a fair trade for a chart label that must never be cut
 * off outright. If a label is so long it still doesn't fit in maxLines,
 * the last line is ellipsized as a last resort (not expected in practice
 * for a department/equipment-type name). */
function wrapLabel(label: string, maxCharsPerLine: number, maxLines: number): string[] {
  const trimmed = label.trim();
  if (trimmed.length <= maxCharsPerLine) return [trimmed];

  const lines: string[] = [];
  let rest = trimmed;
  while (rest.length > maxCharsPerLine && lines.length < maxLines - 1) {
    lines.push(rest.slice(0, maxCharsPerLine));
    rest = rest.slice(maxCharsPerLine);
  }
  if (rest.length > maxCharsPerLine) {
    rest = `${rest.slice(0, Math.max(1, maxCharsPerLine - 1))}…`;
  }
  lines.push(rest);
  return lines;
}

function DepartmentAxisTick(props: {
  x?: number;
  y?: number;
  payload?: { value?: string | number };
  charsPerLine: number;
}): JSX.Element {
  const { x = 0, y = 0, payload, charsPerLine } = props;
  const label = String(payload?.value ?? "");
  const lines = wrapLabel(label, charsPerLine, MAX_TICK_LINES);
  const centeringOffset = -((lines.length - 1) * TICK_LINE_HEIGHT) / 2;
  return (
    <text x={x} y={y} textAnchor="end" fill="var(--chart-text-muted)" fontSize={TICK_FONT_SIZE}>
      {lines.map((line, i) => (
        <tspan key={i} x={x} dy={i === 0 ? centeringOffset + 5 : TICK_LINE_HEIGHT}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

// Split into its own chunk (loaded via next/dynamic in Dashboard.tsx) so the
// recharts bundle only downloads/parses once this chart is actually needed,
// instead of blocking the dashboard's initial JS payload.
export default function TypeBreakdownChart({
  data,
  colorMap,
}: {
  data: BreakdownEntry[];
  colorMap: Map<string, string>;
}) {
  const [containerRef, containerWidth] = useContainerWidth();

  // Size the label column to fit the single longest label on one line when
  // there's room — on desktop this means every department/type name shows
  // whole, on one line, exactly as it reads in the sheet. On a narrow phone
  // screen the column is capped well below that so it doesn't swallow the
  // whole chart; whatever doesn't fit on one line at that narrower width
  // then *wraps* (see DepartmentAxisTick) instead of being clipped, so a
  // name is never simply missing regardless of screen size.
  const longestLabelLength = data.reduce((max, d) => Math.max(max, d.label.length), 0);
  const desiredLabelWidth = Math.round(longestLabelLength * CHARS_TO_PX) + 24;
  const maxAllowedByContainer =
    containerWidth > 0 ? Math.max(MIN_LABEL_WIDTH, containerWidth - MIN_PLOT_WIDTH) : MAX_LABEL_WIDTH;
  const labelWidth = Math.min(
    Math.max(desiredLabelWidth, MIN_LABEL_WIDTH),
    MAX_LABEL_WIDTH,
    maxAllowedByContainer
  );
  const charsPerLine = Math.max(MIN_CHARS_PER_LINE, Math.floor((labelWidth - 10) / CHARS_TO_PX));

  // How many lines the tallest wrapped label needs, so every row gets
  // enough vertical room — Recharts gives every category the same band
  // height, so this has to be sized for the worst case in the data set.
  const maxLinesNeeded = data.reduce(
    (max, d) => Math.max(max, wrapLabel(d.label, charsPerLine, MAX_TICK_LINES).length),
    1
  );
  const rowHeight = Math.max(48, maxLinesNeeded * TICK_LINE_HEIGHT + 22);

  return (
    <div ref={containerRef} style={{ height: Math.max(140, data.length * rowHeight) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 40, bottom: 4, left: 4 }}
          barCategoryGap={10}
        >
          {/* Referenced by name below — a left-to-right gradient within the
              brand hue (never a second hue), for charts where every bar
              shares one color and a flat fill would otherwise read as
              plain/dull. Uses a wider-spread token pair than --brand/
              --brand-strong — at bar-sized fills, that pair's ~2-step
              lightness gap reads as essentially flat. */}
          <defs>
            <linearGradient id="brandBarGradient" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--brand-bar-from)" />
              <stop offset="100%" stopColor="var(--brand-bar-to)" />
            </linearGradient>
          </defs>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="label"
            width={labelWidth}
            tickLine={false}
            axisLine={false}
            interval={0}
            tick={<DepartmentAxisTick charsPerLine={charsPerLine} />}
          />
          <Tooltip
            cursor={{ fill: "color-mix(in srgb, var(--chart-text-muted) 8%, transparent)" }}
            contentStyle={{
              borderRadius: 12,
              border: "1px solid var(--chart-border)",
              background: "var(--chart-surface)",
              color: "var(--chart-text-secondary)",
              fontSize: 14,
            }}
            formatter={(value) => [
              typeof value === "number" ? value.toLocaleString("th-TH") : String(value ?? ""),
              "จำนวน",
            ]}
          />
          <Bar
            dataKey="count"
            radius={[0, 4, 4, 0]}
            barSize={20}
            maxBarSize={26}
            // A faint full-width track behind every bar (same treatment as
            // the Meter pattern: a lighter step of the same neutral used for
            // the hover cursor above) so bars read against a baseline instead
            // of floating in blank space — decorative, identical for every
            // bar, carries no data of its own.
            background={{ fill: "color-mix(in srgb, var(--chart-text-muted) 8%, transparent)", radius: 4 }}
          >
            {data.map((d) => (
              <Cell key={d.label} fill={colorMap.get(d.label) ?? OTHER_COLOR} />
            ))}
            <LabelList
              dataKey="count"
              position="right"
              formatter={(v) => (typeof v === "number" ? v.toLocaleString("th-TH") : String(v ?? ""))}
              style={{ fill: "var(--chart-text-secondary)", fontSize: 15, fontWeight: 600 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
