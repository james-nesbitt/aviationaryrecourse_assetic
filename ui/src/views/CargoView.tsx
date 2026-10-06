import React, { useEffect, useState } from "react";
import { apiFetch } from "../lib/auth.js";

/** Row shape from the cargo_state projection view. */
interface CargoStateRow {
  cargo_id: string;
  customer_id: string;
  customer_name: string;
  operator_id: string;
  operator_name: string;
  origin_iata: string;
  destination_iata: string;
  assigned_vehicle_id: string | null;
  weight_kg: number;
  cargo_type: string;
  state: string;
  last_event_type: string | null;
  current_location_iata: string | null;
  current_facility_id: string | null;
  current_vehicle_id: string | null;
  last_event_time: string | null;
  last_sequence: number | null;
}

interface TransitEvent {
  event_id: string;
  sequence: number;
  event_type: string;
  from_state: string;
  to_state: string;
  location_iata: string;
  vehicle_id: string | null;
  facility_id: string | null;
  actor_id: string | null;
  valid_time: string;
}

export function CargoView(): React.ReactElement {
  const [cargo, setCargo] = useState<CargoStateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [eventsById, setEventsById] = useState<Record<string, TransitEvent[]>>({});

  useEffect(() => {
    setLoading(true);
    apiFetch(`/api/cargo${stateFilter ? `?state=${stateFilter}` : ""}`)
      .then((r) => r.json())
      .then(setCargo)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [stateFilter]);

  async function toggleExpand(cargoId: string): Promise<void> {
    if (expanded === cargoId) {
      setExpanded(null);
      return;
    }
    setExpanded(cargoId);
    if (!eventsById[cargoId]) {
      const events = await apiFetch(`/api/cargo/${cargoId}/events`).then((r) => r.json());
      setEventsById((prev) => ({ ...prev, [cargoId]: events }));
    }
  }

  if (loading) return <div>Loading…</div>;
  if (error) return <div style={{ color: "red" }}>Error: {error}</div>;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Cargo ({cargo.length})</h1>
      <div style={{ marginBottom: 16 }}>
        {["", "picked_up", "loaded", "in_transit", "arrived", "held", "delivered"].map((s) => (
          <button
            key={s}
            onClick={() => setStateFilter(s)}
            style={{
              marginRight: 8,
              padding: "4px 12px",
              background: stateFilter === s ? "#8be9fd" : "white",
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
            <th style={th}>State</th>
            <th style={th}>Location</th>
            <th style={th}>Last event</th>
            <th style={th}>Weight</th>
            <th style={th}>Type</th>
            <th style={th}>Details</th>
          </tr>
        </thead>
        <tbody>
          {cargo.map((c) => (
            <React.Fragment key={c.cargo_id}>
              <tr
                style={{ borderBottom: "1px solid #eee", cursor: "pointer" }}
                onClick={() => void toggleExpand(c.cargo_id)}
              >
                <td style={td}>{c.cargo_id}</td>
                <td style={td}>{c.customer_name}</td>
                <td style={td}>{c.operator_name}</td>
                <td style={td}>{c.origin_iata} → {c.destination_iata}</td>
                <td style={td}>{c.state}</td>
                <td style={td}>{c.current_location_iata ?? "—"}</td>
                <td style={td}>{c.last_event_type ?? "—"}</td>
                <td style={td}>{c.weight_kg.toLocaleString()} kg</td>
                <td style={td}>{c.cargo_type}</td>
                <td style={td}>{expanded === c.cargo_id ? "▲" : "▼"}</td>
              </tr>
              {expanded === c.cargo_id && (
                <tr onClick={(e) => e.stopPropagation()}>
                  <td colSpan={10} style={{ padding: 16, background: "#f9f9f9" }}>
                    <table style={{ borderCollapse: "collapse", width: "100%" }}>
                      <thead>
                        <tr style={{ textAlign: "left", color: "#666" }}>
                          <th style={subTh}>Seq</th>
                          <th style={subTh}>Event</th>
                          <th style={subTh}>From → To</th>
                          <th style={subTh}>Location</th>
                          <th style={subTh}>Vehicle</th>
                          <th style={subTh}>Facility</th>
                          <th style={subTh}>Actor</th>
                          <th style={subTh}>Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(eventsById[c.cargo_id] ?? []).map((e) => (
                          <tr key={e.event_id}>
                            <td style={subTd}>{e.sequence}</td>
                            <td style={subTd}>{e.event_type}</td>
                            <td style={subTd}>{e.from_state} → {e.to_state}</td>
                            <td style={subTd}>{e.location_iata}</td>
                            <td style={subTd}>{e.vehicle_id ?? "—"}</td>
                            <td style={subTd}>{e.facility_id ?? "—"}</td>
                            <td style={subTd}>{e.actor_id ?? "—"}</td>
                            <td style={subTd}>{e.valid_time}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const th: React.CSSProperties = { padding: "8px 12px", fontSize: "0.85rem" };
const td: React.CSSProperties = { padding: "8px 12px", fontSize: "0.9rem" };
const subTh: React.CSSProperties = { padding: "4px 8px", fontSize: "0.8rem" };
const subTd: React.CSSProperties = { padding: "4px 8px", fontSize: "0.85rem" };