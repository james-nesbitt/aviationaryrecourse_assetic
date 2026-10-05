import React, { useEffect, useState } from "react";
import { apiFetch } from "../lib/auth.js";

interface Cargo {
  cargo_id: string;
  customer_id: string;
  operator_id: string;
  origin_iata: string;
  destination_iata: string;
  assigned_vehicle_id: string | null;
  weight_kg: number;
  cargo_type: string;
  status: string;
  valid_time: string;
  customer?: { company_name: string };
  operator?: { name: string };
}

export function CargoView(): React.ReactElement {
  const [cargo, setCargo] = useState<Cargo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");

  useEffect(() => {
    apiFetch(`/api/cargo${statusFilter ? `?status=${statusFilter}` : ""}`)
      .then((r) => r.json())
      .then(setCargo)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  if (loading) return <div>Loading…</div>;
  if (error) return <div style={{ color: "red" }}>Error: {error}</div>;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Cargo ({cargo.length})</h1>
      <div style={{ marginBottom: 16 }}>
        {["", "scheduled", "loaded", "in_transit", "delivered"].map((s) => (
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
            <th style={th}>Customer</th>
            <th style={th}>Operator</th>
            <th style={th}>Route</th>
            <th style={th}>Vehicle</th>
            <th style={th}>Weight</th>
            <th style={th}>Type</th>
            <th style={th}>Status</th>
          </tr>
        </thead>
        <tbody>
          {cargo.map((c) => (
            <tr key={c.cargo_id} style={{ borderBottom: "1px solid #eee" }}>
              <td style={td}>{c.cargo_id}</td>
              <td style={td}>{c.customer?.company_name ?? c.customer_id}</td>
              <td style={td}>{c.operator?.name ?? c.operator_id}</td>
              <td style={td}>{c.origin_iata} → {c.destination_iata}</td>
              <td style={td}>{c.assigned_vehicle_id ?? "—"}</td>
              <td style={td}>{c.weight_kg.toLocaleString()} kg</td>
              <td style={td}>{c.cargo_type}</td>
              <td style={td}>{c.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const th: React.CSSProperties = { padding: "8px 12px", fontSize: "0.85rem" };
const td: React.CSSProperties = { padding: "8px 12px", fontSize: "0.9rem" };