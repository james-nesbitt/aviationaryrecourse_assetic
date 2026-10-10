import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { apiGet, apiSend } from "../lib/api.js";
import { ENTITY_BY_PATH, type EntitySpec } from "../lib/entities.jsx";
import { DetailHeader, EmptyState } from "../components/index.jsx";

type Row = Record<string, unknown>;

/** A form field: what to render and how to submit it. */
export interface FormField {
  /** snake_case wire key. */
  key: string;
  label: string;
  type?: "text" | "number" | "date" | "select";
  options?: string[];
  required?: boolean;
}

/**
 * Generic entity edit form, driven by the registry's formFields. Used for
 * both create (no id) and edit (existing row): the form fetches the row,
 * renders one input per field, PATCHes on save. Permission gating is the
 * API's job; the page is only routed to from affordances that already check
 * the client permission mirror.
 */
export function EntityEditPage(): React.ReactElement {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { id } = useParams();
  const listPath = id ? pathname.replace(/\/[^/]+\/edit$/, "") : pathname.replace(/\/edit$/, "");
  const spec: EntitySpec | undefined = ENTITY_BY_PATH[listPath];
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const isEdit = id !== undefined;
  const fields: FormField[] = spec?.formFields ?? [];

  useEffect(() => {
    if (!spec) { setLoading(false); return; }
    if (!isEdit) { setLoading(false); return; }
    apiGet<Row>(`${spec.endpoint}/${id}`)
      .then((row) => {
        const init: Record<string, string> = {};
        for (const f of fields) {
          const v = row[f.key];
          init[f.key] = v == null ? "" : String(v).slice(0, f.type === "date" ? 10 : undefined);
        }
        setValues(init);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, id]);

  if (!spec) return <EmptyState message={`No entity registered for ${listPath}`} />;
  if (error) return <div style={{ color: "red" }}>Error: {error}</div>;
  if (loading) return <div>Loading…</div>;

  const onSave = async (): Promise<void> => {
    setNotice(null);
    const body: Record<string, unknown> = {};
    for (const f of fields) {
      if (values[f.key] !== "" && values[f.key] !== undefined) body[f.key] = values[f.key];
    }
    try {
      if (isEdit) {
        await apiSend("PATCH", `${spec.endpoint}/${id}`, body);
        setNotice("Saved.");
      } else {
        await apiSend("POST", spec.endpoint, body);
        navigate(listPath);
      }
    } catch (e) {
      setNotice(`Save failed: ${(e as Error).message}`);
    }
  };

  return (
    <div>
      <DetailHeader
        title={isEdit ? `Edit ${spec.label}` : `New ${spec.label}`}
        subtitle={isEdit ? id : undefined}
        backTo={isEdit ? `${listPath}/${id}` : listPath}
        backLabel={isEdit ? "Detail" : spec.label}
      />
      {notice ? <div style={{ marginBottom: 12, color: notice.startsWith("Save failed") ? "#c33" : "#666" }}>{notice}</div> : null}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 340px)", gap: 12 }}>
        {fields.map((f) => (
          <label key={f.key} style={{ fontSize: "0.9rem", display: "grid", gap: 4 }}>
            {f.label}{f.required ? " *" : ""}
            {f.type === "select" && f.options ? (
              <select
                value={values[f.key] ?? ""}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              >
                <option value="">—</option>
                {f.options.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            ) : (
              <input
                type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                value={values[f.key] ?? ""}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              />
            )}
          </label>
        ))}
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 12 }}>
        <button type="button" onClick={() => void onSave()}>Save</button>
        <Link to={isEdit ? `${listPath}/${id}` : listPath}>Cancel</Link>
      </div>
    </div>
  );
}