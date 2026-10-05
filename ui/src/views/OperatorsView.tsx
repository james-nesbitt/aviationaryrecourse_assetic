import React, { useEffect, useState } from "react";
import { apiFetch } from "../lib/auth.js";

interface Operator {
  operator_id: string;
  name: string;
  type: string;
  country: string;
  hub_iata: string;
  founded_year: number;
  fleet_size_hint: number;
}

export function OperatorsView(): React.ReactElement {
  const [operators, setOperators] = useState<Operator[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/operators")
      .then((r) => r.json())
      .then(setOperators)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div>Loading…</div>;
  if (error) return <div style={{ color: "red" }}>Error: {error}</div>;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Operators ({operators.length})</h1>
      <table style={{ borderCollapse: "collapse", width: "100%", background: "white" }}>
        <thead>
          <tr style={{ background: "#1a1a2e", color: "#eee", textAlign: "left" }}>
            <th style={th}>ID</th>
            <th style={th}>Name</th>
            <th style={th}>Type</th>
            <th style={th}>Country</th>
            <th style={th}>Hub</th>
            <th style={th}>Founded</th>
            <th style={th}>Fleet hint</th>
          </tr>
        </thead>
        <tbody>
          {operators.map((o) => (
            <tr key={o.operator_id} style={{ borderBottom: "1px solid #eee" }}>
              <td style={td}>{o.operator_id}</td>
              <td style={td}>{o.name}</td>
              <td style={td}>{o.type}</td>
              <td style={td}>{o.country}</td>
              <td style={td}>{o.hub_iata}</td>
              <td style={td}>{o.founded_year}</td>
              <td style={td}>{o.fleet_size_hint}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const th: React.CSSProperties = { padding: "8px 12px", fontSize: "0.85rem" };
const td: React.CSSProperties = { padding: "8px 12px", fontSize: "0.9rem" };