import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { requireRole } from "../lib/auth.js";

/**
 * REST CRUD endpoints for core domain entities.
 * Reads are open to any authenticated user; writes require the 'asset_manager' role.
 * POC-grade authz — will be replaced by ABAC (OPA) per the spec.
 */

export async function registerDomainRoutes(app: FastifyInstance): Promise<void> {
  // ── Operators ──────────────────────────────────────────────────────────
  app.get("/api/operators", async () => {
    return prisma.operator.findMany({ orderBy: { operatorId: "asc" } });
  });

  app.get("/api/operators/:id", async (request) => {
    const { id } = request.params as { id: string };
    return prisma.operator.findUnique({ where: { operatorId: id } });
  });

  // ── Vehicles ───────────────────────────────────────────────────────────
  app.get("/api/vehicles", async (request) => {
    const query = request.query as { kind?: string; operatorId?: string };
    const where: Record<string, unknown> = {};
    if (query.kind) where.kind = query.kind;
    if (query.operatorId) where.operatorId = query.operatorId;
    return prisma.vehicle.findMany({
      where,
      include: { model: true, operator: true },
      orderBy: { vehicleId: "asc" },
    });
  });

  app.get("/api/vehicles/:id", async (request) => {
    const { id } = request.params as { id: string };
    return prisma.vehicle.findUnique({
      where: { vehicleId: id },
      include: { model: true, operator: true },
    });
  });

  // ── Staff ──────────────────────────────────────────────────────────────
  app.get("/api/staff", async (request) => {
    const query = request.query as { operatorId?: string; role?: string };
    const where: Record<string, unknown> = {};
    if (query.operatorId) where.operatorId = query.operatorId;
    if (query.role) where.role = query.role;
    return prisma.staff.findMany({
      where,
      include: { operator: true },
      orderBy: { staffId: "asc" },
    });
  });

  // ── Customers ──────────────────────────────────────────────────────────
  app.get("/api/customers", async () => {
    return prisma.carrierCustomer.findMany({
      include: { operator: true },
      orderBy: { customerId: "asc" },
    });
  });

  // ── Cargo ──────────────────────────────────────────────────────────────
  app.get("/api/cargo", async (request) => {
    const query = request.query as { status?: string; operatorId?: string };
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.operatorId) where.operatorId = query.operatorId;
    return prisma.cargo.findMany({
      where,
      include: { customer: true, operator: true },
      orderBy: { cargoId: "asc" },
    });
  });

  // ── Routes ─────────────────────────────────────────────────────────────
  app.get("/api/routes", async (request) => {
    const query = request.query as { operatorId?: string };
    const where: Record<string, unknown> = {};
    if (query.operatorId) where.operatorId = query.operatorId;
    return prisma.route.findMany({
      where,
      include: { operator: true },
      orderBy: { routeId: "asc" },
    });
  });

  // ── Orders ─────────────────────────────────────────────────────────────
  app.get("/api/orders", async (request) => {
    const query = request.query as { status?: string; operatorId?: string };
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.operatorId) where.operatorId = query.operatorId;
    return prisma.asseticOrder.findMany({
      where,
      include: { customer: true, operator: true },
      orderBy: { orderId: "asc" },
    });
  });

  app.get("/api/orders/:id", async (request) => {
    const { id } = request.params as { id: string };
    return prisma.asseticOrder.findUnique({
      where: { orderId: id },
      include: { customer: true, operator: true },
    });
  });

  // ── Airports (reference) ───────────────────────────────────────────────
  app.get("/api/airports", async () => {
    return prisma.airport.findMany({ orderBy: { iata: "asc" } });
  });

  // ── Aircraft models (reference) ────────────────────────────────────────
  app.get("/api/aircraft-models", async () => {
    return prisma.aircraftModel.findMany({ orderBy: { modelId: "asc" } });
  });

  // ── Facilities ─────────────────────────────────────────────────────────
  app.get("/api/facilities", async () => {
    return prisma.facility.findMany({
      include: { operator: true },
      orderBy: { facilityId: "asc" },
    });
  });

  // ── Write endpoints (require asset_manager role) ───────────────────────
  app.post("/api/operators", async (request, reply) => {
    requireRole(request.user!, "asset_manager");
    const body = request.body as Record<string, unknown>;
    return prisma.operator.create({ data: body as never });
  });

  app.patch("/api/operators/:id", async (request) => {
    requireRole(request.user!, "asset_manager");
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    return prisma.operator.update({
      where: { operatorId: id },
      data: body as never,
    });
  });

  app.post("/api/orders", async (request) => {
    requireRole(request.user!, "trip_manager");
    const body = request.body as Record<string, unknown>;
    return prisma.asseticOrder.create({ data: body as never });
  });

  app.patch("/api/orders/:id", async (request) => {
    requireRole(request.user!, "trip_manager");
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    return prisma.asseticOrder.update({
      where: { orderId: id },
      data: body as never,
    });
  });

  // ── Passengers ──────────────────────────────────────────────────────────
  app.get("/api/passengers", async (request) => {
    const query = request.query as { operatorId?: string; status?: string };
    const where: Record<string, unknown> = {};
    if (query.operatorId) where.operatorId = query.operatorId;
    if (query.status) where.status = query.status;
    return prisma.passenger.findMany({
      where,
      orderBy: { passengerId: "asc" },
    });
  });

  app.get("/api/passengers/:id", async (request) => {
    const { id } = request.params as { id: string };
    return prisma.passenger.findUnique({ where: { passengerId: id } });
  });

  // ── Cargo current locations (projection view) ───────────────────────────
  app.get("/api/cargo/locations", async () => {
    return prisma.$queryRaw`
      SELECT * FROM cargo_current_location ORDER BY cargo_id ASC
    `;
  });

  app.get("/api/cargo/:id/location", async (request) => {
    const { id } = request.params as { id: string };
    const rows = await prisma.$queryRaw`
      SELECT * FROM cargo_current_location WHERE cargo_id = ${id}
    `;
    return (rows as unknown[])[0] ?? null;
  });

  // ── Passenger current locations (projection view) ───────────────────────
  app.get("/api/passengers/locations", async () => {
    return prisma.$queryRaw`
      SELECT * FROM passenger_current_location ORDER BY passenger_id ASC
    `;
  });

  app.get("/api/passengers/:id/location", async (request) => {
    const { id } = request.params as { id: string };
    const rows = await prisma.$queryRaw`
      SELECT * FROM passenger_current_location WHERE passenger_id = ${id}
    `;
    return (rows as unknown[])[0] ?? null;
  });

  // ── Cargo journey history ───────────────────────────────────────────────
  app.get("/api/cargo/:id/journey", async (request) => {
    const { id } = request.params as { id: string };
    return prisma.cargoJourneyEvent.findMany({
      where: { cargoId: id },
      orderBy: { sequence: "asc" },
    });
  });

  // ── Passenger boarding history ──────────────────────────────────────────
  app.get("/api/passengers/:id/boarding", async (request) => {
    const { id } = request.params as { id: string };
    return prisma.passengerBoardingEvent.findMany({
      where: { passengerId: id },
      orderBy: { sequence: "asc" },
    });
  });
}