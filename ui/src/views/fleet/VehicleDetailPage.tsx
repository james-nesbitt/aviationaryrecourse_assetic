import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiDelete, apiGet, type MaintenanceWindow, type Trip } from "../../lib/api.js";
import { canWrite } from "../../lib/permissions.js";
import { Badge, DataTable, DetailHeader, DetailTabs, Section, StatCard, Timeline } from "../../components/index.jsx";
import { BarStack, LineTrend } from "../../charts/index.jsx";
import { formatDate, legChain } from "../../lib/format.js";

interface Vehicle {
  vehicle_id: string;
  registration: string | null;
  kind: string;
  status: string | null;
  base_iata: string | null;
  operator_id: string;
  model_id: string | null;
  seat_config: unknown;
}
interface MonthRow {
  month: string;
  trips: number;
  cancelled: number;
  block_hours: string;
}
interface TypeRow {
  maintenance_type: string;
  windows: number;
  days: number;
}
interface VehicleStats {
  vehicle_id: string;
  trips_by_month: MonthRow[];
  maintenance_by_type: TypeRow[];
  totals: { total_trips: number; completed: number; cancelled: number; operating_days: number } | null;
}

/** Per-aircraft history: trips flown, service record, utilisation. */
export function VehicleDetailPage(): React.ReactElement {
  const { id = "" } = useParams();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceWindow[]>([]);
  const [stats, setStats] = useState<VehicleStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      apiGet<Vehicle>(`/api/vehicles/${id}`),
      apiGet<Trip[]>(`/api/vehicles/${id}/trips`),
      apiGet<MaintenanceWindow[]>(`/api/vehicles/${id}/maintenance`),
      apiGet<VehicleStats>(`/api/vehicles/${id}/stats`),
    ])
      .then(([v, t, m, s]) => {
        setVehicle(v);
        setTrips(t);
        setMaintenance(m);
        setStats(s);
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(() => {
    apiGet<{ roles?: string[] }>("/api/me")
      .then((me) => setRoles(me.roles ?? []))
      .catch(() => setRoles([]));
  }, []);

  if (error) return <div style={{ color: "red" }}>Error: {error}</div>;
  if (!vehicle || !stats) return <div>Loading…</div>;

  const totals = stats.totals;
  const recent = trips.slice(0, 25);

  return (
    <div>
      <DetailHeader
        title={vehicle.registration ?? vehicle.vehicle_id}
        subtitle={`${vehicle.model_id ?? "unknown model"} · base ${vehicle.base_iata ?? "—"} · ${vehicle.operator_id}`}
        backTo="/fleet"
        backLabel="Fleet"
        editTo={canWrite(roles, "vehicles", "update") ? `/vehicles/${id}/edit` : undefined}
        onDelete={
          canWrite(roles, "vehicles", "delete")
            ? () => {
                void apiDelete(`/api/vehicles/${id}`).then(() => navigate("/vehicles"));
              }
            : undefined
        }
      />

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <StatCard label="Status" value={<Badge value={vehicle.status ?? "unknown"} />} />
        <StatCard label="Trips" value={totals?.total_trips ?? 0} />
        <StatCard label="Completed" value={totals?.completed ?? 0} tone="completed" />
        <StatCard label="Cancelled" value={totals?.cancelled ?? 0} tone="cancelled" />
        <StatCard label="Service events" value={maintenance.length} />
      </div>

      <DetailTabs
        tabs={[
          { key: "overview", label: "Overview", render: () => (<>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 24 }}>
        <Section title="Trips per month">
          <LineTrend
            data={stats.trips_by_month as unknown as Record<string, unknown>[]}
            xKey="month"
            series={[
              { key: "trips", label: "Trips" },
              { key: "cancelled", label: "Cancelled" },
            ]}
          />
        </Section>
        <Section title="Service events by type">
          <BarStack
            data={stats.maintenance_by_type as unknown as Record<string, unknown>[]}
            xKey="maintenance_type"
            series={[{ key: "windows", label: "Windows" }]}
            stacked={false}
          />
        </Section>
      </div>

          </>) },
          { key: "service", label: "Service record", badge: maintenance.length, render: () => (<>
      <Section title="Service record">
        <Timeline
          items={maintenance.map((w) => ({
            id: w.maintenance_id,
            label: `${w.maintenance_type} · ${w.status}`,
            start: w.start_date,
            end: w.end_date,
            tone: w.status === "completed" ? "completed" : "maintenance",
          }))}
        />
        <div style={{ marginTop: 12 }}>
          <DataTable
            rows={maintenance}
            rowKey={(w) => w.maintenance_id}
            columns={[
              {
                key: "id",
                header: "Window",
                render: (w) => (
                  <Link to={`/vehicles/${id}/maintenance/${w.maintenance_id}`}>{w.maintenance_id}</Link>
                ),
              },
              { key: "type", header: "Type", render: (w) => w.maintenance_type },
              { key: "from", header: "From", render: (w) => formatDate(w.start_date) },
              { key: "to", header: "To", render: (w) => formatDate(w.end_date) },
              { key: "status", header: "Status", render: (w) => <Badge value={w.status} /> },
            ]}
          />
        </div>
      </Section>

          </>) },
          { key: "trips", label: "Flight history", badge: trips.length, render: () => (<>
      <Section title="Flight history">
        <DataTable
          rows={recent}
          rowKey={(t) => t.trip_id}
          columns={[
            { key: "date", header: "Date", render: (t) => formatDate(t.operating_date) },
            { key: "trip", header: "Trip", render: (t) => <Link to={`/trips/${t.trip_id}`}>{t.trip_id}</Link> },
            { key: "route", header: "Route", render: (t) => <Link to={`/routes/${t.route_id}`}>{t.route_id}</Link> },
            { key: "legs", header: "Itinerary", render: (t) => legChain(t.legs) },
            { key: "status", header: "Status", render: (t) => <Badge value={t.status} /> },
          ]}
          empty="No trips recorded"
        />
      </Section>
          </>) },
        ]}
      />
    </div>
  );
}
