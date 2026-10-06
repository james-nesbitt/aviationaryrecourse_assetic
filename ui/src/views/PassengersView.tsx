import React, { useEffect, useState } from "react";
import { apiFetch } from "../lib/auth.js";

/** Row shape from the passenger_state projection view. */
interface PassengerStateRow {
  passenger_id: string;
  given_name: string;
  family_name: string;
  passenger_type: string;
  order_id: string | null;
  operator_id: string;
  operator_name: string;
  origin_iata: string;
  destination_iata: string;
  state: string;
  last_event_type: string | null;
  current_location_iata: string | null;
  current_vehicle_id: string | null;
  last_event_time: string | null;
  last_sequence: number | null;
}

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

export function PassengersView(): React.ReactElement {
  const [passengers, setPassengers] = useState<PassengerStateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [eventsById, setEventsById] = useState<Record<string, TransitEvent[]>>({});

  useEffect(() => {
    setLoading(true);
    apiFetch(`/api/passengers${stateFilter ? `?state=${stateFilter}` : ""}`)
      .then((r) => r.json())
      .then(setPassengers)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [stateFilter]);

  async function toggleExpand(passengerId: string): Promise<void> {
    if (expanded === passengerId) {
      setExpanded(null);
      return;
    }
    setExpanded(passengerId);
    if (!eventsById[passengerId]) {
      const events = await apiFetch(`/api/passengers/${passengerId}/events`).then((r) => r.json());
      setEventsById((prev) => ({ ...prev, [passengerId]: events }));
    }
  }

  if (loading) return <div>Loading…</div>;
  if (error) return <div style={{ color: "red" }}>Error: {error}</div>;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Passengers ({passengers.length})</h1>
      <div style={{ marginBottom: 16 }}>
        {["", "booked", "checked_in", "boarded", "in_transit", "arrived", "disembarked"].map((s) => (
          <button
            key={s}
            onClick={() => setStateFilter(s)}
            style={{
              marginRight: 8,
              padding: "4px 12px",
              background: stateFilter === s ? "#8be9fd" : "white",
              border: "1px solid #ccc",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            {s || "All"}
          </button>
        ))}
      </div>
      <table style={{ borderCollapse: "collapse", width: "100%", background: "white" }}>
        <thead>
          <tr style={{ background: "#1a1a2e", color: "#eee", textAlign: "left" }}>
            <th style={th}>ID</th>
            <th style={th}>Name</th>
            <th style={th}>Type</th>
            <th style={th}>Operator</th>
            <th style={th}>Route</th>
            <th style={th}>State</th>
            <th style={th}>Location</th>
            <th style={th}>Last event</th>
            <th style={th}>Order</th>
            <th style={th}>Details</th>
          </tr>
        </thead>
        <tbody>
          {passengers.map((p) => (
            <React.Fragment key={p.passenger_id}>
              <tr
                style={{ borderBottom: "1px solid #eee", cursor: "pointer" }}
                onClick={() => void toggleExpand(p.passenger_id)}
              >
                <td style={td}>{p.passenger_id}</td>
                <td style={td}>{p.given_name} {p.family_name}</td>
                <td style={td}>{p.passenger_type}</td>
                <td style={td}>{p.operator_name}</td>
                <td style={td}>{p.origin_iata} → {p.destination_iata}</td>
                <td style={td}>{p.state}</td>
                <td style={td}>{p.current_location_iata ?? "—"}</td>
                <td style={td}>{p.last_event_type ?? "—"}</td>
                <td style={td}>{p.order_id ?? "—"}</td>
                <td style={td}>{expanded === p.passenger_id ? "▲" : "▼"}</td>
              </tr>
              {expanded === p.passenger_id && (
                <tr onClick={(e) => e.stopPropagation()}>
                  <td colSpan={10} style={{ padding: 16, background: "#f9f9f9" }}>
                    <table style={{ borderCollapse: "collapse", width: "100%" }}>
                      <thead>
                        <tr style={{ textAlign: "left", color: "#666" }}>
                          <th style={subTh}>Seq</th>
                          <th style={subTh}>Event</th>
                          <th style={subTh}>From → To</th>
                          <th style={subTh}>Location</th>
                          <th style={subTh}>Vehicle</th>
                          <th style={subTh}>Facility</th>
                          <th style={subTh}>Actor</th>
                          <th style={subTh}>Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(eventsById[p.passenger_id] ?? []).map((e) => (
                          <tr key={e.event_id}>
                            <td style={subTd}>{e.sequence}</td>
                            <td style={subTd}>{e.event_type}</td>
                            <td style={subTd}>{e.from_state} → {e.to_state}</td>
                            <td style={subTd}>{e.location_iata}</td>
                            <td style={subTd}>{e.vehicle_id ?? "—"}</td>
                            <td style={subTd}>{e.facility_id ?? "—"}</td>
                            <td style={subTd}>{e.actor_id ?? "—"}</td>
                            <td style={subTd}>{e.valid_time}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const th: React.CSSProperties = { padding: "8px 12px", fontSize: "0.85rem" };
const td: React.CSSProperties = { padding: "8px 12px", fontSize: "0.9rem" };
const subTh: React.CSSProperties = { padding: "4px 8px", fontSize: "0.8rem" };
const subTd: React.CSSProperties = { padding: "4px 8px", fontSize: "0.85rem" };