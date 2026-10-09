import React from "react";
import { Link } from "react-router-dom";
import { STATUS_COLORS } from "../lib/format.js";

/** Headline number with a label, used across the role dashboards. */
export function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: string;
}): React.ReactElement {
  return (
    <div
      style={{
        border: "1px solid #ddd",
        borderRadius: 6,
        padding: "12px 16px",
        minWidth: 150,
        background: "#fff",
      }}
    >
      <div style={{ fontSize: "0.75rem", color: "#666", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: "1.6rem", fontWeight: 600, color: tone ? STATUS_COLORS[tone] : "#222" }}>
        {value}
      </div>
      {sub ? <div style={{ fontSize: "0.8rem", color: "#777" }}>{sub}</div> : null}
    </div>
  );
}

export function Badge({ value }: { value: string }): React.ReactElement {
  const color = STATUS_COLORS[value] ?? "#555";
  return (
    <span
      style={{
        background: color,
        color: "#fff",
        borderRadius: 10,
        padding: "2px 8px",
        fontSize: "0.75rem",
        whiteSpace: "nowrap",
      }}
    >
      {value}
    </span>
  );
}

export function DetailHeader({
  title,
  subtitle,
  backTo,
  backLabel,
}: {
  title: string;
  subtitle?: React.ReactNode;
  backTo: string;
  backLabel: string;
}): React.ReactElement {
  return (
    <div style={{ marginBottom: 16 }}>
      <Link to={backTo} style={{ fontSize: "0.85rem", color: "#1565c0" }}>
        ← {backLabel}
      </Link>
      <h2 style={{ margin: "6px 0 2px" }}>{title}</h2>
      {subtitle ? <div style={{ color: "#666" }}>{subtitle}</div> : null}
    </div>
  );
}

export function EmptyState({ message }: { message: string }): React.ReactElement {
  return <div style={{ color: "#777", padding: "12px 0" }}>{message}</div>;
}

export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: "1rem", marginBottom: 8 }}>{title}</h3>
      {children}
    </section>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
}

/** Plain table with a column spec; keeps every list view consistent. */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  empty = "No records",
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  empty?: string;
}): React.ReactElement {
  if (rows.length === 0) return <EmptyState message={empty} />;
  return (
    <table style={{ borderCollapse: "collapse", width: "100%" }}>
      <thead>
        <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd", color: "#555" }}>
          {columns.map((c) => (
            <th key={c.key} style={{ padding: "8px 12px", fontSize: "0.85rem" }}>
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={rowKey(row)} style={{ borderBottom: "1px solid #eee" }}>
            {columns.map((c) => (
              <td key={c.key} style={{ padding: "8px 12px", fontSize: "0.9rem" }}>
                {c.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Horizontal date-range bars (maintenance windows, assignment intervals). */
export function Timeline({
  items,
}: {
  items: { id: string; label: string; start: string; end: string | null; tone?: string }[];
}): React.ReactElement {
  if (items.length === 0) return <EmptyState message="Nothing scheduled" />;
  const toTime = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`).getTime();
  const starts = items.map((i) => toTime(i.start));
  const ends = items.map((i) => toTime(i.end ?? i.start) + 86_400_000);
  const min = Math.min(...starts);
  const max = Math.max(...ends);
  const span = Math.max(max - min, 1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map((item) => {
        const start = toTime(item.start);
        const end = toTime(item.end ?? item.start) + 86_400_000;
        const left = ((start - min) / span) * 100;
        const width = Math.max(((end - start) / span) * 100, 1.5);
        return (
          <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 190, fontSize: "0.8rem", color: "#555" }}>{item.label}</div>
            <div style={{ position: "relative", flex: 1, height: 16, background: "#f1f1f1", borderRadius: 3 }}>
              <div
                title={`${item.start.slice(0, 10)} → ${item.end?.slice(0, 10) ?? "open"}`}
                style={{
                  position: "absolute",
                  left: `${left}%`,
                  width: `${width}%`,
                  top: 0,
                  bottom: 0,
                  background: STATUS_COLORS[item.tone ?? ""] ?? "#1565c0",
                  borderRadius: 3,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
