import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiDelete, apiGet, apiSend, type CrewMember, type FatigueRow, type Trip } from "../../lib/api.js";
import { canWrite, hasEditForm } from "../../lib/permissions.js";
import { Badge, DataTable, DetailHeader, DetailTabs, EmptyState, Section, StatCard } from "../../components/index.jsx";
import { formatDate, formatDateTime, formatHours, legChain, tripHours } from "../../lib/format.js";
import { getUser } from "../../lib/auth.js";

interface CargoRow {
  cargo_id: string;
  trip_id: string | null;
  origin_iata: string;
  destination_iata: string;
  state: string;
  weight_kg: number;
}
interface PassengerRow {
  passenger_id: string;
  trip_id: string | null;
  given_name: string;
  family_name: string;
  state: string;
}

/** One dated trip: its timetable, crew, and who/what it carries. */
export function TripDetailPage(): React.ReactElement {
  const { id = "" } = useParams();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [cargo, setCargo] = useState<CargoRow[]>([]);
  const [passengers, setPassengers] = useState<PassengerRow[]>([]);
  const [eligible, setEligible] = useState<FatigueRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canEdit = (getUser()?.roles ?? []).includes("route_manager");
  const [roles, setRoles] = useState<string[]>([]);
  const navigate = useNavigate();

  function load(): void {
    apiGet<Trip>(`/api/trips/${id}`)
      .then(async (t) => {
        setTrip(t);
        const [c, allCargo, allPax, fatigue] = await Promise.all([
          apiGet<CrewMember[]>(`/api/trips/${id}/crew`),
          apiGet<CargoRow[]>("/api/cargo"),
          apiGet<PassengerRow[]>("/api/passengers"),
          apiGet<FatigueRow[]>(`/api/staff/fatigue?operatorId=${t.operator_id}`),
        ]);
        setCrew(c);
        setCargo(allCargo.filter((r) => r.trip_id === id));
        setPassengers(allPax.filter((r) => r.trip_id === id));
        setEligible(fatigue);
      })
      .catch((e: Error) => setError(e.message));
  }

  useEffect(load, [id]);

  useEffect(() => {
    apiGet<{ roles?: string[] }>("/api/me")
      .then((me) => setRoles(me.roles ?? []))
      .catch(() => setRoles([]));
  }, []);

  async function assign(staffId: string): Promise<void> {
    const { ok, status, data } = await apiSend<{ error?: string }>("POST", "/api/crew-assignments", {
      trip_id: id,
      staff_id: staffId,
    });
    setMessage(ok ? "Crew assigned." : `Rejected (${status}): ${data.error ?? "unknown error"}`);
    if (ok) load();
  }

  if (error) return <div style={{ color: "red" }}>Error: {error}</div>;
  if (!trip) return <div>Loading…</div>;

  const assigned = new Set(crew.map((c) => c.staff_id));
  const candidates = eligible.filter((f) => !assigned.has(f.staff_id));

  return (
    <div>
      <DetailHeader
        title={`${trip.trip_id} · ${legChain(trip.legs)}`}
        subtitle={`${formatDate(trip.operating_date)} · vehicle ${trip.vehicle_id} · route ${trip.route_id}`}
        backTo={`/routes/${trip.route_id}`}
        backLabel="Route"
        editTo={canWrite(roles, "trips", "update") && hasEditForm("trips") ? `/trips/${id}/edit` : undefined}
        onDelete={
          canWrite(roles, "trips", "delete")
            ? () => {
                void apiDelete(`/api/trips/${id}`).then(() => navigate("/trips"));
              }
            : undefined
        }
      />

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <StatCard label="Status" value={<Badge value={trip.status} />} />
        <StatCard label="Block time" value={formatHours(tripHours(trip.legs))} />
        <StatCard label="Crew" value={crew.length} />
        <StatCard label="Cargo" value={cargo.length} />
        <StatCard label="Passengers" value={passengers.length} />
      </div>

      <DetailTabs
        tabs={[
          { key: "overview", label: "Timetable", render: () => (<>
      <Section title="Timetable">
        <DataTable
          rows={trip.legs}
          rowKey={(l) => String(l.sequence)}
          columns={[
            { key: "seq", header: "#", render: (l) => l.sequence },
            { key: "from", header: "From", render: (l) => l.from_iata },
            { key: "to", header: "To", render: (l) => l.to_iata },
            { key: "dep", header: "Departure", render: (l) => formatDateTime(l.scheduled_departure) },
            { key: "arr", header: "Arrival", render: (l) => formatDateTime(l.scheduled_arrival) },
          ]}
        />
      </Section>

          </>) },
          { key: "crew", label: "Crew", badge: crew.length, render: () => (<>
      <Section title="Crew">
        <DataTable
          rows={crew}
          rowKey={(c) => c.assignment_id}
          columns={[
            {
              key: "name",
              header: "Crew",
              render: (c) => (
                <Link to={`/staff/${c.staff_id}`}>
                  {c.given_name} {c.family_name}
                </Link>
              ),
            },
            { key: "role", header: "Role", render: (c) => c.crew_role },
          ]}
          empty="No crew assigned"
        />
        {canEdit && trip.status !== "cancelled" ? (
          <div style={{ marginTop: 12 }}>
            <strong style={{ fontSize: "0.85rem" }}>Assign crew</strong>
            {candidates.length === 0 ? (
              <EmptyState message="No further crew available for this operator." />
            ) : (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                {candidates.slice(0, 8).map((f) => (
                  <button key={f.staff_id} type="button" onClick={() => assign(f.staff_id)}>
                    {f.given_name} {f.family_name} ({f.role}, {f.level})
                  </button>
                ))}
              </div>
            )}
            {message ? <div style={{ marginTop: 8, fontSize: "0.9rem" }}>{message}</div> : null}
          </div>
        ) : null}
      </Section>

          </>) },
          { key: "cargo", label: "Cargo", badge: cargo.length, render: () => (<>
      <Section title="Cargo on board">
        <DataTable
          rows={cargo}
          rowKey={(c) => c.cargo_id}
          columns={[
            { key: "id", header: "Shipment", render: (c) => c.cargo_id },
            { key: "route", header: "Route", render: (c) => `${c.origin_iata} → ${c.destination_iata}` },
            { key: "kg", header: "Weight", render: (c) => `${c.weight_kg} kg` },
            { key: "state", header: "State", render: (c) => <Badge value={c.state} /> },
          ]}
          empty="No cargo booked on this trip"
        />
      </Section>

          </>) },
          { key: "pax", label: "Passengers", badge: passengers.length, render: () => (<>
      <Section title="Passengers on board">
        <DataTable
          rows={passengers.slice(0, 25)}
          rowKey={(p) => p.passenger_id}
          columns={[
            { key: "name", header: "Passenger", render: (p) => `${p.given_name} ${p.family_name}` },
            { key: "state", header: "State", render: (p) => <Badge value={p.state} /> },
          ]}
          empty="No passengers booked on this trip"
        />
      </Section>
          </>) },
        ]}
      />
    </div>
  );
}
