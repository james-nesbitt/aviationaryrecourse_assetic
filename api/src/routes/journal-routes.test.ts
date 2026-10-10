import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    // handler calls in order: last-row lookup, nextval, row_hash; then execute
    $queryRaw: vi.fn()
      .mockResolvedValueOnce([])                       // no prior chain row → GENESIS
      .mockResolvedValueOnce([{ next_id: BigInt(42) }]) // journal seq
      .mockResolvedValueOnce([{ row_hash: "hash-1" }]), // computed row hash
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

import { registerJournalRoutes } from "./journal.js";

interface MockRoute {
  handler: (req: unknown) => unknown;
}
interface MockApp {
  routes: Map<string, MockRoute>;
  post: (path: string, handler: unknown) => void;
  get: (path: string, handler: unknown) => void;
}
function createMockApp(): MockApp {
  const routes = new Map<string, MockRoute>();
  return {
    routes,
    post(path, handler) { routes.set(`POST ${path}`, { handler: handler as (req: unknown) => unknown }); },
    get(path, handler) { routes.set(`GET ${path}`, { handler: handler as (req: unknown) => unknown }); },
  };
}

const baseBody = {
  chain_key: "custody:cgo-0001",
  event_type: "loaded",
  entity_type: "cargo",
  entity_id: "cgo-0001",
  payload: { iata: "DFW" },
  valid_time: "2000-02-12T08:00:00Z",
  agent_run_id: "run-1",
};

describe("Journal append gate", () => {
  let app: MockApp;
  beforeEach(() => {
    vi.clearAllMocks();
    app = createMockApp();
    registerJournalRoutes(app as unknown as FastifyInstance);
  });

  it("registers POST /api/journal", () => {
    expect(app.routes.has("POST /api/journal")).toBe(true);
  });

  it("rejects a caller without journal_writer", async () => {
    const handler = app.routes.get("POST /api/journal")!.handler as unknown as (req: unknown, reply: unknown) => unknown;
    const req = { user: { sub: "456", roles: ["viewer"], raw: {} }, body: baseBody };
    await expect(handler(req, {})).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringContaining("journal_writer"),
    });
  });

  it("rejects a body-supplied actor_id with 400", async () => {
    const handler = app.routes.get("POST /api/journal")!.handler;
    const reply = { code: vi.fn().mockReturnThis(), send: vi.fn() };
    const req = { user: { sub: "123", roles: ["journal_writer"], raw: {} }, body: { ...baseBody, actor_id: "someone-else" } };
    // handler receives reply via `this`-less signature: fastify passes reply
    // as second arg only if declared; this handler closes over (request, reply).
    await (handler as unknown as (request: unknown, reply: unknown) => unknown)(req, reply);
    expect(reply.code).toHaveBeenCalledWith(400);
  });

  it("accepts journal_writer and returns the appended entry", async () => {
    const handler = app.routes.get("POST /api/journal")!.handler as unknown as (req: unknown, reply: unknown) => unknown;
    const reply = { code: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() };
    const req = { user: { sub: "token-sub-1", roles: ["journal_writer"], raw: {} }, body: baseBody };
    const payload = (await handler(req, reply)) as { chain_key: string; prev_hash: string; journal_id: string };
    expect(reply.code).toHaveBeenCalledWith(201);
    expect(payload.chain_key).toBe("custody:cgo-0001");
    expect(payload.prev_hash).toBe("GENESIS");
    expect(payload.journal_id).toBe("42");
  });
});
