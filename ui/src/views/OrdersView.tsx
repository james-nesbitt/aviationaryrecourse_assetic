import React, { useEffect, useState } from "react";
import { apiFetch } from "../lib/auth.js";

interface Order {
  order_id: string;
  customer_id: string;
  operator_id: string;
  order_type: string;
  origin_iata: string;
  destination_iata: string;
  ordered_on: string;
  status: string;
  route_manager_id: string | null;
  passenger_group: { group_name: string; pax_count: number } | null;
  freight: { weight_kg: number; cargo_type: string } | null;
  customer?: { company_name: string };
  operator?: { name: string };
}

export function OrdersView(): React.ReactElement {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");

  useEffect(() => {
    apiFetch(`/api/orders${statusFilter ? `?status=${statusFilter}` : ""}`)
      .then((r) => r.json())
      .then(setOrders)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  if (loading) return <div>Loading…</div>;
  if (error) return <div style={{ color: "red" }}>Error: {error}</div>;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Orders ({orders.length})</h1>
      <div style={{ marginBottom: 16 }}>
        {["", "requested", "confirmed", "in_progress", "completed"].map((s) => (
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
            <th style={th}>Type</th>
            <th style={th}>Customer</th>
            <th style={th}>Operator</th>
            <th style={th}>Route</th>
            <th style={th}>Status</th>
            <th style={th}>Ordered</th>
            <th style={th}>Details</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.order_id} style={{ borderBottom: "1px solid #eee" }}>
              <td style={td}>{o.order_id}</td>
              <td style={td}>{o.order_type}</td>
              <td style={td}>{o.customer?.company_name ?? o.customer_id}</td>
              <td style={td}>{o.operator?.name ?? o.operator_id}</td>
              <td style={td}>{o.origin_iata} → {o.destination_iata}</td>
              <td style={td}>{o.status}</td>
              <td style={td}>{o.ordered_on}</td>
              <td style={td}>
                {o.passenger_group
                  ? `${o.passenger_group.group_name} (${o.passenger_group.pax_count} pax)`
                  : o.freight
                    ? `${o.freight.weight_kg}kg ${o.freight.cargo_type}`
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