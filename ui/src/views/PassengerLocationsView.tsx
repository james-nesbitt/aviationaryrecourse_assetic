import React, { useEffect, useState } from "react";
import { apiFetch } from "../lib/auth.js";

interface PassengerLocation {
  passenger_id: string;
  given_name: string;
  family_name: string;
  passenger_type: string;
  operator_id: string;
  origin_iata: string;
  destination_iata: string;
  passenger_status: string;
  last_event_type: string | null;
  current_location_iata: string | null;
  current_vehicle_id: string | null;
  last_event_time: string | null;
  last_sequence: number | null;
}

export function PassengerLocationsView(): React.ReactElement {
  const [locations, setLocations] = useState<PassengerLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/passengers/locations")
      .then((r) => r.json())
      .then(setLocations)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div>Loading…</div>;
  if (error) return <div style={{ color: "red" }}>Error: {error}</div>;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Passenger Locations ({locations.length})</h1>
      <table style={{ borderCollapse: "collapse", width: "100%", background: "white" }}>
        <thead>
          <tr style={{ background: "#1a1a2e", color: "#eee", textAlign: "left" }}>
            <th style={th}>ID</th>
            <th style={th}>Name</th>
            <th style={th}>Type</th>
            <th style={th}>Operator</th>
            <th style={th}>Origin</th>
            <th style={th}>Destination</th>
            <th style={th}>Current Location</th>
            <th style={th}>Last Event</th>
            <th style={th}>Vehicle</th>
            <th style={th}>Status</th>
          </tr>
        </thead>
        <tbody>
          {locations.map((l) => (
            <tr key={l.passenger_id} style={{ borderBottom: "1px solid #eee" }}>
              <td style={td}>{l.passenger_id}</td>
              <td style={td}>{l.given_name} {l.family_name}</td>
              <td style={td}>{l.passenger_type}</td>
              <td style={td}>{l.operator_id}</td>
              <td style={td}>{l.origin_iata}</td>
              <td style={td}>{l.destination_iata}</td>
              <td style={td}>
                {l.current_location_iata ? (
                  <strong style={{ color: l.passenger_status === "disembarked" ? "#50fa7b" : "#8be9fd" }}>
                    {l.current_location_iata}
                  </strong>
                ) : "—"}
              </td>
              <td style={td}>{l.last_event_type ?? "—"}</td>
              <td style={td}>{l.current_vehicle_id ?? "—"}</td>
              <td style={td}>{l.passenger_status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const th: React.CSSProperties = { padding: "8px 12px", fontSize: "0.85rem" };
const td: React.CSSProperties = { padding: "8px 12px", fontSize: "0.9rem" };