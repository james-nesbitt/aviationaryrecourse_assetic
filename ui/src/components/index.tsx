import { ExternalLink } from "lucide-react";
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

export interface DetailTab {
  key: string;
  label: string;
  /** Rendered only while selected, so a tab's queries stay lazy. */
  render: () => React.ReactNode;
  /** Optional count shown beside the label. */
  badge?: number;
}

/**
 * Tab strip for an entity detail page.
 *
 * Every entity has three views: a row view used in list tables, a summary
 * view shown when a list row expands, and this detail view. The detail view
 * is a shell rather than a fixed layout: "Overview" carries the identifying
 * facts, and further tabs hold the per-entity views — history, statistics,
 * manifests, management actions — so entity-specific views can be added
 * later without changing navigation or the list pattern.
 */
export function DetailTabs({ tabs }: { tabs: DetailTab[] }): React.ReactElement {
  const [active, setActive] = React.useState(tabs[0]?.key ?? "");
  const current = tabs.find((t) => t.key === active) ?? tabs[0];

  return (
    <div>
      <div
        role="tablist"
        style={{ display: "flex", gap: 4, borderBottom: "1px solid #ddd", marginBottom: 16 }}
      >
        {tabs.map((tab) => {
          const selected = tab.key === current?.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActive(tab.key)}
              style={{
                border: "none",
                borderBottom: selected ? "2px solid #1565c0" : "2px solid transparent",
                background: "none",
                padding: "8px 14px",
                cursor: "pointer",
                fontSize: "0.9rem",
                color: selected ? "#1565c0" : "#555",
                fontWeight: selected ? 600 : 400,
              }}
            >
              {tab.label}
              {tab.badge !== undefined ? (
                <span style={{ color: "#888", marginLeft: 6 }}>{tab.badge}</span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div role="tabpanel">{current?.render()}</div>
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

/** Label/value pairs; the standard body of an expanded list row. */
export function FieldGrid({
  fields,
}: {
  fields: { label: string; value: React.ReactNode }[];
}): React.ReactElement {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
        gap: "8px 24px",
      }}
    >
      {fields.map((f) => (
        <div key={f.label}>
          <div style={{ fontSize: "0.72rem", color: "#777", textTransform: "uppercase" }}>{f.label}</div>
          <div style={{ fontSize: "0.9rem" }}>{f.value ?? "—"}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * List table where every row expands in place to show more fields and links
 * to that entity's detail page. This is the standard list pattern: the
 * summary columns identify the row, the expansion answers "what is this"
 * without navigating, and the detail link opens the full dashboard.
 */
export function ExpandableTable<T>({
  rows,
  columns,
  rowKey,
  detailPath,
  expansion,
  empty = "No records",
  detailLabel = "Open",
  rowActions,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  /** Omitted for reference entities that have no detail page of their own. */
  detailPath?: (row: T) => string;
  expansion: (row: T) => { label: string; value: React.ReactNode }[];
  empty?: string;
  detailLabel?: string;
  /** CRUD affordances rendered in their own cell; click-stopped from row expand. */
  rowActions?: (row: T) => React.ReactNode;
}): React.ReactElement {
  const [expanded, setExpanded] = React.useState<string | null>(null);
  if (rows.length === 0) return <EmptyState message={empty} />;

  return (
    <table style={{ borderCollapse: "collapse", width: "100%" }}>
      <thead>
        <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd", color: "#555" }}>
          <th style={{ padding: "8px 12px", width: 28 }} aria-label="expand" />
          {columns.map((c) => (
            <th key={c.key} style={{ padding: "8px 12px", fontSize: "0.85rem" }}>
              {c.header}
            </th>
          ))}
          {detailPath ? <th style={{ padding: "8px 12px", fontSize: "0.85rem" }}>Detail</th> : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const key = rowKey(row);
          const isOpen = expanded === key;
          return (
            <React.Fragment key={key}>
              <tr
                onClick={() => setExpanded(isOpen ? null : key)}
                style={{ borderBottom: "1px solid #eee", cursor: "pointer" }}
              >
                <td style={{ padding: "8px 12px", color: "#888" }} aria-label={isOpen ? "collapse" : "expand"}>
                  {isOpen ? "▾" : "▸"}
                </td>
                {columns.map((c) => (
                  <td key={c.key} style={{ padding: "8px 12px", fontSize: "0.9rem" }}>
                    {c.render(row)}
                  </td>
                ))}
                {detailPath ? (
                  <td style={{ padding: "8px 12px", fontSize: "0.9rem" }} onClick={(e) => e.stopPropagation()}>
                    <Link to={detailPath(row)} title={`${detailLabel} detail`} aria-label={`${detailLabel} detail`}>
                      <ExternalLink size={16} style={{ verticalAlign: "text-bottom" }} />
                    </Link>
                  </td>
                ) : null}
                {rowActions ? (
                  <td
                    style={{ padding: "8px 12px", display: "flex", gap: 10, alignItems: "center" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {rowActions(row)}
                  </td>
                ) : null}
              </tr>
              {isOpen ? (
                <tr>
                  <td colSpan={columns.length + (detailPath ? 2 : 1)} style={{ padding: "12px 16px", background: "#f9f9f9" }}>
                    <FieldGrid fields={expansion(row)} />
                    {detailPath ? (
                      <div style={{ marginTop: 10 }}>
                        <Link to={detailPath(row)} title={`${detailLabel} detail`} aria-label={`${detailLabel} detail`}>
                          <ExternalLink size={16} style={{ verticalAlign: "text-bottom", marginRight: 6 }} />
                          {detailLabel}
                        </Link>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ) : null}
            </React.Fragment>
          );
        })}
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
