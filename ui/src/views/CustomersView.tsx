import React, { useEffect, useState } from "react";
import { apiFetch } from "../lib/auth.js";

interface Customer {
  customer_id: string;
  customer_type: string;
  company_name: string;
  operator_id: string;
  account_manager_id: string | null;
  contract_start: string;
  monthly_volume_kg: number | null;
  operator?: { name: string };
}

export function CustomersView(): React.ReactElement {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/customers")
      .then((r) => r.json())
      .then(setCustomers)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div>Loading…</div>;
  if (error) return <div style={{ color: "red" }}>Error: {error}</div>;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Customers ({customers.length})</h1>
      <table style={{ borderCollapse: "collapse", width: "100%", background: "white" }}>
        <thead>
          <tr style={{ background: "#1a1a2e", color: "#eee", textAlign: "left" }}>
            <th style={th}>ID</th>
            <th style={th}>Type</th>
            <th style={th}>Company</th>
            <th style={th}>Operator</th>
            <th style={th}>Account Mgr</th>
            <th style={th}>Contract Start</th>
            <th style={th}>Monthly Volume</th>
          </tr>
        </thead>
        <tbody>
          {customers.map((c) => (
            <tr key={c.customer_id} style={{ borderBottom: "1px solid #eee" }}>
              <td style={td}>{c.customer_id}</td>
              <td style={td}>{c.customer_type}</td>
              <td style={td}>{c.company_name}</td>
              <td style={td}>{c.operator?.name ?? c.operator_id}</td>
              <td style={td}>{c.account_manager_id ?? "—"}</td>
              <td style={td}>{c.contract_start}</td>
              <td style={td}>
                {c.monthly_volume_kg ? `${c.monthly_volume_kg.toLocaleString()} kg` : "—"}
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