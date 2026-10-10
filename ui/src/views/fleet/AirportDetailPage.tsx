import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet } from "../../lib/api.js";
import { canWrite } from "../../lib/permissions.js";
import { Badge, DataTable, DetailHeader, DetailTabs, FieldGrid, Section } from "../../components/index.jsx";
import { formatDate, formatDateTime } from "../../lib/format.js";

interface AirportRow {
  iata: string;
  icao: string;
  name: string;
  city: string;
  country: string;
  latitude: number;
  longitude: number;
  elevation_ft: number;
  timezone: string;
}
interface CargoHere {
  cargo_id: string;
  customer_name: string;
  origin_iata: string;
  destination_iata: string;
  state: string;
  weight_kg: number;
}
interface PassengerHere {
  passenger_id: string;
  given_name: string;
  family_name: string;
  origin_iata: string;
  destination_iata: string;
  state: string;
}
interface VehicleHere {
  vehicle_id: string;
  registration: string | null;
  kind: string;
  model_id: string | null;
  status: string | null;
}
interface LegRow {
  trip_id: string;
  route_id: string;
  operating_date: string;
  status: string;
  vehicle_id: string;
  sequence: number;
  from_iata: string;
  to_iata: string;
  scheduled_departure: string;
  scheduled_arrival: string;
}
interface Activity {
  iata: string;
  cargo: CargoHere[];
  passengers: PassengerHere[];
  vehicles: VehicleHere[];
  through_today: LegRow[];
}

/**
 * Airport dashboard. Two operational views beyond the identity facts: what is
 * at the airport right now (the anchor-instant presence view) and which trips
 * pass through it.
 */
export function AirportDetailPage(): React.ReactElement {
  const { id = "" } = useParams();
  const [airport, setAirport] = useState<AirportRow | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roles, setRoles] = useState<string[]>([]);

  useEffect(() => {
    Promise.all([
      apiGet<AirportRow[]>("/api/airports").then((rows) => rows.find((a) => a.iata === id) ?? null),
      apiGet<Activity>(`/api/airports/${id}/activity`),
    ])
      .then(([a, act]) => {
        setAirport(a);
        setActivity(act);
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(() => {
    apiGet<{ roles?: string[] }>("/api/me")
      .then((me) => setRoles(me.roles ?? []))
      .catch(() => setRoles([]));
  }, []);

  if (error) return <div style={{ color: "red" }}>Error: {error}</div>;
  if (!airport || !activity) return <div>Loading…</div>;

  return (
    <div>
      <DetailHeader
        title={`${airport.iata} · ${airport.name}`}
        subtitle={`${airport.city}, ${airport.country}`}
        backTo="/airports"
        backLabel="Airports"
        editTo={canWrite(roles, "airports", "update") ? `/airports/${id}/edit` : undefined}
      />

      <DetailTabs
        tabs={[
          {
            key: "overview",
            label: "Overview",
            render: () => (
              <FieldGrid
                fields={[
                  { label: "IATA", value: airport.iata },
                  { label: "ICAO", value: airport.icao },
                  { label: "Latitude", value: airport.latitude },
                  { label: "Longitude", value: airport.longitude },
                  { label: "Elevation (ft)", value: airport.elevation_ft },
                  { label: "Timezone", value: airport.timezone },
                ]}
              />
            ),
          },
          {
            key: "now",
            label: "There now",
            badge: activity.cargo.length + activity.passengers.length + activity.vehicles.length,
            render: () => (
              <>
                <Section title={`Cargo on the ground (${activity.cargo.length})`}>
                  <DataTable
                    rows={activity.cargo}
                    rowKey={(c) => c.cargo_id}
                    columns={[
                      {
                        key: "id",
                        header: "Shipment",
                        render: (c) => <Link to={`/cargo/${c.cargo_id}`}>{c.cargo_id}</Link>,
                      },
                      { key: "customer", header: "Customer", render: (c) => c.customer_name },
                      {
                        key: "route",
                        header: "Route",
                        render: (c) => `${c.origin_iata} → ${c.destination_iata}`,
                      },
                      { key: "kg", header: "Weight", render: (c) => `${c.weight_kg} kg` },
                      { key: "state", header: "State", render: (c) => <Badge value={c.state} /> },
                    ]}
                    empty="No cargo recorded at this airport"
                  />
                </Section>
                <Section title={`Passengers in transit via (${activity.passengers.length})`}>
                  <DataTable
                    rows={activity.passengers}
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
                      {
                        key: "route",
                        header: "Route",
                        render: (p) => `${p.origin_iata} → ${p.destination_iata}`,
                      },
                      { key: "state", header: "State", render: (p) => <Badge value={p.state} /> },
                    ]}
                    empty="No passengers recorded at this airport"
                  />
                </Section>
                <Section title={`Vehicles based here (${activity.vehicles.length})`}>
                  <DataTable
                    rows={activity.vehicles}
                    rowKey={(v) => v.vehicle_id}
                    columns={[
                      {
                        key: "vehicle",
                        header: "Vehicle",
                        render: (v) => (
                          <Link to={`/vehicles/${v.vehicle_id}`}>{v.registration ?? v.vehicle_id}</Link>
                        ),
                      },
                      { key: "kind", header: "Kind", render: (v) => v.kind },
                      { key: "model", header: "Model", render: (v) => v.model_id ?? "—" },
                      { key: "status", header: "Status", render: (v) => (v.status ? <Badge value={v.status} /> : "—") },
                    ]}
                    empty="No vehicles based at this airport"
                  />
                </Section>
              </>
            ),
          },
          {
            key: "through",
            label: "Through this airport",
            badge: activity.through_today.length,
            render: () => (
              <Section title="Trip legs touching this airport">
                <DataTable
                  rows={activity.through_today.slice(0, 100)}
                  rowKey={(l) => `${l.trip_id}-${l.sequence}`}
                  columns={[
                    {
                      key: "trip",
                      header: "Trip",
                      render: (l) => <Link to={`/trips/${l.trip_id}`}>{l.trip_id}</Link>,
                    },
                    {
                      key: "route",
                      header: "Route",
                      render: (l) => <Link to={`/routes/${l.route_id}`}>{l.route_id}</Link>,
                    },
                    { key: "date", header: "Operating", render: (l) => formatDate(l.operating_date) },
                    { key: "leg", header: "Leg", render: (l) => `${l.from_iata} → ${l.to_iata}` },
                    { key: "dep", header: "Departure", render: (l) => formatDateTime(l.scheduled_departure) },
                    {
                      key: "vehicle",
                      header: "Vehicle",
                      render: (l) => <Link to={`/vehicles/${l.vehicle_id}`}>{l.vehicle_id}</Link>,
                    },
                    { key: "status", header: "Status", render: (l) => <Badge value={l.status} /> },
                  ]}
                  empty="No trips pass through this airport"
                />
              </Section>
            ),
          },
        ]}
      />
    </div>
  );
}