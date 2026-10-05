import React, { useEffect, useState } from "react";
import { apiFetch } from "../lib/auth.js";

interface Vehicle {
  vehicle_id: string;
  kind: string;
  operator_id: string;
  registration: string | null;
  model_id: string | null;
  status: string | null;
  seat_config: { f?: number; y?: number; troop_seats?: number } | null;
  base_iata: string | null;
  home_iata: string | null;
  gse_type: string | null;
  rail_type: string | null;
  operator?: { name: string };
  model?: { name: string; manufacturer: string };
}

export function VehiclesView(): React.ReactElement {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<string>("");

  useEffect(() => {
    async function load(): Promise<void> {
      try {
        const params = kindFilter ? `?kind=${kindFilter}` : "";
        const res = await apiFetch(`/api/vehicles${params}`);
        setVehicles(await res.json());
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [kindFilter]);

  if (loading) return <div>Loading…</div>;
  if (error) return <div style={{ color: "red" }}>Error: {error}</div>;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Vehicles ({vehicles.length})</h1>
      <div style={{ marginBottom: 16 }}>
        {["", "aircraft", "ground_support", "rail"].map((k) => (
          <button
            key={k}
            onClick={() => setKindFilter(k)}
            style={{
              marginRight: 8,
              padding: "4px 12px",
              background: kindFilter === k ? "#8be9fd" : "white",
              border: "1px solid #ccc",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            {k || "All"}
          </button>
        ))}
      </div>
      <table style={{ borderCollapse: "collapse", width: "100%", background: "white" }}>
        <thead>
          <tr style={{ background: "#1a1a2e", color: "#eee", textAlign: "left" }}>
            <th style={th}>ID</th>
            <th style={th}>Kind</th>
            <th style={th}>Registration</th>
            <th style={th}>Model</th>
            <th style={th}>Operator</th>
            <th style={th}>Status</th>
            <th style={th}>Base</th>
            <th style={th}>Seats</th>
          </tr>
        </thead>
        <tbody>
          {vehicles.map((v) => (
            <tr key={v.vehicle_id} style={{ borderBottom: "1px solid #eee" }}>
              <td style={td}>{v.vehicle_id}</td>
              <td style={td}>{v.kind}</td>
              <td style={td}>{v.registration ?? "—"}</td>
              <td style={td}>{v.model?.name ?? v.model_id ?? v.gse_type ?? v.rail_type ?? "—"}</td>
              <td style={td}>{v.operator?.name ?? v.operator_id}</td>
              <td style={td}>{v.status ?? "—"}</td>
              <td style={td}>{v.base_iata ?? v.home_iata ?? "—"}</td>
              <td style={td}>
                {v.seat_config
                  ? v.seat_config.f
                    ? `F:${v.seat_config.f} Y:${v.seat_config.y}`
                    : `Y:${v.seat_config.y}`
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const th: React.CSSProperties = { padding: "8px 12px", fontSize: "0.85rem" };
const td: React.CSSProperties = { padding: "8px 12px", fontSize: "0.9rem" };