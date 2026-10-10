import React from "react";
import { Link } from "react-router-dom";
import { Badge } from "../components/index.jsx";
import { formatDate, formatDateTime, formatHours, legChain, tripHours } from "./format.js";

/**
 * The entity registry: one entry per domain entity, describing how to list it,
 * what an expanded row reveals, and where its detail page lives.
 *
 * Both the admin panel and every list page are generated from this, so adding
 * an entity means adding one entry rather than writing another view. Entities
 * that are subordinate to another (crew and vehicle assignments) link to the
 * parent's detail page instead of owning one.
 */

type Row = Record<string, unknown>;

export interface EntityFilter {
  param: string;
  label: string;
  options: string[];
}

export interface EntitySpec {
  key: string;
  label: string;
  /** Route path for the list page. */
  path: string;
  endpoint: string;
  /** Short description shown on the admin panel card. */
  blurb: string;
  rowKey: (row: Row) => string;
  columns: { key: string; header: string; render: (row: Row) => React.ReactNode }[];
  /** snake_case natural-key field for CRUD actions; defaults to the first column's value lookup. */
  idField?: string;
  /** Registry key matching the API's permission table. */
  entityKey?: import("./permissions.js").EntityKey;
  /** Which operations the API offers for this entity (mirrors lib/permissions DOMAIN). */
  crud?: { create?: boolean; update?: boolean; delete?: boolean };
  /** Editable fields for the generic form; mirrors the API's updateFields. */
  formFields?: { key: string; label: string; type?: "text" | "number" | "date" | "select"; options?: string[]; required?: boolean }[];
  expansion: (row: Row) => { label: string; value: React.ReactNode }[];
  detailPath?: (row: Row) => string;
  detailLabel?: string;
  filters?: EntityFilter[];
  /** Cap rows rendered; the large tables are sampled rather than paged. */
  limit?: number;
}

const str = (row: Row, key: string): string => (row[key] == null ? "—" : String(row[key]));
const legsOf = (row: Row) =>
  (row.legs as { from_iata: string; to_iata: string; scheduled_departure: string; scheduled_arrival: string }[]) ?? [];

export const ENTITIES: EntitySpec[] = [
  {
    key: "operators",
    label: "Operators",
    path: "/operators",
    formFields: [
      { key: "name", label: "Name", required: true },
      { key: "type", label: "Type", type: "select", options: ["passenger", "cargo", "military"], required: true },
      { key: "country", label: "Country", required: true },
      { key: "hub_iata", label: "Hub IATA", required: true },
      { key: "founded_year", label: "Founded year", type: "number" },
      { key: "fleet_size_hint", label: "Fleet size hint", type: "number" },
    ],
    entityKey: "operators",
    idField: "operator_id",
    crud: { create: true, update: true, delete: true },
    endpoint: "/api/operators",
    blurb: "Carriers: passenger, cargo and military",
    rowKey: (r) => str(r, "operator_id"),
    detailPath: (r) => `/operators/${str(r, "operator_id")}`,
    columns: [
      { key: "id", header: "Operator", render: (r) => str(r, "operator_id") },
      { key: "name", header: "Name", render: (r) => str(r, "name") },
      { key: "type", header: "Type", render: (r) => str(r, "type") },
      { key: "hub", header: "Hub", render: (r) => str(r, "hub_iata") },
    ],
    expansion: (r) => [
      { label: "Country", value: str(r, "country") },
      { label: "Founded", value: str(r, "founded_year") },
      { label: "Fleet size hint", value: str(r, "fleet_size_hint") },
    ],
    filters: [{ param: "type", label: "Type", options: ["passenger", "cargo", "military"] }],
  },
  {
    key: "vehicles",
    label: "Vehicles",
    path: "/vehicles",
    formFields: [
      { key: "registration", label: "Registration" },
      { key: "status", label: "Status", type: "select", options: ["active", "stored", "maintenance"] },
      { key: "base_iata", label: "Base IATA" },
    ],
    entityKey: "vehicles",
    idField: "vehicle_id",
    crud: { create: true, update: true, delete: true },
    endpoint: "/api/vehicles",
    blurb: "Aircraft, ground support and rail",
    rowKey: (r) => str(r, "vehicle_id"),
    detailPath: (r) => `/vehicles/${str(r, "vehicle_id")}`,
    columns: [
      { key: "id", header: "Vehicle", render: (r) => str(r, "registration") !== "—" ? str(r, "registration") : str(r, "vehicle_id") },
      { key: "kind", header: "Kind", render: (r) => str(r, "kind") },
      { key: "model", header: "Model", render: (r) => str(r, "model_id") },
      { key: "base", header: "Base", render: (r) => (r.base_iata ? str(r, "base_iata") : str(r, "home_iata")) },
      { key: "status", header: "Status", render: (r) => (r.status ? <Badge value={str(r, "status")} /> : "—") },
    ],
    expansion: (r) => [
      { label: "Vehicle id", value: str(r, "vehicle_id") },
      { label: "Operator", value: <Link to={`/operators/${str(r, "operator_id")}`}>{str(r, "operator_id")}</Link> },
      { label: "Seat config", value: r.seat_config ? JSON.stringify(r.seat_config) : "—" },
      { label: "GSE type", value: str(r, "gse_type") },
      { label: "Rail type", value: str(r, "rail_type") },
    ],
    filters: [{ param: "kind", label: "Kind", options: ["aircraft", "ground_support", "rail"] }],
  },
  {
    key: "routes",
    label: "Routes",
    path: "/routes",
    entityKey: "routes",
    idField: "route_id",
    crud: { create: true, update: true, delete: true },
    endpoint: "/api/routes",
    blurb: "Recurring route patterns and their legs",
    rowKey: (r) => str(r, "route_id"),
    detailPath: (r) => `/routes/${str(r, "route_id")}`,
    columns: [
      { key: "id", header: "Route", render: (r) => str(r, "route_id") },
      { key: "chain", header: "Itinerary", render: (r) => legChain(legsOf(r)) },
      { key: "type", header: "Type", render: (r) => str(r, "route_type") },
      { key: "freq", header: "Every", render: (r) => `${str(r, "frequency_days")}d` },
    ],
    expansion: (r) => [
      { label: "Operator", value: <Link to={`/operators/${str(r, "operator_id")}`}>{str(r, "operator_id")}</Link> },
      { label: "Vehicle", value: <Link to={`/vehicles/${str(r, "vehicle_id")}`}>{str(r, "vehicle_id")}</Link> },
      { label: "Base", value: str(r, "base_iata") },
      { label: "First operating date", value: formatDate(str(r, "first_operating_date")) },
      { label: "Legs", value: String(legsOf(r).length) },
    ],
  },
  {
    key: "trips",
    label: "Trips",
    path: "/trips",
    entityKey: "trips",
    idField: "trip_id",
    crud: { update: true, delete: true },
    endpoint: "/api/trips",
    blurb: "Dated instances of a route",
    rowKey: (r) => str(r, "trip_id"),
    detailPath: (r) => `/trips/${str(r, "trip_id")}`,
    limit: 200,
    columns: [
      { key: "id", header: "Trip", render: (r) => str(r, "trip_id") },
      { key: "date", header: "Date", render: (r) => formatDate(str(r, "operating_date")) },
      { key: "chain", header: "Itinerary", render: (r) => legChain(legsOf(r)) },
      { key: "status", header: "Status", render: (r) => <Badge value={str(r, "status")} /> },
    ],
    expansion: (r) => [
      { label: "Route", value: <Link to={`/routes/${str(r, "route_id")}`}>{str(r, "route_id")}</Link> },
      { label: "Vehicle", value: <Link to={`/vehicles/${str(r, "vehicle_id")}`}>{str(r, "vehicle_id")}</Link> },
      { label: "Operator", value: <Link to={`/operators/${str(r, "operator_id")}`}>{str(r, "operator_id")}</Link> },
      { label: "Block time", value: formatHours(tripHours(legsOf(r))) },
      { label: "First departure", value: formatDateTime(legsOf(r)[0]?.scheduled_departure) },
    ],
    filters: [{ param: "status", label: "Status", options: ["scheduled", "in_progress", "completed", "cancelled"] }],
  },
  {
    key: "vehicle-maintenance",
    label: "Maintenance",
    path: "/vehicle-maintenance",
    formFields: [
      { key: "maintenance_type", label: "Type", type: "select", options: ["a_check", "b_check", "c_check", "unscheduled"], required: true },
      { key: "start_date", label: "Start date", type: "date", required: true },
      { key: "end_date", label: "End date", type: "date", required: true },
    ],
    entityKey: "vehicle-maintenance",
    idField: "maintenance_id",
    crud: { create: true, update: true, delete: true },
    endpoint: "/api/vehicle-maintenance",
    blurb: "Aircraft service windows",
    rowKey: (r) => str(r, "maintenance_id"),
    detailPath: (r) => `/vehicles/${str(r, "vehicle_id")}/maintenance/${str(r, "maintenance_id")}`,
    columns: [
      { key: "id", header: "Window", render: (r) => str(r, "maintenance_id") },
      { key: "vehicle", header: "Vehicle", render: (r) => str(r, "vehicle_id") },
      { key: "type", header: "Type", render: (r) => str(r, "maintenance_type") },
      { key: "from", header: "From", render: (r) => formatDate(str(r, "start_date")) },
      { key: "status", header: "Status", render: (r) => <Badge value={str(r, "status")} /> },
    ],
    expansion: (r) => [
      { label: "To", value: formatDate(str(r, "end_date")) },
      { label: "Facility", value: str(r, "facility_id") },
      { label: "Vehicle", value: <Link to={`/vehicles/${str(r, "vehicle_id")}`}>{str(r, "vehicle_id")}</Link> },
    ],
    filters: [{ param: "status", label: "Status", options: ["scheduled", "in_progress", "completed"] }],
  },
  {
    key: "route-assignments",
    label: "Route assignments",
    path: "/route-assignments",
    entityKey: "route-assignments",
    idField: "assignment_id",
    crud: { update: true, delete: true },
    endpoint: "/api/route-assignments",
    blurb: "Which vehicle operates a route, and when",
    rowKey: (r) => str(r, "assignment_id"),
    detailPath: (r) => `/routes/${str(r, "route_id")}`,
    detailLabel: "Route",
    columns: [
      { key: "route", header: "Route", render: (r) => str(r, "route_id") },
      { key: "vehicle", header: "Vehicle", render: (r) => str(r, "vehicle_id") },
      { key: "from", header: "From", render: (r) => formatDate(str(r, "valid_from")) },
      { key: "to", header: "To", render: (r) => (r.valid_to ? formatDate(str(r, "valid_to")) : "open") },
      { key: "reason", header: "Reason", render: (r) => str(r, "reason") },
    ],
    expansion: (r) => [
      { label: "Assignment id", value: str(r, "assignment_id") },
      { label: "Replaces vehicle", value: str(r, "replaces_vehicle_id") },
      { label: "Vehicle", value: <Link to={`/vehicles/${str(r, "vehicle_id")}`}>{str(r, "vehicle_id")}</Link> },
    ],
  },
  {
    key: "crew-assignments",
    label: "Crew assignments",
    path: "/crew-assignments",
    entityKey: "crew-assignments",
    idField: "assignment_id",
    crud: { create: true, update: true, delete: true },
    endpoint: "/api/crew-assignments",
    blurb: "Which crew staffed which trip",
    rowKey: (r) => str(r, "assignment_id"),
    detailPath: (r) => `/trips/${str(r, "trip_id")}`,
    detailLabel: "Trip",
    limit: 200,
    columns: [
      { key: "trip", header: "Trip", render: (r) => str(r, "trip_id") },
      { key: "staff", header: "Staff", render: (r) => str(r, "staff_id") },
      { key: "role", header: "Crew role", render: (r) => str(r, "crew_role") },
    ],
    expansion: (r) => [
      { label: "Assignment id", value: str(r, "assignment_id") },
      { label: "Staff", value: <Link to={`/staff/${str(r, "staff_id")}`}>{str(r, "staff_id")}</Link> },
      { label: "Trip", value: <Link to={`/trips/${str(r, "trip_id")}`}>{str(r, "trip_id")}</Link> },
    ],
  },
  {
    key: "staff",
    label: "Staff",
    path: "/staff",
    formFields: [
      { key: "given_name", label: "Given name", required: true },
      { key: "family_name", label: "Family name", required: true },
      { key: "role", label: "Role", required: true },
      { key: "keycloak_username", label: "Keycloak username" },
    ],
    entityKey: "staff",
    idField: "staff_id",
    crud: { create: true, update: true, delete: true },
    endpoint: "/api/staff",
    blurb: "Flight crew, ground crew and management",
    rowKey: (r) => str(r, "staff_id"),
    detailPath: (r) => `/staff/${str(r, "staff_id")}`,
    columns: [
      { key: "name", header: "Name", render: (r) => `${str(r, "given_name")} ${str(r, "family_name")}` },
      { key: "role", header: "Role", render: (r) => str(r, "role") },
      { key: "class", header: "Class", render: (r) => str(r, "role_class") },
      { key: "age", header: "Age", render: (r) => str(r, "age") },
      { key: "base", header: "Base", render: (r) => str(r, "base_iata") },
    ],
    expansion: (r) => [
      { label: "Staff id", value: str(r, "staff_id") },
      { label: "Operator", value: <Link to={`/operators/${str(r, "operator_id")}`}>{str(r, "operator_id")}</Link> },
      { label: "Date of birth", value: formatDate(str(r, "date_of_birth")) },
      { label: "Age", value: str(r, "age") },
      { label: "Hired", value: formatDate(str(r, "hire_date")) },
      { label: "Years of service", value: str(r, "years_of_service") },
      { label: "Login", value: str(r, "keycloak_username") },
      { label: "Certifications", value: (r.certifications as string[] | undefined)?.join(", ") || "—" },
    ],
    filters: [
      {
        param: "role",
        label: "Role",
        options: ["captain", "first_officer", "cabin_lead", "cabin_crew", "ramp_agent", "maintenance_tech", "route_manager", "account_manager"],
      },
    ],
  },
  {
    key: "customers",
    label: "Customers",
    path: "/customers",
    formFields: [
      { key: "company_name", label: "Company name", required: true },
      { key: "customer_type", label: "Type", type: "select", options: ["cargo_shipper", "charter"], required: true },
      { key: "monthly_volume_kg", label: "Monthly volume (kg)", type: "number" },
    ],
    entityKey: "customers",
    idField: "customer_id",
    crud: { create: true, update: true, delete: true },
    endpoint: "/api/customers",
    blurb: "Cargo shippers and charter clients",
    rowKey: (r) => str(r, "customer_id"),
    detailPath: (r) => `/customers/${str(r, "customer_id")}`,
    columns: [
      { key: "name", header: "Company", render: (r) => str(r, "company_name") },
      { key: "type", header: "Type", render: (r) => str(r, "customer_type") },
      { key: "op", header: "Operator", render: (r) => str(r, "operator_id") },
    ],
    expansion: (r) => [
      { label: "Customer id", value: str(r, "customer_id") },
      { label: "Account manager", value: str(r, "account_manager_id") },
      { label: "Contract start", value: formatDate(str(r, "contract_start")) },
      { label: "Monthly volume (kg)", value: str(r, "monthly_volume_kg") },
    ],
  },
  {
    key: "orders",
    label: "Orders",
    path: "/orders",
    entityKey: "orders",
    idField: "order_id",
    crud: { create: true, update: true, delete: true },
    endpoint: "/api/orders",
    blurb: "Customer bookings and their itineraries",
    rowKey: (r) => str(r, "order_id"),
    detailPath: (r) => `/orders/${str(r, "order_id")}`,
    columns: [
      { key: "id", header: "Order", render: (r) => str(r, "order_id") },
      { key: "type", header: "Type", render: (r) => str(r, "order_type") },
      { key: "route", header: "Route", render: (r) => `${str(r, "origin_iata")} → ${str(r, "destination_iata")}` },
      { key: "status", header: "Status", render: (r) => <Badge value={str(r, "status")} /> },
    ],
    expansion: (r) => [
      { label: "Customer", value: <Link to={`/customers/${str(r, "customer_id")}`}>{str(r, "customer_id")}</Link> },
      { label: "Operator", value: <Link to={`/operators/${str(r, "operator_id")}`}>{str(r, "operator_id")}</Link> },
      { label: "Ordered on", value: formatDate(str(r, "ordered_on")) },
      { label: "Account manager", value: str(r, "account_manager_id") },
      { label: "Route manager", value: str(r, "route_manager_id") },
      { label: "Planned legs", value: String(((r.planned_legs as unknown[]) ?? []).length) },
    ],
    filters: [{ param: "status", label: "Status", options: ["requested", "confirmed", "in_progress", "completed"] }],
  },
  {
    key: "cargo",
    label: "Cargo",
    path: "/cargo",
    entityKey: "cargo",
    idField: "cargo_id",
    crud: { update: true, delete: true },
    endpoint: "/api/cargo",
    blurb: "Shipments and their transit state",
    rowKey: (r) => str(r, "cargo_id"),
    detailPath: (r) => `/cargo/${str(r, "cargo_id")}`,
    columns: [
      { key: "id", header: "Shipment", render: (r) => str(r, "cargo_id") },
      { key: "route", header: "Route", render: (r) => `${str(r, "origin_iata")} → ${str(r, "destination_iata")}` },
      { key: "kg", header: "Weight", render: (r) => `${str(r, "weight_kg")} kg` },
      { key: "state", header: "State", render: (r) => <Badge value={str(r, "state")} /> },
    ],
    expansion: (r) => [
      { label: "Customer", value: str(r, "customer_name") },
      { label: "Operator", value: str(r, "operator_name") },
      { label: "Cargo type", value: str(r, "cargo_type") },
      { label: "Trip", value: r.trip_id ? <Link to={`/trips/${str(r, "trip_id")}`}>{str(r, "trip_id")}</Link> : "—" },
      { label: "Current location", value: str(r, "current_location_iata") },
      { label: "Last event", value: str(r, "last_event_type") },
    ],
    filters: [
      {
        param: "state",
        label: "State",
        options: ["scheduled", "picked_up", "loaded", "in_transit", "arrived", "held", "delivered"],
      },
    ],
  },
  {
    key: "passengers",
    label: "Passengers",
    path: "/passengers",
    entityKey: "passengers",
    idField: "passenger_id",
    crud: { update: true, delete: true },
    endpoint: "/api/passengers",
    blurb: "Travellers and their journey state",
    rowKey: (r) => str(r, "passenger_id"),
    detailPath: (r) => `/passengers/${str(r, "passenger_id")}`,
    limit: 200,
    columns: [
      { key: "name", header: "Passenger", render: (r) => `${str(r, "given_name")} ${str(r, "family_name")}` },
      { key: "route", header: "Route", render: (r) => `${str(r, "origin_iata")} → ${str(r, "destination_iata")}` },
      { key: "type", header: "Type", render: (r) => str(r, "passenger_type") },
      { key: "state", header: "State", render: (r) => <Badge value={str(r, "state")} /> },
    ],
    expansion: (r) => [
      { label: "Passenger id", value: str(r, "passenger_id") },
      { label: "Operator", value: str(r, "operator_name") },
      { label: "Order", value: r.order_id ? <Link to={`/orders/${str(r, "order_id")}`}>{str(r, "order_id")}</Link> : "—" },
      { label: "Trip", value: r.trip_id ? <Link to={`/trips/${str(r, "trip_id")}`}>{str(r, "trip_id")}</Link> : "—" },
      { label: "Current location", value: str(r, "current_location_iata") },
      { label: "Last event", value: str(r, "last_event_type") },
    ],
    filters: [
      {
        param: "state",
        label: "State",
        options: ["booked", "checked_in", "boarded", "in_transit", "arrived", "disembarked"],
      },
    ],
  },
  {
    key: "airports",
    label: "Airports",
    path: "/airports",
    formFields: [
      { key: "name", label: "Name", required: true },
      { key: "city", label: "City" },
      { key: "country", label: "Country" },
      { key: "timezone", label: "Timezone" },
    ],
    entityKey: "airports",
    idField: "iata",
    crud: { update: true },
    endpoint: "/api/airports",
    blurb: "Reference set actually used by the data",
    rowKey: (r) => str(r, "iata"),
    detailPath: (r) => `/airports/${str(r, "iata")}`,
    columns: [
      { key: "iata", header: "IATA", render: (r) => str(r, "iata") },
      { key: "name", header: "Name", render: (r) => str(r, "name") },
      { key: "city", header: "City", render: (r) => str(r, "city") },
      { key: "country", header: "Country", render: (r) => str(r, "country") },
    ],
    expansion: (r) => [
      { label: "ICAO", value: str(r, "icao") },
      { label: "Latitude", value: str(r, "latitude") },
      { label: "Longitude", value: str(r, "longitude") },
      { label: "Elevation (ft)", value: str(r, "elevation_ft") },
      { label: "Timezone", value: str(r, "timezone") },
    ],
  },
  {
    key: "aircraft-models",
    label: "Aircraft models",
    path: "/aircraft-models",
    formFields: [
      { key: "name", label: "Name", required: true },
      { key: "category", label: "Category", type: "select", options: ["narrow_body", "wide_body", "regional", "turboprop", "jet"], required: true },
    ],
    entityKey: "aircraft-models",
    idField: "model_id",
    crud: { create: true, update: true },
    endpoint: "/api/aircraft-models",
    blurb: "Model reference: range, capacity, category",
    rowKey: (r) => str(r, "model_id"),
    detailPath: (r) => `/aircraft-models/${str(r, "model_id")}`,
    columns: [
      { key: "id", header: "Model", render: (r) => str(r, "model_id") },
      { key: "name", header: "Name", render: (r) => str(r, "name") },
      { key: "mfr", header: "Manufacturer", render: (r) => str(r, "manufacturer") },
      { key: "cat", header: "Category", render: (r) => str(r, "category") },
    ],
    expansion: (r) => [
      { label: "ICAO type", value: str(r, "icao_type") },
      { label: "Pax capacity", value: str(r, "pax_capacity_typical") },
      { label: "Cargo capacity (kg)", value: str(r, "cargo_capacity_kg") },
      { label: "Range (km)", value: str(r, "range_km") },
      { label: "Engines", value: str(r, "engine_count") },
    ],
  },
];

export const ENTITY_BY_PATH: Record<string, EntitySpec> = Object.fromEntries(
  ENTITIES.map((e) => [e.path, e]),
);
