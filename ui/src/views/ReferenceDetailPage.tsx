import React, { useEffect, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { apiGet } from "../lib/api.js";
import { ENTITY_BY_PATH, type EntitySpec } from "../lib/entities.jsx";
import { DetailHeader, DetailTabs, EmptyState, FieldGrid } from "../components/index.jsx";

type Row = Record<string, unknown>;

/**
 * Detail view for entities without a bespoke dashboard (reference data and
 * assignment records). It promotes the registry's summary view to a page,
 * using the same tabbed shell as the bespoke dashboards so entity-specific
 * tabs can be added later.
 */
export function ReferenceDetailPage(): React.ReactElement {
  const { id = "" } = useParams();
  const { pathname } = useLocation();
  const listPath = `/${pathname.split("/")[1]}`;
  const spec: EntitySpec | undefined = ENTITY_BY_PATH[listPath];
  const [row, setRow] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!spec) return;
    apiGet<Row[]>(spec.endpoint)
      .then((rows) => {
        setRow(rows.find((r) => spec.rowKey(r) === id) ?? null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [spec, id]);

  if (!spec) return <EmptyState message={`No entity registered for ${listPath}`} />;
  if (error) return <div style={{ color: "red" }}>Error: {error}</div>;
  if (loading) return <div>Loading…</div>;
  if (!row) return <EmptyState message={`${spec.label}: no record ${id}`} />;

  const summaryField = spec.columns[0]?.render(row);

  return (
    <div>
      <DetailHeader
        title={typeof summaryField === "string" ? summaryField : id}
        subtitle={spec.blurb}
        backTo={spec.path}
        backLabel={spec.label}
      />
      <DetailTabs
        tabs={[
          {
            key: "overview",
            label: "Overview",
            render: () => (
              <FieldGrid
                fields={[
                  ...spec.columns.map((c) => ({ label: c.header, value: c.render(row) })),
                  ...spec.expansion(row),
                ]}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
