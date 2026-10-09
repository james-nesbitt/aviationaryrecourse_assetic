import React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { STATUS_COLORS } from "../lib/format.js";

/**
 * Thin recharts wrappers. Views pass plain data and never import recharts, so
 * the charting library stays replaceable and the views stay testable.
 */

const PALETTE = ["#1565c0", "#2e7d32", "#ef6c00", "#6a1b9a", "#c62828", "#00838f"];

export function LineTrend({
  data,
  xKey,
  series,
  height = 220,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  series: { key: string; label: string }[];
  height?: number;
}): React.ReactElement {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
        <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        {series.length > 1 ? <Legend /> : null}
        {series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={PALETTE[i % PALETTE.length]}
            dot={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function BarStack({
  data,
  xKey,
  series,
  height = 240,
  stacked = true,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  series: { key: string; label: string }[];
  height?: number;
  stacked?: boolean;
}): React.ReactElement {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
        <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        <Legend />
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            stackId={stacked ? "a" : undefined}
            fill={STATUS_COLORS[s.key] ?? PALETTE[i % PALETTE.length]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DonutBreakdown({
  data,
  height = 220,
}: {
  data: { name: string; value: number }[];
  height?: number;
}): React.ReactElement {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%">
          {data.map((entry, i) => (
            <Cell key={entry.name} fill={STATUS_COLORS[entry.name] ?? PALETTE[i % PALETTE.length]} />
          ))}
        </Pie>
        <Tooltip />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}
