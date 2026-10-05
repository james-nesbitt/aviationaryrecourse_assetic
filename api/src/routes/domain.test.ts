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
    staff: { findMany: vi.fn() },
    carrierCustomer: { findMany: vi.fn() },
    cargo: { findMany: vi.fn() },
    route: { findMany: vi.fn() },
    asseticOrder: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    airport: { findMany: vi.fn() },
    aircraftModel: { findMany: vi.fn() },
    facility: { findMany: vi.fn() },
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

const mockUser = { sub: "123", username: "admin", roles: ["asset_manager", "trip_manager"], raw: {} };

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

  it("registers POST /api/operators (write endpoint)", () => {
    expect(app.routes.has("POST /api/operators")).toBe(true);
  });

  it("registers PATCH /api/operators/:id (write endpoint)", () => {
    expect(app.routes.has("PATCH /api/operators/:id")).toBe(true);
  });

  it("registers POST /api/orders (write endpoint)", () => {
    expect(app.routes.has("POST /api/orders")).toBe(true);
  });

  it("GET /api/operators calls prisma.operator.findMany", async () => {
    const mocked = vi.mocked(prisma.operator.findMany);
    mocked.mockResolvedValue([{ operator_id: "opr-0001", name: "Test Air" }]);
    const route = app.routes.get("GET /api/operators");
    expect(route).toBeDefined();
    const result = await route!.handler({ user: mockUser });
    expect(mocked).toHaveBeenCalledWith({ orderBy: { operatorId: "asc" } });
    expect(result).toHaveLength(1);
  });

  it("GET /api/vehicles with kind filter passes filter to prisma", async () => {
    const mocked = vi.mocked(prisma.vehicle.findMany);
    mocked.mockResolvedValue([]);
    const route = app.routes.get("GET /api/vehicles");
    expect(route).toBeDefined();
    await route!.handler({ user: mockUser, query: { kind: "aircraft" } });
    expect(mocked).toHaveBeenCalledWith(
      expect.objectContaining({ where: { kind: "aircraft" } }),
    );
  });

  it("POST /api/operators requires asset_manager role", async () => {
    const route = app.routes.get("POST /api/operators");
    expect(route).toBeDefined();
    const restrictedUser = { ...mockUser, roles: ["trip_manager"] };
    await expect(route!.handler({ user: restrictedUser, body: {} })).rejects.toThrow();
  });

  it("POST /api/orders requires trip_manager role", async () => {
    const route = app.routes.get("POST /api/orders");
    expect(route).toBeDefined();
    const restrictedUser = { ...mockUser, roles: ["loading_team"] };
    await expect(route!.handler({ user: restrictedUser, body: {} })).rejects.toThrow();
  });

  it("GET /api/orders with status filter passes filter to prisma", async () => {
    const mocked = vi.mocked(prisma.asseticOrder.findMany);
    mocked.mockResolvedValue([]);
    const route = app.routes.get("GET /api/orders");
    expect(route).toBeDefined();
    await route!.handler({ user: mockUser, query: { status: "confirmed" } });
    expect(mocked).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "confirmed" } }),
    );
  });

  it("registers all expected read endpoints", () => {
    const expected = [
      "GET /api/operators",
      "GET /api/vehicles",
      "GET /api/staff",
      "GET /api/customers",
      "GET /api/cargo",
      "GET /api/routes",
      "GET /api/orders",
      "GET /api/airports",
      "GET /api/aircraft-models",
      "GET /api/facilities",
    ];
    for (const path of expected) {
      expect(app.routes.has(path)).toBe(true);
    }
  });
});