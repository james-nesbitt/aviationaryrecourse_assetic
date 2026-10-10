import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { apiGet } from "../lib/api.js";
import { ENTITY_BY_PATH, type EntitySpec } from "../lib/entities.jsx";
import { EmptyState, ExpandableTable } from "../components/index.jsx";

type Row = Record<string, unknown>;

/**
 * Every entity list is this one page driven by the registry: rows expand in
 * place to show more fields and link to that entity's detail page.
 */
export function EntityListPage(): React.ReactElement {
  const { pathname } = useLocation();
  const spec: EntitySpec | undefined = ENTITY_BY_PATH[pathname];
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!spec) return;
    setLoading(true);
    const query = Object.entries(filter)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");
    apiGet<Row[]>(`${spec.endpoint}${query ? `?${query}` : ""}`)
      .then((data) => {
        setRows(data);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [spec, filter]);

  if (!spec) return <EmptyState message={`No entity registered for ${pathname}`} />;
  if (error) return <div style={{ color: "red" }}>Error: {error}</div>;

  const shown = spec.limit ? rows.slice(0, spec.limit) : rows;

  return (
    <div>
      <h1>{spec.label}</h1>
      <div style={{ color: "#666", marginBottom: 12 }}>{spec.blurb}</div>

      {spec.filters?.length ? (
        <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
          {spec.filters.map((f) => (
            <label key={f.param} style={{ fontSize: "0.85rem" }}>
              {f.label}{" "}
              <select
                value={filter[f.param] ?? ""}
                onChange={(e) => setFilter({ ...filter, [f.param]: e.target.value })}
              >
                <option value="">all</option>
                {f.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      ) : null}

      <div style={{ color: "#777", fontSize: "0.85rem", marginBottom: 8 }}>
        {loading ? "Loading…" : `${rows.length} records${shown.length < rows.length ? ` (showing ${shown.length})` : ""}`}
      </div>

      <ExpandableTable
        rows={shown}
        rowKey={spec.rowKey}
        columns={spec.columns}
        expansion={spec.expansion}
        detailPath={spec.detailPath}
        detailLabel={spec.detailLabel ?? "Open"}
        empty={loading ? "Loading…" : "No records"}
      />
    </div>
  );
}
