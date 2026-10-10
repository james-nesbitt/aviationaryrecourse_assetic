/**
 * Client mirror of the API's domain-role permission model
 * (api/src/lib/permissions.ts). The API enforces; the UI hides what the
 * token can't do. Keep both tables in sync — the API is the source of
 * truth, this exists purely to avoid rendering buttons that will 403.
 */

export type Operation = "create" | "update" | "delete";
export type WriteRole = "asset_manager" | "route_manager" | "account_manager" | "maintenance";

export type EntityKey =
  | "operators" | "vehicles" | "routes" | "trips"
  | "vehicle-maintenance" | "route-assignments" | "crew-assignments"
  | "staff" | "customers" | "orders" | "cargo" | "passengers"
  | "airports" | "aircraft-models";

const ADMIN_ROLE = "sysadmin";

const DOMAIN: Record<EntityKey, Partial<Record<Operation, WriteRole>>> = {
  operators: { create: "asset_manager", update: "asset_manager", delete: "asset_manager" },
  vehicles: { create: "asset_manager", update: "asset_manager", delete: "asset_manager" },
  routes: { create: "route_manager", update: "route_manager", delete: "route_manager" },
  trips: { update: "route_manager", delete: "route_manager" },
  "vehicle-maintenance": { create: "maintenance", update: "maintenance", delete: "maintenance" },
  "route-assignments": { update: "route_manager", delete: "route_manager" },
  "crew-assignments": { create: "route_manager", update: "route_manager", delete: "route_manager" },
  staff: { create: "asset_manager", update: "asset_manager", delete: "asset_manager" },
  customers: { create: "account_manager", update: "account_manager", delete: "account_manager" },
  orders: { create: "route_manager", update: "route_manager", delete: "route_manager" },
  cargo: { update: "account_manager", delete: "account_manager" },
  passengers: { update: "account_manager", delete: "account_manager" },
  airports: { update: "asset_manager" },
  "aircraft-models": { create: "asset_manager", update: "asset_manager" },
};

export function canWrite(roles: string[], entity: EntityKey, op: Operation): boolean {
  if (roles.includes(ADMIN_ROLE)) return true;
  const domainRole = DOMAIN[entity][op];
  return domainRole !== undefined && roles.includes(domainRole);
}