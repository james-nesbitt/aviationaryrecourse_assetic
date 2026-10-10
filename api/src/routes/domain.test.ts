import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";

// Test the domain route handlers with a mocked Fastify app and mocked Prisma.
// We verify route registration, auth enforcement, and response shapes.

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    operator: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    vehicle: { findMany: vi.fn(), findUnique: vi.fn() },
    staff: { findMany: vi.fn(), findUnique: vi.fn() },
    carrierCustomer: { findMany: vi.fn() },
    cargo: { findMany: vi.fn() },
    route: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    asseticOrder: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    airport: { findMany: vi.fn() },
    aircraftModel: { findMany: vi.fn() },
    facility: { findMany: vi.fn() },
    passenger: { findUnique: vi.fn() },
    transitEvent: { findMany: vi.fn() },
    trip: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    crewAssignment: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    routeAssignment: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    vehicleMaintenance: { findMany: vi.fn() },
    $queryRaw: vi.fn(async () => []),
  },
}));

vi.mock("../lib/auth.js", () => ({
  verifyToken: vi.fn(),
  hasRole: vi.fn((user: { roles: string[] }, role: string) => user.roles.includes(role)),
  requireRole: vi.fn((user: { roles: string[] }, role: string) => {
    if (!user.roles.includes(role)) {
      const err = new Error(`Forbidden: missing role '${role}'`) as Error & { statusCode: number };
      err.statusCode = 403;
      throw err;
    }
  }),
}));

import { prisma } from "../lib/prisma.js";
import { registerDomainRoutes } from "../routes/domain.js";

interface MockRoute {
  handler: (req: unknown) => unknown;
}

interface MockApp {
  routes: Map<string, MockRoute>;
  get: (path: string, handler: unknown) => void;
  post: (path: string, handler: unknown) => void;
  patch: (path: string, handler: unknown) => void;
}

function createMockApp(): MockApp {
  const routes = new Map<string, MockRoute>();
  return {
    routes,
    get(path, handler) { routes.set(`GET ${path}`, { handler: handler as (req: unknown) => unknown }); },
    post(path, handler) { routes.set(`POST ${path}`, { handler: handler as (req: unknown) => unknown }); },
    patch(path, handler) { routes.set(`PATCH ${path}`, { handler: handler as (req: unknown) => unknown }); },
  };
}

const mockUser = { sub: "123", username: "admin", roles: ["asset_manager", "route_manager"], raw: {} };

describe("Domain routes", () => {
  let app: MockApp;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = createMockApp();
    await registerDomainRoutes(app as unknown as FastifyInstance);
  });

  it("registers GET /api/operators", () => {
    expect(app.routes.has("GET /api/operators")).toBe(true);
  });

  it("registers GET /api/vehicles", () => {
    expect(app.routes.has("GET /api/vehicles")).toBe(true);
  });

  it("registers GET /api/orders", () => {
    expect(app.routes.has("GET /api/orders")).toBe(true);
  });


  it("GET /api/operators calls prisma.operator.findMany", async () => {
    const mocked = vi.mocked(prisma.operator.findMany);
    mocked.mockResolvedValue([{ operator_id: "opr-0001", name: "Test Air" }] as never);
    const route = app.routes.get("GET /api/operators");
    expect(route).toBeDefined();
    const result = (await route!.handler({ user: mockUser, query: {} })) as unknown as {
      rows: unknown[];
      next_cursor: string | null;
    };
    expect(mocked).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null }, orderBy: [{ operatorId: "asc" }] }),
    );
    expect(result.rows).toHaveLength(1);
    expect(result.next_cursor).toBeNull();
  });

  it("GET /api/vehicles with kind filter passes filter to prisma", async () => {
    const mocked = vi.mocked(prisma.vehicle.findMany);
    mocked.mockResolvedValue([]);
    const route = app.routes.get("GET /api/vehicles");
    expect(route).toBeDefined();
    await route!.handler({ user: mockUser, query: { kind: "aircraft" } });
    expect(mocked).toHaveBeenCalledWith(
      expect.objectContaining({ where: { kind: "aircraft", deletedAt: null } }),
    );
  });

  it("GET /api/orders with status filter passes filter to prisma", async () => {
    const mocked = vi.mocked(prisma.asseticOrder.findMany);
    mocked.mockResolvedValue([]);
    const route = app.routes.get("GET /api/orders");
    expect(route).toBeDefined();
    await route!.handler({ user: mockUser, query: { status: "confirmed" } });
    expect(mocked).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "confirmed", deletedAt: null } }),
    );
  });

  it("GET /api/cargo/:id/events calls prisma.transitEvent.findMany ordered by sequence", async () => {
    const mocked = vi.mocked(prisma.transitEvent.findMany);
    mocked.mockResolvedValue([]);
    const route = app.routes.get("GET /api/cargo/:id/events");
    expect(route).toBeDefined();
    await route!.handler({ user: mockUser, params: { id: "cgo-0001" } });
    expect(mocked).toHaveBeenCalledWith({
      where: { cargoId: "cgo-0001" },
      orderBy: { sequence: "asc" },
    });
  });

  it("registers all expected read endpoints", () => {
    const expected = [
      "GET /api/operators",
      "GET /api/vehicles",
      "GET /api/staff",
      "GET /api/customers",
      "GET /api/customers/:id",
      "GET /api/cargo",
      "GET /api/cargo/:id",
      "GET /api/routes",
      "GET /api/trips",
      "GET /api/trips/:id",
      "GET /api/trips/:id/crew",
      "GET /api/routes/:id",
      "GET /api/routes/:id/trips",
      "GET /api/routes/:id/crew",
      "GET /api/vehicles/:id/trips",
      "GET /api/vehicles/:id/maintenance",
      "GET /api/vehicles/:id/stats",
      "GET /api/crew-assignments",
      "GET /api/staff/fatigue",
      "GET /api/staff/:id",
      "GET /api/stats/fleet",
      "GET /api/stats/locations",
      "GET /api/airports/:id/activity",
      "GET /api/accounts/overview",
      "GET /api/stats/operations",
      "GET /api/stats/crew",
      "GET /api/route-assignments",
      "GET /api/vehicle-maintenance",
      "GET /api/orders",
      "GET /api/airports",
      "GET /api/aircraft-models",
      "GET /api/facilities",
      "GET /api/passengers",
      "GET /api/passengers/:id",
      "GET /api/cargo/:id/events",
      "GET /api/passengers/:id/events",
      "GET /api/transit/transitions",
    ];
    for (const path of expected) {
      expect(app.routes.has(path)).toBe(true);
    }
  });

  it("GET /api/trips passes vehicleId and status filters to prisma", async () => {
    const mocked = vi.mocked(prisma.trip.findMany);
    mocked.mockResolvedValue([]);
    const route = app.routes.get("GET /api/trips");
    if (!route) throw new Error("route not registered");
    await route.handler({ query: { vehicleId: "veh-0001", status: "completed" } });
    expect(mocked).toHaveBeenCalledWith(
      expect.objectContaining({ where: { vehicleId: "veh-0001", status: "completed", deletedAt: null } }),
    );
  });
});