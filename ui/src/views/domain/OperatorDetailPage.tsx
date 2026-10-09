import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet } from "../../lib/api.js";
import { Badge, DataTable, DetailHeader, DetailTabs, Section, StatCard } from "../../components/index.jsx";
import { DonutBreakdown } from "../../charts/index.jsx";

interface Operator {
  operator_id: string;
  name: string;
  type: string;
  country: string;
  hub_iata: string;
  founded_year: number;
  fleet_size_hint: number;
}
interface Vehicle {
  vehicle_id: string;
  registration: string | null;
  kind: string;
  status: string | null;
  base_iata: string | null;
  model_id: string | null;
  operator_id: string;
}
interface RouteRow {
  route_id: string;
  route_type: string;
  base_iata: string;
  frequency_days: number;
  vehicle_id: string;
  operator_id: string;
}
interface StaffRow {
  staff_id: string;
  given_name: string;
  family_name: string;
  role: string;
  role_class: string;
  operator_id: string;
}

/** Operator dashboard: fleet composition, routes and people. */
export function OperatorDetailPage(): React.ReactElement {
  const { id = "" } = useParams();
  const [operator, setOperator] = useState<Operator | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiGet<Operator>(`/api/operators/${id}`),
      apiGet<Vehicle[]>(`/api/vehicles?operatorId=${id}`),
      apiGet<RouteRow[]>(`/api/routes?operatorId=${id}`),
      apiGet<StaffRow[]>(`/api/staff?operatorId=${id}`),
    ])
      .then(([o, v, r, s]) => {
        setOperator(o);
        setVehicles(v);
        setRoutes(r);
        setStaff(s);
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  if (error) return <div style={{ color: "red" }}>Error: {error}</div>;
  if (!operator) return <div>Loading…</div>;

  const aircraft = vehicles.filter((v) => v.kind === "aircraft");
  const byStatus = aircraft.reduce<Record<string, number>>((acc, v) => {
    const k = v.status ?? "unknown";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      <DetailHeader
        title={operator.name}
        subtitle={`${operator.type} operator · hub ${operator.hub_iata} · ${operator.country} · founded ${operator.founded_year}`}
        backTo="/operators"
        backLabel="Operators"
      />

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <StatCard label="Aircraft" value={aircraft.length} />
        <StatCard label="All vehicles" value={vehicles.length} />
        <StatCard label="Routes" value={routes.length} />
        <StatCard label="Staff" value={staff.length} />
        <StatCard label="Flight crew" value={staff.filter((s) => s.role_class === "flight_crew").length} />
      </div>

      <DetailTabs
        tabs={[
          { key: "overview", label: "Overview", render: () => (<>
      {aircraft.length > 0 ? (
        <Section title="Fleet status">
          <div style={{ maxWidth: 420 }}>
            <DonutBreakdown data={Object.entries(byStatus).map(([name, value]) => ({ name, value }))} />
          </div>
        </Section>
      ) : null}

          </>) },
          { key: "routes", label: "Routes", badge: routes.length, render: () => (<>
      <Section title="Routes">
        <DataTable
          rows={routes}
          rowKey={(r) => r.route_id}
          columns={[
            { key: "id", header: "Route", render: (r) => <Link to={`/routes/${r.route_id}`}>{r.route_id}</Link> },
            { key: "type", header: "Type", render: (r) => r.route_type },
            { key: "base", header: "Base", render: (r) => r.base_iata },
            { key: "freq", header: "Every", render: (r) => `${r.frequency_days}d` },
            { key: "veh", header: "Vehicle", render: (r) => <Link to={`/vehicles/${r.vehicle_id}`}>{r.vehicle_id}</Link> },
          ]}
          empty="No routes for this operator"
        />
      </Section>

          </>) },
          { key: "fleet", label: "Fleet", badge: vehicles.length, render: () => (<>
      <Section title="Fleet">
        <DataTable
          rows={vehicles}
          rowKey={(v) => v.vehicle_id}
          columns={[
            {
              key: "id",
              header: "Vehicle",
              render: (v) => <Link to={`/vehicles/${v.vehicle_id}`}>{v.registration ?? v.vehicle_id}</Link>,
            },
            { key: "kind", header: "Kind", render: (v) => v.kind },
            { key: "model", header: "Model", render: (v) => v.model_id ?? "—" },
            { key: "base", header: "Base", render: (v) => v.base_iata ?? "—" },
            { key: "status", header: "Status", render: (v) => (v.status ? <Badge value={v.status} /> : "—") },
          ]}
        />
      </Section>

          </>) },
          { key: "staff", label: "Staff", badge: staff.length, render: () => (<>
      <Section title="Staff">
        <DataTable
          rows={staff.slice(0, 25)}
          rowKey={(s) => s.staff_id}
          columns={[
            {
              key: "name",
              header: "Name",
              render: (s) => (
                <Link to={`/staff/${s.staff_id}`}>
                  {s.given_name} {s.family_name}
                </Link>
              ),
            },
            { key: "role", header: "Role", render: (s) => s.role },
            { key: "class", header: "Class", render: (s) => s.role_class },
          ]}
        />
      </Section>
          </>) },
        ]}
      />
    </div>
  );
}
