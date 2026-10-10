import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiDelete, apiGet, type MaintenanceWindow, type Trip } from "../../lib/api.js";
import { canWrite } from "../../lib/permissions.js";
import { Badge, DataTable, DetailHeader, DetailTabs, EmptyState, Section, StatCard } from "../../components/index.jsx";
import { formatDate, legChain } from "../../lib/format.js";

/**
 * One service window and the trips it affected: trips of this vehicle inside
 * the window are either cancelled (no cover was available) or were flown by a
 * covering aircraft under a maintenance_cover assignment.
 */
export function MaintenanceDetailPage(): React.ReactElement {
  const { id = "", mid = "" } = useParams();
  const [window, setWindow] = useState<MaintenanceWindow | null>(null);
  const [affected, setAffected] = useState<Trip[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      apiGet<MaintenanceWindow[]>(`/api/vehicles/${id}/maintenance`),
      apiGet<Trip[]>(`/api/vehicles/${id}/trips`),
    ])
      .then(([windows, trips]) => {
        const w = windows.find((x) => x.maintenance_id === mid) ?? null;
        setWindow(w);
        if (w) {
          const from = w.start_date.slice(0, 10);
          const to = w.end_date.slice(0, 10);
          setAffected(trips.filter((t) => {
            const d = t.operating_date.slice(0, 10);
            return d >= from && d <= to;
          }));
        }
      })
      .catch((e: Error) => setError(e.message));
  }, [id, mid]);

  useEffect(() => {
    apiGet<{ roles?: string[] }>("/api/me")
      .then((me) => setRoles(me.roles ?? []))
      .catch(() => setRoles([]));
  }, []);

  if (error) return <div style={{ color: "red" }}>Error: {error}</div>;
  if (!window) return <div>Loading…</div>;

  const cancelled = affected.filter((t) => t.status === "cancelled").length;

  return (
    <div>
      <DetailHeader
        title={`${window.maintenance_type} · ${window.maintenance_id}`}
        subtitle={`${formatDate(window.start_date)} → ${formatDate(window.end_date)}`}
        backTo={`/vehicles/${id}`}
        backLabel="Vehicle"
        editTo={canWrite(roles, "vehicle-maintenance", "update") ? `/vehicle-maintenance/${mid}/edit` : undefined}
        onDelete={
          canWrite(roles, "vehicle-maintenance", "delete")
            ? () => {
                void apiDelete(`/api/vehicle-maintenance/${mid}`).then(() => navigate("/vehicle-maintenance"));
              }
            : undefined
        }
      />

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <StatCard label="Status" value={<Badge value={window.status} />} />
        <StatCard label="Facility" value={window.facility_id ?? "—"} />
        <StatCard label="Trips in window" value={affected.length} />
        <StatCard label="Cancelled" value={cancelled} tone="cancelled" />
      </div>

      <DetailTabs
        tabs={[
          { key: "overview", label: "Affected trips", badge: affected.length, render: () => (<>
      <Section title="Trips during this window">
        {affected.length === 0 ? (
          <EmptyState message="No trips of this aircraft fall inside the window — its routes were covered by another aircraft." />
        ) : (
          <DataTable
            rows={affected}
            rowKey={(t) => t.trip_id}
            columns={[
              { key: "date", header: "Date", render: (t) => formatDate(t.operating_date) },
              { key: "trip", header: "Trip", render: (t) => <Link to={`/trips/${t.trip_id}`}>{t.trip_id}</Link> },
              { key: "route", header: "Route", render: (t) => <Link to={`/routes/${t.route_id}`}>{t.route_id}</Link> },
              { key: "legs", header: "Itinerary", render: (t) => legChain(t.legs) },
              { key: "status", header: "Status", render: (t) => <Badge value={t.status} /> },
            ]}
          />
        )}
      </Section>
          </>) },
        ]}
      />
    </div>
  );
}
