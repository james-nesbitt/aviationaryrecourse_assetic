/**
 * Domain-role permission model for entity writes.
 *
 * Each realm role owns a domain of entities; sysadmin overrides every
 * operation. The table is the single source of truth for what each
 * persona may create, update and soft-delete — the API enforces it on
 * every write (requireRole stays the enforcement primitive), and the
 * UI reads the same table to show only the affordances a token can use.
 *
 * Reads are un-gated beyond authentication: every persona sees the data
 * (viewing is not a domain capability).
 */

export type Operation = "create" | "update" | "delete";

/** Realm roles that own a domain of entities. */
export type WriteRole =
  | "asset_manager"
  | "route_manager"
  | "account_manager"
  | "maintenance";

/** Entity keys as used by the registry and the write endpoints. */
export type EntityKey =
  | "operators"
  | "vehicles"
  | "routes"
  | "trips"
  | "vehicle-maintenance"
  | "route-assignments"
  | "crew-assignments"
  | "staff"
  | "customers"
  | "orders"
  | "cargo"
  | "passengers"
  | "airports"
  | "aircraft-models";

/**
 * The role whose domain the entity belongs to, per operation. A role can
 * own an entity's updates but not its deletes (maintenance manages
 * windows but does not remove history).
 */
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

export const ADMIN_ROLE = "sysadmin";

/**
 * The role allowed to perform an operation on an entity, sysadmin
 * excepted (it overrides everything). Null means the operation is not
 * offered at all — no role may perform it.
 */
export function writeRoleFor(entity: EntityKey, op: Operation): WriteRole | "sysadmin" | null {
  if (DOMAIN[entity][op]) return DOMAIN[entity][op]!;
  return null;
}

/**
 * Whether the given roles permit the operation. True when the caller
 * holds the entity's domain role for the operation, or sysadmin.
 */
export function canWrite(roles: string[], entity: EntityKey, op: Operation): boolean {
  if (roles.includes(ADMIN_ROLE)) return true;
  const domainRole = DOMAIN[entity][op];
  return domainRole !== undefined && roles.includes(domainRole);
}