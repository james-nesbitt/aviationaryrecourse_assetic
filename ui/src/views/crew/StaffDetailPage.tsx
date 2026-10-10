import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet, type FatigueRow, type TripLeg } from "../../lib/api.js";
import { Badge, DataTable, DetailHeader, DetailTabs, FieldGrid, Section, StatCard } from "../../components/index.jsx";
import { formatDate, formatHours, legChain, tripHours } from "../../lib/format.js";

interface StaffAssignment {
  assignment_id: string;
  crew_role: string;
  trip_id: string;
  route_id: string;
  operating_date: string;
  status: string;
  vehicle_id: string;
  legs: TripLeg[];
}
interface StaffDetail {
  staff_id: string;
  given_name: string;
  family_name: string;
  role: string;
  role_class: string;
  operator_id: string;
  base_iata: string;
  date_of_birth: string;
  age: number;
  years_of_service: number;
  hire_date: string;
  certifications: string[];
  keycloak_username: string | null;
  assignments: StaffAssignment[];
  fatigue: FatigueRow | null;
}

/** One staff member: duty record and fatigue standing. */
export function StaffDetailPage(): React.ReactElement {
  const { id = "" } = useParams();
  const [staff, setStaff] = useState<StaffDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<StaffDetail>(`/api/staff/${id}`)
      .then(setStaff)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  if (error) return <div style={{ color: "red" }}>Error: {error}</div>;
  if (!staff) return <div>Loading…</div>;

  // Trip status is anchor-relative; using it avoids depending on the wall clock.
  const upcoming = staff.assignments.filter(
    (a) => a.status === "scheduled" || a.status === "in_progress",
  );

  return (
    <div>
      <DetailHeader
        title={`${staff.given_name} ${staff.family_name}`}
        subtitle={`${staff.role} · ${staff.role_class} · ${staff.operator_id} · base ${staff.base_iata}`}
        backTo="/staff"
        backLabel="Staff"
      />

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <StatCard
          label="Fatigue"
          value={staff.fatigue ? <Badge value={staff.fatigue.level} /> : "n/a"}
          sub={staff.role_class === "flight_crew" ? undefined : "not flight crew"}
        />
        <StatCard label="Duty hours (7d)" value={formatHours(staff.fatigue?.duty_hours_7d)} />
        <StatCard label="Consecutive days" value={staff.fatigue?.consecutive_duty_days ?? 0} />
        <StatCard label="Rest since last" value={formatHours(staff.fatigue?.rest_since_last_hours)} />
        <StatCard label="Assignments" value={staff.assignments.length} />
        <StatCard label="Upcoming" value={upcoming.length} />
      </div>

      <DetailTabs
        tabs={[
          { key: "overview", label: "Overview", render: () => (<>
      <Section title="Details">
        <FieldGrid
          fields={[
            { label: "Age", value: staff.age },
            { label: "Date of birth", value: formatDate(staff.date_of_birth) },
            { label: "Hired", value: formatDate(staff.hire_date) },
            { label: "Years of service", value: staff.years_of_service },
            { label: "Base", value: staff.base_iata },
            { label: "Certifications", value: staff.certifications?.join(", ") || "—" },
            { label: "Login", value: staff.keycloak_username ?? "not linked" },
          ]}
        />
      </Section>

          </>) },
          { key: "duty", label: "Duty record", badge: staff.assignments.length, render: () => (<>
      <Section title="Duty record">
        <DataTable
          rows={staff.assignments.slice(0, 30)}
          rowKey={(a) => a.assignment_id}
          columns={[
            { key: "date", header: "Date", render: (a) => formatDate(a.operating_date) },
            { key: "trip", header: "Trip", render: (a) => <Link to={`/trips/${a.trip_id}`}>{a.trip_id}</Link> },
            { key: "route", header: "Route", render: (a) => <Link to={`/routes/${a.route_id}`}>{a.route_id}</Link> },
            { key: "legs", header: "Itinerary", render: (a) => legChain(a.legs) },
            { key: "hours", header: "Block", render: (a) => formatHours(tripHours(a.legs)) },
            { key: "role", header: "Role", render: (a) => a.crew_role },
            { key: "status", header: "Status", render: (a) => <Badge value={a.status} /> },
          ]}
          empty="No crew assignments"
        />
      </Section>
          </>) },
        ]}
      />
    </div>
  );
}
