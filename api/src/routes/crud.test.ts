import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    operator: {
      findUnique: vi.fn(async ({ where }: { where: { operatorId?: string } }) =>
        where.operatorId === "opr-0001" ? { operatorId: "opr-0001", deletedAt: null } : null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(async () => 1),
  },
}));

vi.mock("../lib/auth.js", () => ({
  requireRole: vi.fn((user: { roles: string[] }, role: string) => {
    if (!user.roles.includes(role)) {
      const err = new Error(`Forbidden: missing role '${role}'`) as Error & { statusCode: number };
      err.statusCode = 403;
      throw err;
    }
  }),
  verifyToken: vi.fn(),
  hasRole: vi.fn((user: { roles: string[] }, role: string) => user.roles.includes(role)),
}));

vi.mock("./domain.js", () => ({
  datasetAnchor: vi.fn(async () => ({ anchorDate: new Date("2000-02-12T00:00:00Z"), anchorAt: new Date("2000-02-12T12:00:00Z") })),
}));

import { prisma } from "../lib/prisma.js";
import { registerCrudRoutes } from "./crud.js";

interface MockRoute {
  handler: (req: unknown, reply: unknown) => unknown;
  methods: Set<string>;
}
function createMockApp() {
  const routes = new Map<string, MockRoute>();
  const app = {
    routes,
    post: (path: string, handler: unknown) => routes.set(`POST ${path}`, { handler: handler as (req: unknown, reply: unknown) => unknown, methods: new Set(["POST"]) }),
    patch: (path: string, handler: unknown) => routes.set(`PATCH ${path}`, { handler: handler as (req: unknown, reply: unknown) => unknown, methods: new Set(["PATCH"]) }),
    delete: (path: string, handler: unknown) => routes.set(`DELETE ${path}`, { handler: handler as (req: unknown, reply: unknown) => unknown, methods: new Set(["DELETE"]) }),
  };
  return app as unknown as FastifyInstance & { routes: Map<string, MockRoute> };
}

const reply = () => {
  const r = { code: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() };
  return r as unknown as { code: (n: number) => unknown; send: (b: unknown) => unknown };
};

describe("Crud routes", () => {
  let app: ReturnType<typeof createMockApp>;
  beforeEach(async () => {
    vi.clearAllMocks();
    // journalWrite call order per write: chain tail → seq → row hash
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ next_id: BigInt(1) }])
      .mockResolvedValueOnce([{ row_hash: "h" }]);
    app = createMockApp();
    await registerCrudRoutes(app);
  });

  it("registers POST/PATCH/DELETE for operators", () => {
    expect(app.routes.has("POST /api/operators")).toBe(true);
    expect(app.routes.has("PATCH /api/operators/:id")).toBe(true);
    expect(app.routes.has("DELETE /api/operators/:id")).toBe(true);
  });

  it("does not offer create for airports (read/update reference only)", () => {
    expect(app.routes.has("POST /api/airports")).toBe(false);
    expect(app.routes.has("PATCH /api/airports/:id")).toBe(true);
    expect(app.routes.has("DELETE /api/airports/:id")).toBe(false);
  });

  it("create with asset_manager returns 201", async () => {
    const r = reply();
    const req = {
      user: { sub: "s1", roles: ["asset_manager"], username: "a", raw: {} },
      body: { operator_id: "opr-new", name: "New", type: "passenger", country: "US", hub_iata: "JFK", schema_version: 999, generated_at: "2030-01-01" },
    };
    const handler = app.routes.get("POST /api/operators")!.handler;
    const out = await handler(req, r);
    expect(r.code).toHaveBeenCalledWith(201);
    expect((out as Record<string, unknown>).name).toBe("New");
    // provenance dropped, mapped keys camelCase
    expect(out).not.toHaveProperty("schema_version");
  });

  it("create by route_manager is 403", async () => {
    const r = reply();
    const req = {
      user: { sub: "s2", roles: ["route_manager"], username: "rm", raw: {} },
      body: { operator_id: "opr-x", name: "X", type: "cargo", country: "US", hub_iata: "JFK" },
    };
    const handler = app.routes.get("POST /api/operators")!.handler;
    await expect(handler(req, r)).rejects.toMatchObject({ statusCode: 403 });
  });

  it("create missing required fields returns 400 with the fields", async () => {
    const r = reply();
    const req = {
      user: { sub: "s1", roles: ["asset_manager"], username: "a", raw: {} },
      body: { operator_id: "opr-new", name: "New" },
    };
    const handler = app.routes.get("POST /api/operators")!.handler;
    await handler(req, r);
    expect(r.code).toHaveBeenCalledWith(400);
  });

  it("patch unknown id returns 404", async () => {
    const r = reply();
    const req = {
      user: { sub: "s1", roles: ["asset_manager"], username: "a", raw: {} },
      body: { name: "Renamed" },
      params: { id: "opr-missing" },
    };
    const handler = app.routes.get("PATCH /api/operators/:id")!.handler;
    await handler(req, r);
    expect(r.code).toHaveBeenCalledWith(404);
  });

  it("patch with only non-mutable fields returns 400", async () => {
    const r = reply();
    const req = {
      user: { sub: "s1", roles: ["asset_manager"], username: "a", raw: {} },
      body: { schema_version: 5 },
      params: { id: "opr-0001" },
    };
    const handler = app.routes.get("PATCH /api/operators/:id")!.handler;
    await handler(req, r);
    expect(r.code).toHaveBeenCalledWith(400);
  });

  it("delete soft-deletes via updateMany and returns 204", async () => {
    const r = reply();
    const req = {
      user: { sub: "s1", roles: ["sysadmin"], username: "admin", raw: {} },
      params: { id: "opr-0001" },
    };
    const handler = app.routes.get("DELETE /api/operators/:id")!.handler;
    await handler(req, r);
    expect(r.code).toHaveBeenCalledWith(204);
  });

  it("delete by account_manager is 403 on operators", async () => {
    const r = reply();
    const req = {
      user: { sub: "s3", roles: ["account_manager"], username: "am", raw: {} },
      params: { id: "opr-0001" },
    };
    const handler = app.routes.get("DELETE /api/operators/:id")!.handler;
    await expect(handler(req, r)).rejects.toMatchObject({ statusCode: 403 });
  });
});