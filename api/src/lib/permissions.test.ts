import { describe, expect, it } from "vitest";
import { ADMIN_ROLE, canWrite, writeRoleFor, type EntityKey, type Operation } from "./permissions.js";

const ALL_ENTITIES: EntityKey[] = [
  "operators", "vehicles", "routes", "trips", "vehicle-maintenance",
  "route-assignments", "crew-assignments", "staff", "customers", "orders",
  "cargo", "passengers", "airports", "aircraft-models",
];
const ALL_OPS: Operation[] = ["create", "update", "delete"];

describe("permissions table", () => {
  it("covers every entity with at least one operation", () => {
    for (const e of ALL_ENTITIES) {
      expect(ALL_OPS.some((op) => writeRoleFor(e, op) !== null), `${e} has no write capability`).toBe(true);
    }
  });

  it("every declared write role is a domain role or sysadmin", () => {
    for (const e of ALL_ENTITIES) {
      for (const op of ALL_OPS) {
        const role = writeRoleFor(e, op);
        expect(role === null || ["asset_manager", "route_manager", "account_manager", "maintenance", ADMIN_ROLE].includes(role!)).toBe(true);
      }
    }
  });
});

describe("canWrite", () => {
  it("grants the domain role its operation", () => {
    expect(canWrite(["asset_manager"], "operators", "create")).toBe(true);
    expect(canWrite(["route_manager"], "routes", "update")).toBe(true);
    expect(canWrite(["account_manager"], "customers", "delete")).toBe(true);
    expect(canWrite(["maintenance"], "vehicle-maintenance", "create")).toBe(true);
  });

  it("sysadmin overrides every entity and operation", () => {
    for (const e of ALL_ENTITIES) {
      for (const op of ALL_OPS) {
        expect(canWrite([ADMIN_ROLE], e, op), `${e} ${op}`).toBe(true);
      }
    }
  });

  it("denies other domain roles", () => {
    expect(canWrite(["route_manager"], "operators", "create")).toBe(false);
    expect(canWrite(["asset_manager"], "customers", "delete")).toBe(false);
    expect(canWrite(["crew"], "crew-assignments", "delete")).toBe(false);
    expect(canWrite(["viewer"], "operators", "update")).toBe(false);
  });

  it("denies operations the entity does not offer", () => {
    // trips are generated from routes, never created directly
    expect(canWrite(["route_manager"], "trips", "create")).toBe(false);
    // reference data has no delete
    expect(canWrite(["asset_manager"], "airports", "delete")).toBe(false);
    expect(canWrite(["sysadmin"] as string[], "airports", "delete")).toBe(true);
  });
});