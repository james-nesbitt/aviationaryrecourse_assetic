import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiDelete, apiGet, type Trip } from "../../lib/api.js";
import { canWrite } from "../../lib/permissions.js";
import { Badge, DataTable, DetailHeader, DetailTabs, FieldGrid, Section, StatCard } from "../../components/index.jsx";
import { formatDate, formatDateTime, legChain } from "../../lib/format.js";

interface TransitEvent {
  event_id: string;
  sequence: number;
  event_type: string;
  from_state: string;
  to_state: string;
  location_iata: string;
  vehicle_id: string | null;
  actor_id: string | null;
  valid_time: string;
}
interface PassengerDetail {
  passenger_id: string;
  given_name: string;
  family_name: string;
  passenger_type: string;
  order_id: string | null;
  trip_id: string | null;
  operator_id: string;
  operator_name: string;
  origin_iata: string;
  destination_iata: string;
  valid_time: string;
  state: string;
  last_event_type: string | null;
  current_location_iata: string | null;
}

/** Passenger dashboard: booking, carrying trip and journey events. */
export function PassengerDetailPage(): React.ReactElement {
  const { id = "" } = useParams();
  const [passenger, setPassenger] = useState<PassengerDetail | null>(null);
  const [events, setEvents] = useState<TransitEvent[]>([]);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<PassengerDetail>(`/api/passengers/${id}`)
      .then(async (p) => {
        setPassenger(p);
        const [ev, t] = await Promise.all([
          apiGet<TransitEvent[]>(`/api/passengers/${id}/events`),
          p.trip_id ? apiGet<Trip>(`/api/trips/${p.trip_id}`) : Promise.resolve(null),
        ]);
        setEvents(ev);
        setTrip(t);
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(() => {
    apiGet<{ roles?: string[] }>("/api/me")
      .then((me) => setRoles(me.roles ?? []))
      .catch(() => setRoles([]));
  }, []);

  if (error) return <div style={{ color: "red" }}>Error: {error}</div>;
  if (!passenger) return <div>Loading…</div>;

  return (
    <div>
      <DetailHeader
        title={`${passenger.given_name} ${passenger.family_name}`}
        subtitle={`${passenger.origin_iata} → ${passenger.destination_iata} · ${passenger.passenger_type} · ${passenger.operator_name}`}
        backTo="/passengers"
        backLabel="Passengers"
        editTo={canWrite(roles, "passengers", "update") ? `/passengers/${id}/edit` : undefined}
        onDelete={
          canWrite(roles, "passengers", "delete")
            ? () => {
                void apiDelete(`/api/passengers/${id}`).then(() => navigate("/passengers"));
              }
            : undefined
        }
      />

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <StatCard label="State" value={<Badge value={passenger.state} />} />
        <StatCard label="Location" value={passenger.current_location_iata ?? "—"} />
        <StatCard label="Events" value={events.length} />
        <StatCard label="Booked" value={formatDate(passenger.valid_time)} />
      </div>

      <DetailTabs
        tabs={[
          { key: "overview", label: "Booking", render: () => (<>
      <Section title="Booking">
        <FieldGrid
          fields={[
            { label: "Passenger id", value: passenger.passenger_id },
            {
              label: "Operator",
              value: <Link to={`/operators/${passenger.operator_id}`}>{passenger.operator_name}</Link>,
            },
            {
              label: "Order",
              value: passenger.order_id ? (
                <Link to={`/orders/${passenger.order_id}`}>{passenger.order_id}</Link>
              ) : (
                "standalone booking"
              ),
            },
            {
              label: "Trip",
              value: passenger.trip_id ? <Link to={`/trips/${passenger.trip_id}`}>{passenger.trip_id}</Link> : "—",
            },
            { label: "Last event", value: passenger.last_event_type ?? "—" },
          ]}
        />
      </Section>

          </>) },
          { key: "trip", label: "Carrying trip", render: () => (<>
      {trip ? (
        <Section title="Carrying trip">
          <FieldGrid
            fields={[
              { label: "Trip", value: <Link to={`/trips/${trip.trip_id}`}>{trip.trip_id}</Link> },
              { label: "Operating date", value: formatDate(trip.operating_date) },
              { label: "Itinerary", value: legChain(trip.legs) },
              { label: "Status", value: <Badge value={trip.status} /> },
              { label: "Vehicle", value: <Link to={`/vehicles/${trip.vehicle_id}`}>{trip.vehicle_id}</Link> },
            ]}
          />
        </Section>
      ) : null}

          </>) },
          { key: "events", label: "Journey events", badge: events.length, render: () => (<>
      <Section title="Journey events">
        <DataTable
          rows={events}
          rowKey={(e) => e.event_id}
          columns={[
            { key: "seq", header: "#", render: (e) => e.sequence },
            { key: "type", header: "Event", render: (e) => e.event_type },
            { key: "transition", header: "Transition", render: (e) => `${e.from_state} → ${e.to_state}` },
            { key: "where", header: "Location", render: (e) => e.location_iata },
            { key: "when", header: "When", render: (e) => formatDateTime(e.valid_time) },
            {
              key: "actor",
              header: "Actor",
              render: (e) => (e.actor_id ? <Link to={`/staff/${e.actor_id}`}>{e.actor_id}</Link> : "—"),
            },
          ]}
          empty="No events recorded yet"
        />
      </Section>
          </>) },
        ]}
      />
    </div>
  );
}
