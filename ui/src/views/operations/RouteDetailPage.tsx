import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  apiDelete,
  apiGet,
  apiSend,
  type RouteAssignment,
  type Trip,
  type TripLeg,
} from "../../lib/api.js";
import { canWrite, hasEditForm } from "../../lib/permissions.js";
import { Badge, DataTable, DetailHeader, DetailTabs, Section, StatCard, Timeline } from "../../components/index.jsx";
import { formatDate, formatDateTime, legChain } from "../../lib/format.js";
import { getUser } from "../../lib/auth.js";

interface MaintenanceWindow {
  maintenance_id: string;
  vehicle_id: string;
  maintenance_type: string;
  start_date: string;
  end_date: string;
  status: string;
}

interface RouteDetail {
  route_id: string;
  operator_id: string;
  vehicle_id: string;
  route_type: string;
  base_iata: string;
  frequency_days: number;
  first_operating_date: string;
  legs: TripLeg[];
  assignments: RouteAssignment[];
  next_trip: Trip | null;
  trip_count: number;
}

/** Route pattern, its vehicle-assignment history, and its dated trips. */
export function RouteDetailPage(): React.ReactElement {
  const { id = "" } = useParams();
  const [route, setRoute] = useState<RouteDetail | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [maintenance, setMaintenance] = useState<MaintenanceWindow[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const navigate = useNavigate();
  const canEdit = (getUser()?.roles ?? []).includes("route_manager");

  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [frequency, setFrequency] = useState("");
  const [vehicle, setVehicle] = useState("");

  function load(): void {
    Promise.all([
      apiGet<RouteDetail>(`/api/routes/${id}`),
      apiGet<Trip[]>(`/api/routes/${id}/trips`),
      apiGet<MaintenanceWindow[]>("/api/vehicle-maintenance"),
    ])
      .then(([r, t, m]) => {
        setRoute(r);
        setTrips(t);
        setMaintenance(m.filter((w) => w.vehicle_id === r.vehicle_id));
        setFrequency(String(r.frequency_days));
        setVehicle(r.vehicle_id);
      })
      .catch((e: Error) => setError(e.message));
  }

  useEffect(load, [id]);

  useEffect(() => {
    apiGet<{ roles?: string[] }>("/api/me")
      .then((me) => setRoles(me.roles ?? []))
      .catch(() => setRoles([]));
  }, []);

  async function submitChange(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setMessage(null);
    const { ok, status, data } = await apiSend<{ error?: string; trips_created?: number; trips_removed?: number }>(
      "PATCH",
      `/api/routes/${id}`,
      {
        effective_from: effectiveFrom,
        frequency_days: Number(frequency),
        vehicle_id: vehicle,
      },
    );
    setMessage(
      ok
        ? `Applied: ${data.trips_removed ?? 0} trips removed, ${data.trips_created ?? 0} regenerated.`
        : `Rejected (${status}): ${data.error ?? "unknown error"}`,
    );
    if (ok) load();
  }

  if (error) return <div style={{ color: "red" }}>Error: {error}</div>;
  if (!route) return <div>Loading…</div>;

  const upcoming = trips.filter((t) => t.status === "scheduled" || t.status === "in_progress");

  return (
    <div>
      <DetailHeader
        title={`${route.route_id} · ${legChain(route.legs)}`}
        subtitle={`${route.route_type} · every ${route.frequency_days}d from ${formatDate(route.first_operating_date)} · ${route.operator_id}`}
        backTo="/operations"
        backLabel="Operations"
        editTo={canWrite(roles, "routes", "update") && hasEditForm("routes") ? `/routes/${id}/edit` : undefined}
        onDelete={
          canWrite(roles, "routes", "delete")
            ? () => {
                void apiDelete(`/api/routes/${id}`).then(() => navigate("/routes"));
              }
            : undefined
        }
      />

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <StatCard label="Trips" value={route.trip_count} />
        <StatCard label="Upcoming" value={upcoming.length} />
        <StatCard label="Current vehicle" value={route.vehicle_id} />
        <StatCard label="Next trip" value={route.next_trip ? formatDate(route.next_trip.operating_date) : "—"} />
      </div>

      <DetailTabs
        tabs={[
          { key: "overview", label: "Overview", render: () => (<>
      <Section title="Pattern legs">
        <DataTable
          rows={route.legs}
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
          { key: "assignments", label: "Vehicle assignments", badge: route.assignments.length, render: () => (<>
      <Section title="Vehicle assignments">
        <Timeline
          items={route.assignments.map((a) => ({
            id: a.assignment_id,
            label: `${a.vehicle_id} · ${a.reason}`,
            start: a.valid_from,
            end: a.valid_to,
            tone: a.reason === "maintenance_cover" ? "maintenance" : "completed",
          }))}
        />
        <div style={{ marginTop: 12 }}>
          <DataTable
            rows={route.assignments}
            rowKey={(a) => a.assignment_id}
            columns={[
              { key: "vehicle", header: "Vehicle", render: (a) => a.vehicle_id },
              { key: "from", header: "From", render: (a) => formatDate(a.valid_from) },
              { key: "to", header: "To", render: (a) => (a.valid_to ? formatDate(a.valid_to) : "open") },
              { key: "reason", header: "Reason", render: (a) => a.reason },
              { key: "replaces", header: "Replaces", render: (a) => a.replaces_vehicle_id ?? "—" },
            ]}
          />
        </div>
      </Section>

          </>) },
          { key: "maintenance", label: "Maintenance", badge: maintenance.length, render: () => (<>
      <Section title="Maintenance windows on this route's vehicles">
        <DataTable
          rows={maintenance}
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
            { key: "vehicle", header: "Vehicle", render: (w) => <Link to={`/vehicles/${w.vehicle_id}`}>{w.vehicle_id}</Link> },
            { key: "from", header: "From", render: (w) => formatDate(w.start_date) },
            { key: "to", header: "To", render: (w) => formatDate(w.end_date) },
            { key: "status", header: "Status", render: (w) => <Badge value={w.status} /> },
            {
              key: "impact",
              header: "Trips cancelled",
              render: (w) => {
                const inWindow = trips.filter(
                  (t) =>
                    t.status === "cancelled" &&
                    t.vehicle_id === w.vehicle_id &&
                    t.operating_date.slice(0, 10) >= w.start_date.slice(0, 10) &&
                    t.operating_date.slice(0, 10) <= w.end_date.slice(0, 10),
                );
                return inWindow.length;
              },
            },
          ]}
          empty="No maintenance windows recorded for this route's vehicles"
        />
      </Section>
          </>) },
          { key: "manage", label: "Manage", render: () => (<>
      {canEdit ? (
        <Section title="Change this route">
          <form onSubmit={submitChange} style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            <label style={{ fontSize: "0.85rem" }}>
              Effective from
              <br />
              <input
                type="date"
                required
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
            </label>
            <label style={{ fontSize: "0.85rem" }}>
              Frequency (days)
              <br />
              <input type="number" min={1} value={frequency} onChange={(e) => setFrequency(e.target.value)} />
            </label>
            <label style={{ fontSize: "0.85rem" }}>
              Vehicle
              <br />
              <input value={vehicle} onChange={(e) => setVehicle(e.target.value)} />
            </label>
            <button type="submit">Apply from date</button>
          </form>
          <p style={{ fontSize: "0.8rem", color: "#777", marginTop: 8 }}>
            Past trips are never rewritten. The change closes the open assignment interval the day before and
            regenerates only trips on or after the effective date; it is rejected when those trips already have crew.
          </p>
          {message ? <div style={{ marginTop: 8, fontSize: "0.9rem" }}>{message}</div> : null}
        </Section>
      ) : null}

          </>) },
          { key: "trips", label: "Trips", badge: route.trip_count, render: () => (<>
      <Section title="Trips">
        <DataTable
          rows={trips.slice(0, 30)}
          rowKey={(t) => t.trip_id}
          columns={[
            { key: "date", header: "Date", render: (t) => formatDate(t.operating_date) },
            { key: "trip", header: "Trip", render: (t) => <Link to={`/trips/${t.trip_id}`}>{t.trip_id}</Link> },
            { key: "vehicle", header: "Vehicle", render: (t) => t.vehicle_id },
            { key: "status", header: "Status", render: (t) => <Badge value={t.status} /> },
          ]}
        />
      </Section>
          </>) },
        ]}
      />
    </div>
  );
}
