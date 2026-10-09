import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { requireRole } from "../lib/auth.js";
import { cached, invalidate, TTL } from "../lib/statsCache.js";
import { fatigueLevel, tripDutyHours } from "../lib/fatigue.js";
import { operatingDates, shiftLegs, tripStatus, type RouteLeg } from "../lib/trips.js";

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
    const query = request.query as { state?: string; operatorId?: string };
    return prisma.$queryRaw`
      SELECT * FROM cargo_state
      WHERE (${query.state ?? null}::text IS NULL OR state = ${query.state ?? null})
        AND (${query.operatorId ?? null}::text IS NULL OR operator_id = ${query.operatorId ?? null})
      ORDER BY cargo_id ASC
    `;
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

  // ── Trips (dated route instances) ──────────────────────────────────────
  app.get("/api/trips", async (request) => {
    const query = request.query as {
      routeId?: string;
      vehicleId?: string;
      operatorId?: string;
      status?: string;
    };
    const where: Record<string, unknown> = {};
    if (query.routeId) where.routeId = query.routeId;
    if (query.vehicleId) where.vehicleId = query.vehicleId;
    if (query.operatorId) where.operatorId = query.operatorId;
    if (query.status) where.status = query.status;
    return prisma.trip.findMany({
      where,
      orderBy: [{ operatingDate: "asc" }, { routeId: "asc" }],
    });
  });

  app.get("/api/trips/:id", async (request) => {
    const { id } = request.params as { id: string };
    return prisma.trip.findUnique({ where: { tripId: id } });
  });

  app.get("/api/trips/:id/crew", async (request) => {
    const { id } = request.params as { id: string };
    return prisma.$queryRaw`
      SELECT ca.assignment_id, ca.trip_id, ca.crew_role,
             s.staff_id, s.given_name, s.family_name, s.role, s.base_iata
      FROM crew_assignment ca
      JOIN staff s ON s.staff_id = ca.staff_id
      WHERE ca.trip_id = ${id}
      ORDER BY ca.crew_role, s.staff_id
    `;
  });

  // ── Route assignments ──────────────────────────────────────────────────
  app.get("/api/route-assignments", async (request) => {
    const query = request.query as { routeId?: string; vehicleId?: string };
    const where: Record<string, unknown> = {};
    if (query.routeId) where.routeId = query.routeId;
    if (query.vehicleId) where.vehicleId = query.vehicleId;
    return prisma.routeAssignment.findMany({
      where,
      orderBy: [{ routeId: "asc" }, { validFrom: "asc" }],
    });
  });

  // ── Vehicle maintenance ────────────────────────────────────────────────
  app.get("/api/vehicle-maintenance", async (request) => {
    const query = request.query as { vehicleId?: string; status?: string };
    const where: Record<string, unknown> = {};
    if (query.vehicleId) where.vehicleId = query.vehicleId;
    if (query.status) where.status = query.status;
    return prisma.vehicleMaintenance.findMany({
      where,
      orderBy: [{ vehicleId: "asc" }, { startDate: "asc" }],
    });
  });

  // ── Route detail (route manager) ───────────────────────────────────────
  app.get("/api/routes/:id", async (request) => {
    const { id } = request.params as { id: string };
    const route = await prisma.route.findUnique({
      where: { routeId: id },
      include: { operator: true },
    });
    if (!route) return null;
    const [assignments, nextTrip, tripCount] = await Promise.all([
      prisma.routeAssignment.findMany({
        where: { routeId: id },
        orderBy: { validFrom: "asc" },
      }),
      prisma.trip.findFirst({
        where: { routeId: id, status: "scheduled" },
        orderBy: { operatingDate: "asc" },
      }),
      prisma.trip.count({ where: { routeId: id } }),
    ]);
    return { ...route, assignments, next_trip: nextTrip, trip_count: tripCount };
  });

  app.get("/api/routes/:id/trips", async (request) => {
    const { id } = request.params as { id: string };
    const query = request.query as { status?: string };
    const where: Record<string, unknown> = { routeId: id };
    if (query.status) where.status = query.status;
    return prisma.trip.findMany({ where, orderBy: { operatingDate: "asc" } });
  });

  app.get("/api/routes/:id/crew", async (request) => {
    const { id } = request.params as { id: string };
    return prisma.$queryRaw`
      SELECT t.trip_id, t.operating_date, t.status,
             ca.crew_role, s.staff_id, s.given_name, s.family_name
      FROM trip t
      LEFT JOIN crew_assignment ca ON ca.trip_id = t.trip_id
      LEFT JOIN staff s ON s.staff_id = ca.staff_id
      WHERE t.route_id = ${id}
      ORDER BY t.operating_date ASC, ca.crew_role ASC
    `;
  });

  // ── Vehicle detail (maintenance manager) ───────────────────────────────
  app.get("/api/vehicles/:id/trips", async (request) => {
    const { id } = request.params as { id: string };
    const query = request.query as { status?: string };
    const where: Record<string, unknown> = { vehicleId: id };
    if (query.status) where.status = query.status;
    return prisma.trip.findMany({ where, orderBy: { operatingDate: "desc" } });
  });

  app.get("/api/vehicles/:id/maintenance", async (request) => {
    const { id } = request.params as { id: string };
    return prisma.vehicleMaintenance.findMany({
      where: { vehicleId: id },
      orderBy: { startDate: "asc" },
    });
  });

  app.get("/api/vehicles/:id/stats", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { value, hit } = await cached(
      `stats:vehicle:${id}`,
      async () => {
        const [byMonth, byType, totals] = await Promise.all([
          prisma.$queryRaw`
            SELECT to_char(operating_date, 'YYYY-MM') AS month,
                   count(*)::int AS trips,
                   count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
                   round(sum(
                     EXTRACT(EPOCH FROM (
                       (legs -> (jsonb_array_length(legs) - 1) ->> 'scheduled_arrival')::timestamp
                       - (legs -> 0 ->> 'scheduled_departure')::timestamp
                     )) / 3600.0
                   )::numeric, 1) AS block_hours
            FROM trip WHERE vehicle_id = ${id}
            GROUP BY 1 ORDER BY 1
          `,
          prisma.$queryRaw`
            SELECT maintenance_type, count(*)::int AS windows,
                   sum(end_date - start_date + 1)::int AS days
            FROM vehicle_maintenance WHERE vehicle_id = ${id}
            GROUP BY 1 ORDER BY 1
          `,
          prisma.$queryRaw`
            SELECT count(*)::int AS total_trips,
                   count(*) FILTER (WHERE status = 'completed')::int AS completed,
                   count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
                   count(DISTINCT operating_date)::int AS operating_days
            FROM trip WHERE vehicle_id = ${id}
          `,
        ]);
        return {
          vehicle_id: id,
          trips_by_month: byMonth,
          maintenance_by_type: byType,
          totals: (totals as unknown[])[0] ?? null,
        };
      },
      TTL.stats,
    );
    reply.header("X-Cache", hit ? "hit" : "miss");
    reply.header("Cache-Control", `private, max-age=${TTL.stats}`);
    return value;
  });

  // ── Crew assignments and fatigue ───────────────────────────────────────
  app.get("/api/crew-assignments", async (request) => {
    const query = request.query as { tripId?: string; staffId?: string };
    const where: Record<string, unknown> = {};
    if (query.tripId) where.tripId = query.tripId;
    if (query.staffId) where.staffId = query.staffId;
    return prisma.crewAssignment.findMany({
      where,
      orderBy: [{ tripId: "asc" }, { crewRole: "asc" }],
    });
  });

  app.get("/api/staff/fatigue", async (request, reply) => {
    const query = request.query as { operatorId?: string; level?: string };
    const key = `fatigue:${query.operatorId ?? "all"}:${query.level ?? "all"}`;
    const { value, hit } = await cached(
      key,
      async () => prisma.$queryRaw`
        SELECT * FROM crew_fatigue_v
        WHERE (${query.operatorId ?? null}::text IS NULL OR operator_id = ${query.operatorId ?? null})
          AND (${query.level ?? null}::text IS NULL OR level = ${query.level ?? null})
        ORDER BY duty_hours_7d DESC, staff_id ASC
      `,
      TTL.fatigue,
    );
    reply.header("X-Cache", hit ? "hit" : "miss");
    reply.header("Cache-Control", `private, max-age=${TTL.fatigue}`);
    return value;
  });

  // ── Staff detail ───────────────────────────────────────────────────────
  app.get("/api/staff/:id", async (request) => {
    const { id } = request.params as { id: string };
    const staff = await prisma.staff.findUnique({
      where: { staffId: id },
      include: { operator: true },
    });
    if (!staff) return null;
    const [assignments, fatigue] = await Promise.all([
      prisma.$queryRaw`
        SELECT ca.assignment_id, ca.crew_role, t.trip_id, t.route_id,
               t.operating_date, t.status, t.vehicle_id, t.legs
        FROM crew_assignment ca
        JOIN trip t ON t.trip_id = ca.trip_id
        WHERE ca.staff_id = ${id}
        ORDER BY t.operating_date DESC
      `,
      prisma.$queryRaw`SELECT * FROM crew_fatigue_v WHERE staff_id = ${id}`,
    ]);
    return {
      ...staff,
      assignments,
      fatigue: (fatigue as unknown[])[0] ?? null,
    };
  });

  // ── Dashboard statistics ───────────────────────────────────────────────
  app.get("/api/stats/fleet", async (_request, reply) => {
    const { value, hit } = await cached(
      "stats:fleet",
      async () => {
        const [fleet, trips, backlog] = await Promise.all([
          prisma.$queryRaw`
            SELECT o.operator_id, o.name AS operator_name, v.status,
                   count(*)::int AS vehicles
            FROM vehicle v JOIN operator o ON o.operator_id = v.operator_id
            WHERE v.kind = 'aircraft'
            GROUP BY 1, 2, 3 ORDER BY 1, 3
          `,
          prisma.$queryRaw`
            SELECT operator_id, status, count(*)::int AS trips
            FROM trip GROUP BY 1, 2 ORDER BY 1, 2
          `,
          prisma.$queryRaw`
            SELECT vm.maintenance_id, vm.vehicle_id, vm.maintenance_type,
                   vm.start_date, vm.end_date, vm.status, v.registration
            FROM vehicle_maintenance vm
            JOIN vehicle v ON v.vehicle_id = vm.vehicle_id
            WHERE vm.status IN ('scheduled', 'in_progress')
            ORDER BY vm.start_date ASC
          `,
        ]);
        return { fleet_by_status: fleet, trips_by_status: trips, maintenance_backlog: backlog };
      },
      TTL.stats,
    );
    reply.header("X-Cache", hit ? "hit" : "miss");
    reply.header("Cache-Control", `private, max-age=${TTL.stats}`);
    return value;
  });

  app.get("/api/stats/operations", async (request, reply) => {
    const query = request.query as { days?: string };
    const days = Math.min(Math.max(Number(query.days ?? 30) || 30, 1), 365);
    const { value, hit } = await cached(
      `stats:operations:${days}`,
      async () => {
        const [byDay, topRoutes] = await Promise.all([
          prisma.$queryRaw`
            SELECT operating_date, status, count(*)::int AS trips
            FROM trip
            WHERE operating_date >= (SELECT max(generated_at) FROM trip) - ${days}::int
              AND operating_date <= (SELECT max(generated_at) FROM trip) + 14
            GROUP BY 1, 2 ORDER BY 1, 2
          `,
          prisma.$queryRaw`
            SELECT t.route_id, r.route_type, r.base_iata,
                   count(*)::int AS trips,
                   count(*) FILTER (WHERE t.status = 'completed')::int AS completed,
                   count(*) FILTER (WHERE t.status = 'cancelled')::int AS cancelled
            FROM trip t JOIN route r ON r.route_id = t.route_id
            GROUP BY 1, 2, 3 ORDER BY completed DESC LIMIT 10
          `,
        ]);
        return { window_days: days, trips_by_day: byDay, top_routes: topRoutes };
      },
      TTL.stats,
    );
    reply.header("X-Cache", hit ? "hit" : "miss");
    reply.header("Cache-Control", `private, max-age=${TTL.stats}`);
    return value;
  });

  app.get("/api/stats/crew", async (request, reply) => {
    const query = request.query as { operatorId?: string };
    const { value, hit } = await cached(
      `stats:crew:${query.operatorId ?? "all"}`,
      async () => {
        const [levels, byRole] = await Promise.all([
          prisma.$queryRaw`
            SELECT level, count(*)::int AS crew,
                   round(avg(duty_hours_7d), 1) AS avg_duty_hours
            FROM crew_fatigue_v
            WHERE (${query.operatorId ?? null}::text IS NULL OR operator_id = ${query.operatorId ?? null})
            GROUP BY 1 ORDER BY 1
          `,
          prisma.$queryRaw`
            SELECT role, count(*)::int AS crew,
                   round(avg(duty_hours_7d), 1) AS avg_duty_hours,
                   max(duty_hours_7d) AS max_duty_hours
            FROM crew_fatigue_v
            WHERE (${query.operatorId ?? null}::text IS NULL OR operator_id = ${query.operatorId ?? null})
            GROUP BY 1 ORDER BY 1
          `,
        ]);
        return { by_level: levels, by_role: byRole };
      },
      TTL.stats,
    );
    reply.header("X-Cache", hit ? "hit" : "miss");
    reply.header("Cache-Control", `private, max-age=${TTL.stats}`);
    return value;
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
    requireRole(request.user!, "route_manager");
    const body = request.body as Record<string, unknown>;
    return prisma.asseticOrder.create({ data: body as never });
  });

  app.patch("/api/orders/:id", async (request) => {
    requireRole(request.user!, "route_manager");
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    return prisma.asseticOrder.update({
      where: { orderId: id },
      data: body as never,
    });
  });

  // ── Route writes (require route_manager role) ──────────────────────────
  // Creating a route also materialises its trips from first_operating_date
  // through the 14-day future horizon, mirroring datagen's generate_trips.
  app.post("/api/routes", async (request, reply) => {
    requireRole(request.user!, "route_manager");
    const body = request.body as {
      route_id?: string;
      operator_id: string;
      vehicle_id: string;
      route_type: string;
      base_iata: string;
      frequency_days: number;
      first_operating_date: string;
      legs: RouteLeg[];
    };
    const routeId = body.route_id ?? `rte-api-${Date.now().toString(36)}`;
    const firstDate = new Date(`${body.first_operating_date}T00:00:00Z`);
    const anchorAt = new Date();
    const horizon = new Date(Date.now() + 14 * 86_400_000);
    const generatedAt = new Date(anchorAt.toISOString().slice(0, 10));

    const route = await prisma.route.create({
      data: {
        routeId,
        operatorId: body.operator_id,
        vehicleId: body.vehicle_id,
        routeType: body.route_type,
        baseIata: body.base_iata,
        frequencyDays: body.frequency_days,
        firstOperatingDate: firstDate,
        legs: body.legs as never,
        generatedAt,
      },
    });
    await prisma.routeAssignment.create({
      data: {
        assignmentId: `asg-api-${routeId}-1`,
        routeId,
        vehicleId: body.vehicle_id,
        validFrom: firstDate,
        validTo: null,
        reason: "initial",
        generatedAt,
      },
    });
    const dates = operatingDates(firstDate, body.frequency_days, firstDate, horizon);
    await prisma.trip.createMany({
      data: dates.map((d) => {
        const legs = shiftLegs(body.legs, firstDate, d);
        return {
          tripId: `trp-api-${routeId}-${d.toISOString().slice(0, 10)}`,
          routeId,
          vehicleId: body.vehicle_id,
          operatorId: body.operator_id,
          operatingDate: d,
          status: tripStatus(legs, anchorAt),
          legs: legs as never,
          generatedAt,
        };
      }),
    });
    invalidate("stats:", "fatigue:");
    reply.code(201);
    return { ...route, trips_created: dates.length };
  });

  // Changing a route takes effect from `effective_from`: the open assignment
  // interval is closed the day before, a new one is appended, and only trips
  // on/after that date are regenerated. Past trips are immutable. Rejected
  // with 409 when regeneration would drop existing crew assignments.
  app.patch("/api/routes/:id", async (request, reply) => {
    requireRole(request.user!, "route_manager");
    const { id } = request.params as { id: string };
    const body = request.body as {
      effective_from: string;
      vehicle_id?: string;
      frequency_days?: number;
      legs?: RouteLeg[];
    };
    if (!body.effective_from) {
      reply.code(400);
      return { error: "effective_from is required" };
    }
    const route = await prisma.route.findUnique({ where: { routeId: id } });
    if (!route) {
      reply.code(404);
      return { error: `route ${id} not found` };
    }
    const effective = new Date(`${body.effective_from}T00:00:00Z`);

    const crewed = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count
      FROM crew_assignment ca JOIN trip t ON t.trip_id = ca.trip_id
      WHERE t.route_id = ${id} AND t.operating_date >= ${effective}
    `;
    if (Number(crewed[0]?.count ?? 0) > 0) {
      reply.code(409);
      return {
        error: "trips on or after effective_from have crew assignments",
        crewed_trips: Number(crewed[0].count),
        remedy: "remove or re-assign crew before changing the route",
      };
    }

    const vehicleId = body.vehicle_id ?? route.vehicleId;
    const frequencyDays = body.frequency_days ?? route.frequencyDays;
    const legs = (body.legs ?? (route.legs as unknown as RouteLeg[])) as RouteLeg[];
    const generatedAt = new Date(new Date().toISOString().slice(0, 10));
    const anchorAt = new Date();
    const horizon = new Date(Date.now() + 14 * 86_400_000);

    const open = await prisma.routeAssignment.findFirst({
      where: { routeId: id, validTo: null },
      orderBy: { validFrom: "desc" },
    });
    // History is immutable: a change cannot take effect before (or on) the day
    // the currently-open assignment started, or the interval chain would have
    // valid_to < valid_from.
    if (open && effective <= open.validFrom) {
      reply.code(409);
      return {
        error: "effective_from must be after the current assignment's valid_from",
        current_valid_from: open.validFrom.toISOString().slice(0, 10),
      };
    }
    if (open) {
      await prisma.routeAssignment.update({
        where: { assignmentId: open.assignmentId },
        data: { validTo: new Date(effective.getTime() - 86_400_000) },
      });
    }
    await prisma.routeAssignment.create({
      data: {
        assignmentId: `asg-api-${id}-${Date.now().toString(36)}`,
        routeId: id,
        vehicleId,
        validFrom: effective,
        validTo: null,
        reason: "route_update",
        replacesVehicleId: open?.vehicleId ?? null,
        generatedAt,
      },
    });
    await prisma.route.update({
      where: { routeId: id },
      data: { vehicleId, frequencyDays, legs: legs as never },
    });
    const deleted = await prisma.trip.deleteMany({
      where: { routeId: id, operatingDate: { gte: effective } },
    });
    const dates = operatingDates(route.firstOperatingDate, frequencyDays, effective, horizon);
    await prisma.trip.createMany({
      data: dates.map((d) => {
        const shifted = shiftLegs(legs, route.firstOperatingDate, d);
        return {
          tripId: `trp-api-${id}-${d.toISOString().slice(0, 10)}`,
          routeId: id,
          vehicleId,
          operatorId: route.operatorId,
          operatingDate: d,
          status: tripStatus(shifted, anchorAt),
          legs: shifted as never,
          generatedAt,
        };
      }),
    });
    invalidate("stats:", "fatigue:");
    return {
      route_id: id,
      effective_from: body.effective_from,
      trips_removed: deleted.count,
      trips_created: dates.length,
    };
  });

  // ── Crew assignment write (require route_manager role) ─────────────────
  app.post("/api/crew-assignments", async (request, reply) => {
    requireRole(request.user!, "route_manager");
    const body = request.body as { trip_id: string; staff_id: string };
    const [trip, staff] = await Promise.all([
      prisma.trip.findUnique({ where: { tripId: body.trip_id } }),
      prisma.staff.findUnique({ where: { staffId: body.staff_id } }),
    ]);
    if (!trip || !staff) {
      reply.code(404);
      return { error: "trip or staff not found" };
    }
    if (staff.roleClass !== "flight_crew") {
      reply.code(409);
      return { error: `staff ${staff.staffId} is ${staff.roleClass}, not flight_crew` };
    }
    if (staff.operatorId !== trip.operatorId) {
      reply.code(409);
      return { error: "staff operator does not match trip operator" };
    }
    if (trip.status === "cancelled") {
      reply.code(409);
      return { error: "cannot crew a cancelled trip" };
    }
    const existing = await prisma.crewAssignment.findUnique({
      where: { tripId_staffId: { tripId: body.trip_id, staffId: body.staff_id } },
    });
    if (existing) {
      reply.code(409);
      return { error: "staff is already assigned to this trip", assignment_id: existing.assignmentId };
    }

    // Fatigue gate: recompute the candidate's duty with this trip added.
    const current = await prisma.$queryRaw<
      { duty_hours_7d: string; consecutive_duty_days: number; rest_since_last_hours: string | null }[]
    >`SELECT duty_hours_7d, consecutive_duty_days, rest_since_last_hours
      FROM crew_fatigue_v WHERE staff_id = ${body.staff_id}`;
    const row = current[0];
    const projected = {
      dutyHours7d:
        Number(row?.duty_hours_7d ?? 0) + tripDutyHours(trip.legs as unknown as RouteLeg[]),
      consecutiveDutyDays: row?.consecutive_duty_days ?? 0,
      restSinceLastHours: row?.rest_since_last_hours === null || row?.rest_since_last_hours === undefined
        ? null
        : Number(row.rest_since_last_hours),
    };
    if (fatigueLevel(projected) === "critical") {
      reply.code(409);
      return {
        error: "assignment would put the crew member at critical fatigue",
        projected_duty_hours_7d: Number(projected.dutyHours7d.toFixed(2)),
      };
    }

    const created = await prisma.crewAssignment.create({
      data: {
        assignmentId: `crg-api-${body.trip_id}-${body.staff_id}`,
        tripId: body.trip_id,
        staffId: body.staff_id,
        crewRole: staff.role,
        generatedAt: new Date(new Date().toISOString().slice(0, 10)),
      },
    });
    invalidate("fatigue:", "stats:crew");
    reply.code(201);
    return created;
  });

  // ── Passengers ──────────────────────────────────────────────────────────
  app.get("/api/passengers", async (request) => {
    const query = request.query as { state?: string; operatorId?: string };
    return prisma.$queryRaw`
      SELECT * FROM passenger_state
      WHERE (${query.state ?? null}::text IS NULL OR state = ${query.state ?? null})
        AND (${query.operatorId ?? null}::text IS NULL OR operator_id = ${query.operatorId ?? null})
      ORDER BY passenger_id ASC
    `;
  });

  app.get("/api/passengers/:id", async (request) => {
    const { id } = request.params as { id: string };
    const rows = await prisma.$queryRaw`
      SELECT * FROM passenger_state WHERE passenger_id = ${id}
    `;
    return (rows as unknown[])[0] ?? null;
  });

  // ── Transit event history ───────────────────────────────────────────────
  app.get("/api/cargo/:id/events", async (request) => {
    const { id } = request.params as { id: string };
    return prisma.transitEvent.findMany({
      where: { cargoId: id },
      orderBy: { sequence: "asc" },
    });
  });

  app.get("/api/passengers/:id/events", async (request) => {
    const { id } = request.params as { id: string };
    return prisma.transitEvent.findMany({
      where: { passengerId: id },
      orderBy: { sequence: "asc" },
    });
  });

  // ── State machine lookup ────────────────────────────────────────────────
  app.get("/api/transit/transitions", async () => {
    return prisma.$queryRaw`
      SELECT * FROM transit_transition
      ORDER BY subject_type, from_state, event_type
    `;
  });
}