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
          <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={18} maxBarSize={22}>
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
