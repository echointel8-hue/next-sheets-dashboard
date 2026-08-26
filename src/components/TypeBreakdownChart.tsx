"use client";

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
  return (
    <div style={{ height: Math.max(120, data.length * 40) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 32, bottom: 4, left: 4 }}
          barCategoryGap={8}
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
            width={160}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--chart-text-muted)", fontSize: 12 }}
          />
          <Tooltip
            cursor={{ fill: "color-mix(in srgb, var(--chart-text-muted) 8%, transparent)" }}
            contentStyle={{
              borderRadius: 12,
              border: "1px solid var(--chart-border)",
              background: "var(--chart-surface)",
              color: "var(--chart-text-secondary)",
              fontSize: 12,
            }}
            formatter={(value) => [
              typeof value === "number" ? value.toLocaleString("th-TH") : String(value ?? ""),
              "จำนวน",
            ]}
          />
          <Bar
            dataKey="count"
            radius={[0, 4, 4, 0]}
            barSize={18}
            maxBarSize={22}
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
              style={{ fill: "var(--chart-text-secondary)", fontSize: 12, fontWeight: 500 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
