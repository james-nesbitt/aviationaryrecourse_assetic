import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../lib/api.js";
import { ENTITIES } from "../lib/entities.jsx";
import { Section } from "../components/index.jsx";

/**
 * Admin panel: the entry point to every entity in the system. Each card
 * reports how many records exist and opens that entity's list, where rows
 * expand in place and link on to the individual detail pages.
 */
export function AdminPanelView(): React.ReactElement {
  const [counts, setCounts] = useState<Record<string, number | null>>({});

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      ENTITIES.map(async (e) => {
        try {
          const rows = await apiGet<unknown[]>(e.endpoint);
          return [e.key, Array.isArray(rows) ? rows.length : null] as const;
        } catch {
          return [e.key, null] as const;
        }
      }),
    ).then((pairs) => {
      if (!cancelled) setCounts(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <h1>Admin</h1>
      <div style={{ color: "#666", marginBottom: 20 }}>
        Every entity in the system. Open a list to expand rows in place and reach each
        record's detail page.
      </div>

      <Section title="Entities">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            gap: 12,
          }}
        >
          {ENTITIES.map((e) => (
            <Link
              key={e.key}
              to={e.path}
              style={{
                border: "1px solid #ddd",
                borderRadius: 6,
                padding: "12px 16px",
                background: "#fff",
                textDecoration: "none",
                color: "inherit",
                display: "block",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontWeight: 600 }}>{e.label}</span>
                <span style={{ fontSize: "1.3rem", color: "#1565c0" }}>
                  {counts[e.key] === undefined ? "…" : (counts[e.key] ?? "—")}
                </span>
              </div>
              <div style={{ fontSize: "0.8rem", color: "#777", marginTop: 4 }}>{e.blurb}</div>
            </Link>
          ))}
        </div>
      </Section>

      <Section title="Role dashboards">
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link to="/fleet">Fleet &amp; Maintenance →</Link>
          <Link to="/operations">Operations Control →</Link>
          <Link to="/accounts">Accounts →</Link>
        </div>
      </Section>
    </div>
  );
}
