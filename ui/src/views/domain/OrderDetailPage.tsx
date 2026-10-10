import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiDelete, apiGet } from "../../lib/api.js";
import { canWrite, hasEditForm } from "../../lib/permissions.js";
import { Badge, DataTable, DetailHeader, DetailTabs, FieldGrid, Section, StatCard } from "../../components/index.jsx";
import { formatDate, formatDateTime } from "../../lib/format.js";

interface PlannedLeg {
  leg_sequence: number;
  from_iata: string;
  to_iata: string;
  scheduled_departure: string;
  scheduled_arrival: string;
  trip_id?: string;
}
interface OrderDetail {
  order_id: string;
  customer_id: string;
  operator_id: string;
  order_type: string;
  account_manager_id: string | null;
  route_manager_id: string | null;
  origin_iata: string;
  destination_iata: string;
  planned_legs: PlannedLeg[];
  transit_route_ids: string[];
  ordered_on: string;
  status: string;
  passenger_group: { group_name: string; pax_count: number } | null;
  freight: { weight_kg: number; cargo_type: string } | null;
  accompanying_cargo_kg?: number;
}
interface PassengerRow {
  passenger_id: string;
  given_name: string;
  family_name: string;
  order_id: string | null;
  state: string;
}

/** Order dashboard: what was booked, the planned itinerary and who travels. */
export function OrderDetailPage(): React.ReactElement {
  const { id = "" } = useParams();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [passengers, setPassengers] = useState<PassengerRow[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<OrderDetail>(`/api/orders/${id}`)
      .then(async (o) => {
        setOrder(o);
        const all = await apiGet<PassengerRow[]>("/api/passengers");
        setPassengers(all.filter((p) => p.order_id === id));
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(() => {
    apiGet<{ roles?: string[] }>("/api/me")
      .then((me) => setRoles(me.roles ?? []))
      .catch(() => setRoles([]));
  }, []);

  if (error) return <div style={{ color: "red" }}>Error: {error}</div>;
  if (!order) return <div>Loading…</div>;

  return (
    <div>
      <DetailHeader
        title={`${order.order_id} · ${order.origin_iata} → ${order.destination_iata}`}
        subtitle={`${order.order_type} · ordered ${formatDate(order.ordered_on)} · ${order.operator_id}`}
        backTo="/orders"
        backLabel="Orders"
        editTo={canWrite(roles, "orders", "update") && hasEditForm("orders") ? `/orders/${id}/edit` : undefined}
        onDelete={
          canWrite(roles, "orders", "delete")
            ? () => {
                void apiDelete(`/api/orders/${id}`).then(() => navigate("/orders"));
              }
            : undefined
        }
      />

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <StatCard label="Status" value={<Badge value={order.status} />} />
        <StatCard label="Planned legs" value={order.planned_legs.length} />
        <StatCard label="Routes used" value={order.transit_route_ids.length} />
        {order.passenger_group ? (
          <StatCard label="Group size" value={order.passenger_group.pax_count} sub={order.passenger_group.group_name} />
        ) : null}
        {order.freight ? (
          <StatCard label="Freight" value={`${order.freight.weight_kg} kg`} sub={order.freight.cargo_type} />
        ) : null}
        <StatCard label="Passengers booked" value={passengers.length} />
      </div>

      <DetailTabs
        tabs={[
          { key: "overview", label: "Parties", render: () => (<>
      <Section title="Parties">
        <FieldGrid
          fields={[
            {
              label: "Customer",
              value: <Link to={`/customers/${order.customer_id}`}>{order.customer_id}</Link>,
            },
            {
              label: "Operator",
              value: <Link to={`/operators/${order.operator_id}`}>{order.operator_id}</Link>,
            },
            {
              label: "Account manager",
              value: order.account_manager_id ? (
                <Link to={`/staff/${order.account_manager_id}`}>{order.account_manager_id}</Link>
              ) : (
                "—"
              ),
            },
            {
              label: "Route manager",
              value: order.route_manager_id ? (
                <Link to={`/staff/${order.route_manager_id}`}>{order.route_manager_id}</Link>
              ) : (
                "—"
              ),
            },
            {
              label: "Accompanying cargo",
              value: order.accompanying_cargo_kg ? `${order.accompanying_cargo_kg} kg` : "—",
            },
          ]}
        />
      </Section>

          </>) },
          { key: "itinerary", label: "Itinerary", badge: order.planned_legs.length, render: () => (<>
      <Section title="Planned itinerary">
        <DataTable
          rows={order.planned_legs}
          rowKey={(l) => String(l.leg_sequence)}
          columns={[
            { key: "seq", header: "#", render: (l) => l.leg_sequence },
            { key: "from", header: "From", render: (l) => l.from_iata },
            { key: "to", header: "To", render: (l) => l.to_iata },
            { key: "dep", header: "Departure", render: (l) => formatDateTime(l.scheduled_departure) },
            { key: "arr", header: "Arrival", render: (l) => formatDateTime(l.scheduled_arrival) },
            {
              key: "trip",
              header: "Trip",
              render: (l) => (l.trip_id ? <Link to={`/trips/${l.trip_id}`}>{l.trip_id}</Link> : "direct"),
            },
          ]}
        />
      </Section>

          </>) },
          { key: "routes", label: "Routes used", render: () => (<>
      {order.transit_route_ids.length > 0 ? (
        <Section title="Routes used">
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {order.transit_route_ids.map((r) => (
              <Link key={r} to={`/routes/${r}`}>
                {r}
              </Link>
            ))}
          </div>
        </Section>
      ) : null}

          </>) },
          { key: "pax", label: "Passengers", badge: passengers.length, render: () => (<>
      <Section title="Passengers">
        <DataTable
          rows={passengers}
          rowKey={(p) => p.passenger_id}
          columns={[
            {
              key: "name",
              header: "Passenger",
              render: (p) => (
                <Link to={`/passengers/${p.passenger_id}`}>
                  {p.given_name} {p.family_name}
                </Link>
              ),
            },
            { key: "state", header: "State", render: (p) => <Badge value={p.state} /> },
          ]}
          empty="No passengers linked to this order"
        />
      </Section>
          </>) },
        ]}
      />
    </div>
  );
}
