import React, { useEffect, useState } from "react";
import { apiFetch } from "../lib/auth.js";

interface CargoLocation {
  cargo_id: string;
  customer_id: string;
  operator_id: string;
  origin_iata: string;
  destination_iata: string;
  cargo_status: string;
  last_event_type: string | null;
  current_location_iata: string | null;
  current_facility_id: string | null;
  current_vehicle_id: string | null;
  last_event_time: string | null;
  last_sequence: number | null;
}

export function CargoLocationsView(): React.ReactElement {
  const [locations, setLocations] = useState<CargoLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/cargo/locations")
      .then((r) => r.json())
      .then(setLocations)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div>Loading…</div>;
  if (error) return <div style={{ color: "red" }}>Error: {error}</div>;

  const inTransit = locations.filter((l) => l.cargo_status !== "delivered");
  const delivered = locations.filter((l) => l.cargo_status === "delivered");

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Cargo Locations ({locations.length})</h1>
      <div style={{ marginBottom: 16, display: "flex", gap: 16 }}>
        <div style={{ background: "white", padding: "1rem", borderRadius: 8, minWidth: 120 }}>
          <div style={{ fontSize: "2rem", fontWeight: 700 }}>{inTransit.length}</div>
          <div style={{ color: "#666", fontSize: "0.9rem" }}>In transit</div>
        </div>
        <div style={{ background: "white", padding: "1rem", borderRadius: 8, minWidth: 120 }}>
          <div style={{ fontSize: "2rem", fontWeight: 700 }}>{delivered.length}</div>
          <div style={{ color: "#666", fontSize: "0.9rem" }}>Delivered</div>
        </div>
      </div>
      <table style={{ borderCollapse: "collapse", width: "100%", background: "white" }}>
        <thead>
          <tr style={{ background: "#1a1a2e", color: "#eee", textAlign: "left" }}>
            <th style={th}>Cargo ID</th>
            <th style={th}>Customer</th>
            <th style={th}>Operator</th>
            <th style={th}>Origin</th>
            <th style={th}>Destination</th>
            <th style={th}>Current Location</th>
            <th style={th}>Last Event</th>
            <th style={th}>Vehicle</th>
            <th style={th}>Facility</th>
            <th style={th}>Status</th>
          </tr>
        </thead>
        <tbody>
          {locations.map((l) => (
            <tr key={l.cargo_id} style={{ borderBottom: "1px solid #eee" }}>
              <td style={td}>{l.cargo_id}</td>
              <td style={td}>{l.customer_id}</td>
              <td style={td}>{l.operator_id}</td>
              <td style={td}>{l.origin_iata}</td>
              <td style={td}>{l.destination_iata}</td>
              <td style={td}>
                {l.current_location_iata ? (
                  <strong style={{ color: l.cargo_status === "delivered" ? "#50fa7b" : "#8be9fd" }}>
                    {l.current_location_iata}
                  </strong>
                ) : "—"}
              </td>
              <td style={td}>{l.last_event_type ?? "—"}</td>
              <td style={td}>{l.current_vehicle_id ?? "—"}</td>
              <td style={td}>{l.current_facility_id ?? "—"}</td>
              <td style={td}>{l.cargo_status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const th: React.CSSProperties = { padding: "8px 12px", fontSize: "0.85rem" };
const td: React.CSSProperties = { padding: "8px 12px", fontSize: "0.9rem" };