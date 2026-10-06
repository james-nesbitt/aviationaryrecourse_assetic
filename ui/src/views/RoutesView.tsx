import React, { useEffect, useState } from "react";
import { apiFetch } from "../lib/auth.js";

interface Route {
  route_id: string;
  operator_id: string;
  vehicle_id: string;
  route_type: string;
  base_iata: string;
  legs: Array<{
    sequence: number;
    from_iata: string;
    to_iata: string;
    scheduled_departure: string;
    scheduled_arrival: string;
  }>;
  operator?: { name: string };
}

export function RoutesView(): React.ReactElement {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/routes")
      .then((r) => r.json())
      .then(setRoutes)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div>Loading…</div>;
  if (error) return <div style={{ color: "red" }}>Error: {error}</div>;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Routes ({routes.length})</h1>
      <table style={{ borderCollapse: "collapse", width: "100%", background: "white" }}>
        <thead>
          <tr style={{ background: "#1a1a2e", color: "#eee", textAlign: "left" }}>
            <th style={th}>ID</th>
            <th style={th}>Itinerary</th>
            <th style={th}>Operator</th>
            <th style={th}>Vehicle</th>
            <th style={th}>Type</th>
            <th style={th}>Date</th>
            <th style={th}>Legs</th>
            <th style={th}>Details</th>
          </tr>
        </thead>
        <tbody>
          {routes.map((r) => (
            <React.Fragment key={r.route_id}>
              <tr
                style={{ borderBottom: "1px solid #eee", cursor: "pointer" }}
                onClick={() => setExpanded(expanded === r.route_id ? null : r.route_id)}
              >
                <td style={{ ...td, fontFamily: "monospace", color: "#666" }}>{r.route_id}</td>
                <td style={{ ...td, fontWeight: 600 }}>{routeLabel(r)}</td>
                <td style={td}>{r.operator?.name ?? r.operator_id}</td>
                <td style={td}>{r.vehicle_id}</td>
                <td style={td}>{r.route_type}</td>
                <td style={td}>{routeDate(r)}</td>
                <td style={td}>{r.legs.length}</td>
                <td style={td}>{expanded === r.route_id ? "▲" : "▼"}</td>
              </tr>
              {expanded === r.route_id && (
                <tr onClick={(e) => e.stopPropagation()}>
                  <td colSpan={8} style={{ padding: 16, background: "#f9f9f9" }}>
                    <table style={{ borderCollapse: "collapse", width: "100%" }}>
                      <thead>
                        <tr style={{ textAlign: "left", color: "#666" }}>
                          <th style={subTh}>Seq</th>
                          <th style={subTh}>From</th>
                          <th style={subTh}>To</th>
                          <th style={subTh}>Departure</th>
                          <th style={subTh}>Arrival</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.legs.map((leg) => (
                          <tr key={leg.sequence}>
                            <td style={subTd}>{leg.sequence}</td>
                            <td style={subTd}>{leg.from_iata}</td>
                            <td style={subTd}>{leg.to_iata}</td>
                            <td style={subTd}>{leg.scheduled_departure}</td>
                            <td style={subTd}>{leg.scheduled_arrival}</td>
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

/**
 * Human-readable itinerary: the ordered stop sequence, e.g. "LAX → DEN → LAX".
 * Collapses the leg list into the airport chain so the route is identifiable
 * without expanding it.
 */
function routeLabel(r: Route): string {
  if (r.legs.length === 0) return r.base_iata;
  const stops = [r.legs[0].from_iata, ...r.legs.map((l) => l.to_iata)];
  return stops.join(" → ");
}

/** Operating date, taken from the first leg's scheduled departure. */
function routeDate(r: Route): string {
  const first = r.legs[0]?.scheduled_departure;
  return first ? first.split("T")[0] : "—";
}

const th: React.CSSProperties = { padding: "8px 12px", fontSize: "0.85rem" };
const td: React.CSSProperties = { padding: "8px 12px", fontSize: "0.9rem" };
const subTh: React.CSSProperties = { padding: "4px 8px", fontSize: "0.8rem" };
const subTd: React.CSSProperties = { padding: "4px 8px", fontSize: "0.85rem" };