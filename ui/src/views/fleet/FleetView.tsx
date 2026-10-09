import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, type MaintenanceWindow } from "../../lib/api.js";
import { Badge, DataTable, Section, StatCard, Timeline } from "../../components/index.jsx";
import { DonutBreakdown } from "../../charts/index.jsx";

interface FleetRow {
  operator_id: string;
  operator_name: string;
  status: string;
  vehicles: number;
}
interface TripsRow {
  operator_id: string;
  status: string;
  trips: number;
}
interface BacklogRow extends MaintenanceWindow {
  registration: string;
}
interface FleetStats {
  fleet_by_status: FleetRow[];
  trips_by_status: TripsRow[];
  maintenance_backlog: BacklogRow[];
}
interface Vehicle {
  vehicle_id: string;
  registration: string | null;
  kind: string;
  status: string | null;
  base_iata: string | null;
  operator_id: string;
  model_id: string | null;
}

/** Maintenance-manager landing page: fleet condition and service backlog. */
export function FleetView(): React.ReactElement {
  const [stats, setStats] = useState<FleetStats | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiGet<FleetStats>("/api/stats/fleet"),
      apiGet<Vehicle[]>("/api/vehicles?kind=aircraft"),
    ])
      .then(([s, v]) => {
        setStats(s);
        setVehicles(v);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <div style={{ color: "red" }}>Error: {error}</div>;
  if (!stats) return <div>Loading…</div>;

  const byStatus = stats.fleet_by_status.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + r.vehicles;
    return acc;
  }, {});
  const donut = Object.entries(byStatus).map(([name, value]) => ({ name, value }));
  const cancelled = stats.trips_by_status
    .filter((r) => r.status === "cancelled")
    .reduce((n, r) => n + r.trips, 0);

  return (
    <div>
      <h1>Fleet &amp; Maintenance</h1>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <StatCard label="Aircraft" value={vehicles.length} />
        <StatCard label="In maintenance" value={byStatus.maintenance ?? 0} tone="maintenance" />
        <StatCard label="Stored" value={byStatus.stored ?? 0} tone="stored" />
        <StatCard label="Cancelled trips" value={cancelled} tone="cancelled" sub="all time" />
        <StatCard label="Open work" value={stats.maintenance_backlog.length} sub="scheduled or in progress" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 24 }}>
        <Section title="Fleet status">
          <DonutBreakdown data={donut} />
        </Section>
        <Section title="Maintenance backlog">
          <Timeline
            items={stats.maintenance_backlog.slice(0, 12).map((w) => ({
              id: w.maintenance_id,
              label: `${w.registration ?? w.vehicle_id} · ${w.maintenance_type}`,
              start: w.start_date,
              end: w.end_date,
              tone: w.status === "in_progress" ? "maintenance" : "scheduled",
            }))}
          />
        </Section>
      </div>

      <Section title="Aircraft">
        <DataTable
          rows={vehicles}
          rowKey={(v) => v.vehicle_id}
          columns={[
            {
              key: "reg",
              header: "Registration",
              render: (v) => <Link to={`/vehicles/${v.vehicle_id}`}>{v.registration ?? v.vehicle_id}</Link>,
            },
            { key: "model", header: "Model", render: (v) => v.model_id ?? "—" },
            { key: "base", header: "Base", render: (v) => v.base_iata ?? "—" },
            { key: "op", header: "Operator", render: (v) => v.operator_id },
            { key: "status", header: "Status", render: (v) => <Badge value={v.status ?? "unknown"} /> },
          ]}
        />
      </Section>
    </div>
  );
}
