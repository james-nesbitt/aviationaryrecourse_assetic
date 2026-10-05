import React, { useEffect, useState } from "react";
import { apiFetch } from "../lib/auth.js";

interface Staff {
  staff_id: string;
  given_name: string;
  family_name: string;
  role_class: string;
  role: string;
  operator_id: string;
  base_iata: string;
  hire_date: string;
  certifications: string[];
  operator?: { name: string };
}

export function StaffView(): React.ReactElement {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState("");

  useEffect(() => {
    apiFetch(`/api/staff${roleFilter ? `?role=${roleFilter}` : ""}`)
      .then((r) => r.json())
      .then(setStaff)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [roleFilter]);

  if (loading) return <div>Loading…</div>;
  if (error) return <div style={{ color: "red" }}>Error: {error}</div>;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Staff ({staff.length})</h1>
      <div style={{ marginBottom: 16 }}>
        {["", "captain", "first_officer", "cabin_crew", "maintenance_tech", "trip_manager", "account_manager"].map((r) => (
          <button
            key={r}
            onClick={() => setRoleFilter(r)}
            style={{
              marginRight: 8,
              padding: "4px 12px",
              background: roleFilter === r ? "#8be9fd" : "white",
              border: "1px solid #ccc",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            {r || "All"}
          </button>
        ))}
      </div>
      <table style={{ borderCollapse: "collapse", width: "100%", background: "white" }}>
        <thead>
          <tr style={{ background: "#1a1a2e", color: "#eee", textAlign: "left" }}>
            <th style={th}>ID</th>
            <th style={th}>Name</th>
            <th style={th}>Role Class</th>
            <th style={th}>Role</th>
            <th style={th}>Operator</th>
            <th style={th}>Base</th>
            <th style={th}>Hired</th>
            <th style={th}>Certifications</th>
          </tr>
        </thead>
        <tbody>
          {staff.map((s) => (
            <tr key={s.staff_id} style={{ borderBottom: "1px solid #eee" }}>
              <td style={td}>{s.staff_id}</td>
              <td style={td}>{s.given_name} {s.family_name}</td>
              <td style={td}>{s.role_class}</td>
              <td style={td}>{s.role}</td>
              <td style={td}>{s.operator?.name ?? s.operator_id}</td>
              <td style={td}>{s.base_iata}</td>
              <td style={td}>{s.hire_date}</td>
              <td style={td}>{s.certifications.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const th: React.CSSProperties = { padding: "8px 12px", fontSize: "0.85rem" };
const td: React.CSSProperties = { padding: "8px 12px", fontSize: "0.9rem" };