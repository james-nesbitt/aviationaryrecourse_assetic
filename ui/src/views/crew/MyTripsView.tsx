import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, type FatigueRow, type Me, type TripLeg } from "../../lib/api.js";
import { Badge, DataTable, EmptyState, Section, StatCard } from "../../components/index.jsx";
import { formatDate, formatDateTime, formatHours, legChain, tripHours } from "../../lib/format.js";

interface MyAssignment {
  assignment_id: string;
  crew_role: string;
  trip_id: string;
  route_id: string;
  operating_date: string;
  status: string;
  vehicle_id: string;
  operator_id: string;
  legs: TripLeg[];
}

/** Flight-crew self-service: own duty record, fatigue and forward schedule. */
export function MyTripsView(): React.ReactElement {
  const [me, setMe] = useState<Me | null>(null);
  const [assignments, setAssignments] = useState<MyAssignment[]>([]);
  const [fatigue, setFatigue] = useState<FatigueRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Me>("/api/me")
      .then(async (m) => {
        setMe(m);
        if (!m.staff) return;
        const [a, f] = await Promise.all([
          apiGet<MyAssignment[]>("/api/my/assignments"),
          apiGet<FatigueRow | null>("/api/my/fatigue"),
        ]);
        setAssignments(a);
        setFatigue(f);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <div style={{ color: "red" }}>Error: {error}</div>;
  if (!me) return <div>Loading…</div>;

  if (!me.staff) {
    return (
      <div>
        <h1>My Schedule</h1>
        <EmptyState
          message={`No staff record is linked to ${me.username}. Crew self-service is available to accounts whose username matches a staff member.`}
        />
      </div>
    );
  }

  // Split on trip status, not the wall clock: trip status is derived from the
  // dataset anchor, so a demo dataset dated in the past still shows a
  // meaningful forward schedule.
  const past = assignments.filter((a) => a.status === "completed" || a.status === "cancelled").reverse();
  const upcoming = assignments.filter((a) => a.status === "scheduled" || a.status === "in_progress");

  return (
    <div>
      <h1>
        My Schedule · {me.staff.given_name} {me.staff.family_name}
      </h1>
      <div style={{ color: "#666", marginBottom: 16 }}>
        {me.staff.role} · {me.staff.operator_id}
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <StatCard
          label="Fatigue"
          value={fatigue ? <Badge value={fatigue.level} /> : "—"}
          sub="highest triggered metric"
        />
        <StatCard label="Duty hours (7d)" value={formatHours(fatigue?.duty_hours_7d)} />
        <StatCard label="Consecutive days" value={fatigue?.consecutive_duty_days ?? 0} />
        <StatCard label="Rest since last" value={formatHours(fatigue?.rest_since_last_hours)} />
        <StatCard label="Trips flown" value={past.length} />
        <StatCard label="Upcoming" value={upcoming.length} />
      </div>

      <Section title="Upcoming trips">
        <DataTable
          rows={upcoming.slice(0, 20)}
          rowKey={(a) => a.assignment_id}
          columns={[
            { key: "date", header: "Date", render: (a) => formatDate(a.operating_date) },
            { key: "trip", header: "Trip", render: (a) => <Link to={`/trips/${a.trip_id}`}>{a.trip_id}</Link> },
            { key: "legs", header: "Itinerary", render: (a) => legChain(a.legs) },
            { key: "report", header: "Report", render: (a) => formatDateTime(a.legs[0]?.scheduled_departure) },
            { key: "hours", header: "Block", render: (a) => formatHours(tripHours(a.legs)) },
            { key: "role", header: "Role", render: (a) => a.crew_role },
            { key: "status", header: "Status", render: (a) => <Badge value={a.status} /> },
          ]}
          empty="Nothing scheduled in the next period"
        />
      </Section>

      <Section title="Flown trips">
        <DataTable
          rows={past.slice(0, 25)}
          rowKey={(a) => a.assignment_id}
          columns={[
            { key: "date", header: "Date", render: (a) => formatDate(a.operating_date) },
            { key: "trip", header: "Trip", render: (a) => <Link to={`/trips/${a.trip_id}`}>{a.trip_id}</Link> },
            { key: "legs", header: "Itinerary", render: (a) => legChain(a.legs) },
            { key: "hours", header: "Block", render: (a) => formatHours(tripHours(a.legs)) },
            { key: "role", header: "Role", render: (a) => a.crew_role },
          ]}
          empty="No trips flown yet"
        />
      </Section>
    </div>
  );
}
