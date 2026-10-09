import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, type FatigueRow } from "../../lib/api.js";
import { Badge, DataTable, Section, StatCard } from "../../components/index.jsx";
import { BarStack } from "../../charts/index.jsx";
import { formatDate, formatHours } from "../../lib/format.js";

interface DayRow {
  operating_date: string;
  status: string;
  trips: number;
}
interface TopRoute {
  route_id: string;
  route_type: string;
  base_iata: string;
  trips: number;
  completed: number;
  cancelled: number;
}
interface OpsStats {
  window_days: number;
  trips_by_day: DayRow[];
  top_routes: TopRoute[];
}
interface RouteRow {
  route_id: string;
  operator_id: string;
  vehicle_id: string;
  route_type: string;
  base_iata: string;
  frequency_days: number;
  first_operating_date: string;
}

interface MaintenanceRow {
  maintenance_id: string;
  vehicle_id: string;
  maintenance_type: string;
  start_date: string;
  end_date: string;
  status: string;
}

const STATUSES = ["completed", "in_progress", "scheduled", "cancelled"];

/** Route-manager landing page: trip volume, route health, crew fatigue. */
export function OperationsView(): React.ReactElement {
  const [stats, setStats] = useState<OpsStats | null>(null);
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [fatigue, setFatigue] = useState<FatigueRow[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiGet<OpsStats>("/api/stats/operations?days=45"),
      apiGet<RouteRow[]>("/api/routes"),
      apiGet<FatigueRow[]>("/api/staff/fatigue"),
      apiGet<MaintenanceRow[]>("/api/vehicle-maintenance"),
    ])
      .then(([s, r, f, m]) => {
        setStats(s);
        setRoutes(r);
        setFatigue(f);
        setMaintenance(m);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <div style={{ color: "red" }}>Error: {error}</div>;
  if (!stats) return <div>Loading…</div>;

  // pivot (date, status) rows into one row per date with a column per status
  const byDate = new Map<string, Record<string, unknown>>();
  for (const row of stats.trips_by_day) {
    const day = row.operating_date.slice(0, 10);
    const entry = byDate.get(day) ?? { day };
    entry[row.status] = row.trips;
    byDate.set(day, entry);
  }
  const chartData = [...byDate.values()].sort((a, b) => String(a.day).localeCompare(String(b.day)));

  const atRisk = fatigue.filter((f) => f.level !== "ok");

  return (
    <div>
      <h1>Operations Control</h1>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <StatCard label="Routes" value={routes.length} />
        <StatCard label="Crew tracked" value={fatigue.length} />
        <StatCard
          label="Crew at warn"
          value={fatigue.filter((f) => f.level === "warn").length}
          tone="warn"
        />
        <StatCard
          label="Crew critical"
          value={fatigue.filter((f) => f.level === "critical").length}
          tone="critical"
        />
      </div>

      <Section title={`Trips per day (last ${stats.window_days} days + 14 ahead)`}>
        <BarStack
          data={chartData}
          xKey="day"
          series={STATUSES.map((s) => ({ key: s, label: s.replace("_", " ") }))}
        />
      </Section>

      <Section title="Crew fatigue">
        <DataTable
          rows={[...atRisk, ...fatigue.filter((f) => f.level === "ok")].slice(0, 15)}
          rowKey={(f) => f.staff_id}
          columns={[
            {
              key: "name",
              header: "Crew",
              render: (f) => (
                <Link to={`/staff/${f.staff_id}`}>
                  {f.given_name} {f.family_name}
                </Link>
              ),
            },
            { key: "role", header: "Role", render: (f) => f.role },
            {
              key: "op",
              header: "Operator",
              render: (f) => <Link to={`/operators/${f.operator_id}`}>{f.operator_id}</Link>,
            },
            { key: "duty", header: "Duty (7d)", render: (f) => formatHours(f.duty_hours_7d) },
            { key: "days", header: "Consecutive days", render: (f) => f.consecutive_duty_days },
            { key: "rest", header: "Rest", render: (f) => formatHours(f.rest_since_last_hours) },
            { key: "level", header: "Level", render: (f) => <Badge value={f.level} /> },
          ]}
        />
      </Section>

      <Section title="Maintenance impact">
        <DataTable
          rows={maintenance.filter((w) => w.status !== "completed")}
          rowKey={(w) => w.maintenance_id}
          columns={[
            {
              key: "window",
              header: "Window",
              render: (w) => (
                <Link to={`/vehicles/${w.vehicle_id}/maintenance/${w.maintenance_id}`}>
                  {w.maintenance_type}
                </Link>
              ),
            },
            {
              key: "vehicle",
              header: "Vehicle",
              render: (w) => <Link to={`/vehicles/${w.vehicle_id}`}>{w.vehicle_id}</Link>,
            },
            { key: "from", header: "From", render: (w) => formatDate(w.start_date) },
            { key: "to", header: "To", render: (w) => formatDate(w.end_date) },
            {
              key: "routes",
              header: "Affected routes",
              render: (w) => {
                const affected = routes.filter(
                  (r) =>
                    r.vehicle_id === w.vehicle_id &&
                    r.first_operating_date.slice(0, 10) <= w.end_date.slice(0, 10),
                );
                return affected.length > 0 ? (
                  <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
                    {affected.map((r) => (
                      <Link key={r.route_id} to={`/routes/${r.route_id}`}>
                        {r.route_id}
                      </Link>
                    ))}
                  </span>
                ) : (
                  "—"
                );
              },
            },
            { key: "status", header: "Status", render: (w) => <Badge value={w.status} /> },
          ]}
          empty="No open maintenance windows"
        />
      </Section>

      <Section title="Routes">
        <DataTable
          rows={routes}
          rowKey={(r) => r.route_id}
          columns={[
            { key: "id", header: "Route", render: (r) => <Link to={`/routes/${r.route_id}`}>{r.route_id}</Link> },
            { key: "type", header: "Type", render: (r) => r.route_type },
            { key: "base", header: "Base", render: (r) => r.base_iata },
            { key: "freq", header: "Every", render: (r) => `${r.frequency_days}d` },
            {
              key: "vehicle",
              header: "Vehicle",
              render: (r) => <Link to={`/vehicles/${r.vehicle_id}`}>{r.vehicle_id}</Link>,
            },
            { key: "op", header: "Operator", render: (r) => r.operator_id },
          ]}
        />
      </Section>

      <Section title="Busiest routes">
        <DataTable
          rows={stats.top_routes}
          rowKey={(r) => r.route_id}
          columns={[
            { key: "id", header: "Route", render: (r) => <Link to={`/routes/${r.route_id}`}>{r.route_id}</Link> },
            { key: "type", header: "Type", render: (r) => r.route_type },
            { key: "trips", header: "Trips", render: (r) => r.trips },
            { key: "done", header: "Completed", render: (r) => r.completed },
            { key: "cancel", header: "Cancelled", render: (r) => r.cancelled },
          ]}
        />
      </Section>
    </div>
  );
}
