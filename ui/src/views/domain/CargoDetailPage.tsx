import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet, type Trip } from "../../lib/api.js";
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
  facility_id: string | null;
  actor_id: string | null;
  valid_time: string;
}
interface CargoDetail {
  cargo_id: string;
  customer_id: string;
  customer_name: string;
  operator_id: string;
  operator_name: string;
  origin_iata: string;
  destination_iata: string;
  assigned_vehicle_id: string | null;
  trip_id: string | null;
  weight_kg: number;
  cargo_type: string;
  valid_time: string;
  state: string;
  last_event_type: string | null;
  current_location_iata: string | null;
  events: TransitEvent[];
  trip: Trip | null;
}

/** Shipment dashboard: booking, carrying trip and the full custody chain. */
export function CargoDetailPage(): React.ReactElement {
  const { id = "" } = useParams();
  const [cargo, setCargo] = useState<CargoDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<CargoDetail>(`/api/cargo/${id}`)
      .then(setCargo)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  if (error) return <div style={{ color: "red" }}>Error: {error}</div>;
  if (!cargo) return <div>Loading…</div>;

  return (
    <div>
      <DetailHeader
        title={`${cargo.cargo_id} · ${cargo.origin_iata} → ${cargo.destination_iata}`}
        subtitle={`${cargo.cargo_type} · ${cargo.weight_kg} kg · ${cargo.operator_name}`}
        backTo="/cargo"
        backLabel="Cargo"
      />

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <StatCard label="State" value={<Badge value={cargo.state} />} />
        <StatCard label="Location" value={cargo.current_location_iata ?? "—"} />
        <StatCard label="Events" value={cargo.events.length} />
        <StatCard label="Booked" value={formatDate(cargo.valid_time)} />
      </div>

      <DetailTabs
        tabs={[
          { key: "overview", label: "Overview", render: () => (<>
      <Section title="Booking">
        <FieldGrid
          fields={[
            {
              label: "Customer",
              value: <Link to={`/customers/${cargo.customer_id}`}>{cargo.customer_name}</Link>,
            },
            {
              label: "Operator",
              value: <Link to={`/operators/${cargo.operator_id}`}>{cargo.operator_name}</Link>,
            },
            {
              label: "Trip",
              value: cargo.trip_id ? <Link to={`/trips/${cargo.trip_id}`}>{cargo.trip_id}</Link> : "—",
            },
            {
              label: "Vehicle",
              value: cargo.assigned_vehicle_id ? (
                <Link to={`/vehicles/${cargo.assigned_vehicle_id}`}>{cargo.assigned_vehicle_id}</Link>
              ) : (
                "—"
              ),
            },
            { label: "Last event", value: cargo.last_event_type ?? "—" },
          ]}
        />
      </Section>

          </>) },
          { key: "trip", label: "Carrying trip", render: () => (<>
      {cargo.trip ? (
        <Section title="Carrying trip">
          <FieldGrid
            fields={[
              { label: "Trip", value: <Link to={`/trips/${cargo.trip.trip_id}`}>{cargo.trip.trip_id}</Link> },
              { label: "Operating date", value: formatDate(cargo.trip.operating_date) },
              { label: "Itinerary", value: legChain(cargo.trip.legs) },
              { label: "Status", value: <Badge value={cargo.trip.status} /> },
            ]}
          />
        </Section>
      ) : null}

          </>) },
          { key: "chain", label: "Custody chain", badge: cargo.events.length, render: () => (<>
      <Section title="Custody chain">
        <DataTable
          rows={cargo.events}
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
