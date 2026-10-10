import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { apiDelete, apiGet } from "../lib/api.js";
import { ENTITY_BY_PATH, type EntitySpec } from "../lib/entities.jsx";
import { EmptyState, ExpandableTable } from "../components/index.jsx";
import { canWrite } from "../lib/permissions.js";
import { Pencil, Plus, Trash2 } from "lucide-react";

type Row = Record<string, unknown>;

/**
 * Every entity list is this one page driven by the registry: rows expand in
 * place to show more fields and link to that entity's detail page. Write
 * affordances (New / per-row Edit, Delete) appear only when the caller's
 * roles permit the operation — the API enforces regardless.
 */
export function EntityListPage(): React.ReactElement {
  const { pathname } = useLocation();
  const spec: EntitySpec | undefined = ENTITY_BY_PATH[pathname];
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ roles?: string[] }>("/api/me")
      .then((me) => setRoles(me.roles ?? []))
      .catch(() => setRoles([]));
  }, []);

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

  const rowId = (row: Row): string => {
    if (spec.idField && row[spec.idField] != null) return String(row[spec.idField]);
    const first = Object.values(row)[0];
    return String(first);
  };

  const onDelete = async (row: Row): Promise<void> => {
    const id = rowId(row);
    if (!window.confirm(`Delete ${id}? The record is soft-deleted; the journal keeps history.`)) return;
    try {
      await apiDelete(`${spec.endpoint}/${encodeURIComponent(id)}`);
      setRows((prev) => prev.filter((r) => rowId(r) !== id));
      setNotice(`Deleted ${id}.`);
    } catch (e) {
      setNotice(`Delete failed: ${(e as Error).message}`);
    }
  };
  return (
    <div>
      <h1>{spec.label}</h1>
      <div style={{ color: "#666", marginBottom: 12 }}>{spec.blurb}</div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        {spec.filters?.map((f) => (
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
        {spec.entityKey && canWrite(roles, spec.entityKey, "create") && spec.crud?.create ? (
          <button
            type="button"
            title={`New ${spec.label}`}
            style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Plus size={16} /> New
          </button>
        ) : null}
      </div>

      {notice ? <div style={{ color: "#666", fontSize: "0.85rem", marginBottom: 8 }}>{notice}</div> : null}

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
        rowActions={
          (spec.entityKey && canWrite(roles, spec.entityKey, "update") && spec.crud?.update) ||
          (spec.entityKey && canWrite(roles, spec.entityKey, "delete") && spec.crud?.delete)
            ? (row) => (
                <>
                  {spec.entityKey && canWrite(roles, spec.entityKey, "update") && spec.crud?.update ? (
                    <Link to={`${pathname}/${rowId(row)}/edit`} title="Edit" aria-label="Edit">
                      <Pencil size={15} />
                    </Link>
                  ) : null}
                  {spec.entityKey && canWrite(roles, spec.entityKey, "delete") && spec.crud?.delete ? (
                    <button
                      type="button"
                      title="Delete"
                      aria-label="Delete"
                      style={{ border: "none", background: "none", cursor: "pointer", color: "#c33" }}
                      onClick={() => void onDelete(row)}
                    >
                      <Trash2 size={15} />
                    </button>
                  ) : null}
                </>
              )
            : undefined
        }
      />
    </div>
  );
}
