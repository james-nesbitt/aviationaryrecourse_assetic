import { apiFetch } from "./auth.js";

/**
 * Typed GET helper over apiFetch. Views declare the shape they expect at the
 * call site; this keeps response typing in one place instead of each view
 * hand-rolling fetch + json + error handling.
 */
export async function apiGet<T>(path: string): Promise<T> {
  const res = await apiFetch(path);
  if (!res.ok) {
    throw new Error(`${path} returned ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function apiSend<T>(
  method: "POST" | "PATCH",
  path: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await apiFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T;
  return { ok: res.ok, status: res.status, data };
}

// ── Shared response shapes ────────────────────────────────────────────────

export interface TripLeg {
  sequence: number;
  from_iata: string;
  to_iata: string;
  scheduled_departure: string;
  scheduled_arrival: string;
}

export interface Trip {
  trip_id: string;
  route_id: string;
  vehicle_id: string;
  operator_id: string;
  operating_date: string;
  status: "scheduled" | "in_progress" | "completed" | "cancelled";
  legs: TripLeg[];
}

export interface CrewMember {
  assignment_id: string;
  trip_id: string;
  crew_role: string;
  staff_id: string;
  given_name: string;
  family_name: string;
}

export interface FatigueRow {
  staff_id: string;
  given_name: string;
  family_name: string;
  role: string;
  operator_id: string;
  keycloak_username: string | null;
  duty_hours_7d: string;
  consecutive_duty_days: number;
  rest_since_last_hours: string | null;
  level: "ok" | "warn" | "critical";
}

export interface MaintenanceWindow {
  maintenance_id: string;
  vehicle_id: string;
  facility_id: string | null;
  maintenance_type: string;
  start_date: string;
  end_date: string;
  status: string;
}

export interface RouteAssignment {
  assignment_id: string;
  route_id: string;
  vehicle_id: string;
  valid_from: string;
  valid_to: string | null;
  reason: string;
  replaces_vehicle_id: string | null;
}

export interface Me {
  username: string;
  email: string | null;
  roles: string[];
  staff: {
    staff_id: string;
    given_name: string;
    family_name: string;
    role: string;
    role_class: string;
    operator_id: string;
  } | null;
}
