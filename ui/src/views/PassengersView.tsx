import React, { useEffect, useState } from "react";
import { apiFetch } from "../lib/auth.js";

interface Passenger {
  passenger_id: string;
  given_name: string;
  family_name: string;
  passenger_type: string;
  order_id: string | null;
  operator_id: string;
  origin_iata: string;
  destination_iata: string;
  status: string;
  valid_time: string;
}

export function PassengersView(): React.ReactElement {
  const [passengers, setPassengers] = useState<Passenger[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");

  useEffect(() => {
    apiFetch(`/api/passengers${statusFilter ? `?status=${statusFilter}` : ""}`)
      .then((r) => r.json())
      .then(setPassengers)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  if (loading) return <div>Loading…</div>;
  if (error) return <div style={{ color: "red" }}>Error: {error}</div>;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Passengers ({passengers.length})</h1>
      <div style={{ marginBottom: 16 }}>
        {["", "checked_in", "boarded", "in_transit", "arrived", "disembarked"].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            style={{
              marginRight: 8,
              padding: "4px 12px",
              background: statusFilter === s ? "#8be9fd" : "white",
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
            <th style={th}>Status</th>
            <th style={th}>Order</th>
          </tr>
        </thead>
        <tbody>
          {passengers.map((p) => (
            <tr key={p.passenger_id} style={{ borderBottom: "1px solid #eee" }}>
              <td style={td}>{p.passenger_id}</td>
              <td style={td}>{p.given_name} {p.family_name}</td>
              <td style={td}>{p.passenger_type}</td>
              <td style={td}>{p.operator_id}</td>
              <td style={td}>{p.origin_iata} → {p.destination_iata}</td>
              <td style={td}>{p.status}</td>
              <td style={td}>{p.order_id ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const th: React.CSSProperties = { padding: "8px 12px", fontSize: "0.85rem" };
const td: React.CSSProperties = { padding: "8px 12px", fontSize: "0.9rem" };