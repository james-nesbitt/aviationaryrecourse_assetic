import React, { useEffect, useState } from "react";
import { apiFetch } from "../lib/auth.js";

interface DashboardData {
  operators: unknown[];
  vehicles: unknown[];
  orders: unknown[];
  cargo: unknown[];
  routes: unknown[];
  staff: unknown[];
  customers: unknown[];
}

export function DashboardView(): React.ReactElement {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load(): Promise<void> {
      try {
        const [operators, vehicles, orders, cargo, routes, staff, customers] =
          await Promise.all([
            apiFetch("/api/operators").then((r) => r.json()),
            apiFetch("/api/vehicles").then((r) => r.json()),
            apiFetch("/api/orders").then((r) => r.json()),
            apiFetch("/api/cargo").then((r) => r.json()),
            apiFetch("/api/routes").then((r) => r.json()),
            apiFetch("/api/staff").then((r) => r.json()),
            apiFetch("/api/customers").then((r) => r.json()),
          ]);
        setData({ operators, vehicles, orders, cargo, routes, staff, customers });
      } catch (e) {
        setError(String(e));
      }
    }
    load();
  }, []);

  if (error) return <div style={{ color: "red" }}>Error: {error}</div>;
  if (!data) return <div>Loading…</div>;

  const cards = [
    { label: "Operators", count: data.operators.length, to: "/operators" },
    { label: "Vehicles", count: data.vehicles.length, to: "/vehicles" },
    { label: "Orders", count: data.orders.length, to: "/orders" },
    { label: "Cargo", count: data.cargo.length, to: "/cargo" },
    { label: "Routes", count: data.routes.length, to: "/routes" },
    { label: "Staff", count: data.staff.length, to: "/staff" },
    { label: "Customers", count: data.customers.length, to: "/customers" },
  ];

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Dashboard</h1>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 16 }}>
        {cards.map((card) => (
          <a
            key={card.to}
            href={card.to}
            style={{
              display: "block",
              padding: "1.5rem",
              background: "white",
              borderRadius: 8,
              textDecoration: "none",
              color: "#333",
              boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
            }}
          >
            <div style={{ fontSize: "2.5rem", fontWeight: 700 }}>{card.count}</div>
            <div style={{ color: "#666", fontSize: "0.9rem" }}>{card.label}</div>
          </a>
        ))}
      </div>
    </div>
  );
}