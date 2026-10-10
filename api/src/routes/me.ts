import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { cached, TTL } from "../lib/statsCache.js";

/**
 * Identity and self-service endpoints.
 *
 * The caller's Keycloak `preferred_username` is matched against
 * staff.keycloak_username (added in migration 006). Users without a staff
 * record — platform admins, service accounts — still get their identity and
 * roles back, with `staff: null`.
 */

async function staffForRequest(username: string) {
  return prisma.staff.findUnique({
    where: { keycloakUsername: username },
    include: { operator: true },
  });
}

export async function registerIdentityRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/me", async (request) => {
    const user = request.user!;
    const staff = await staffForRequest(user.username);
    return {
      username: user.username,
      email: user.email ?? null,
      roles: user.roles,
      staff,
    };
  });

  app.get("/api/my/assignments", async (request, reply) => {
    const user = request.user!;
    const staff = await staffForRequest(user.username);
    if (!staff) {
      reply.code(404);
      return { error: `no staff record linked to ${user.username}` };
    }
    const query = request.query as { from?: string; to?: string };
    const from = query.from ? new Date(`${query.from}T00:00:00Z`) : null;
    const to = query.to ? new Date(`${query.to}T00:00:00Z`) : null;
    return prisma.$queryRaw`
      SELECT ca.assignment_id, ca.crew_role,
             t.trip_id, t.route_id, t.operating_date, t.status,
             t.vehicle_id, t.operator_id, t.legs
      FROM crew_assignment ca
      JOIN trip t ON t.trip_id = ca.trip_id
      WHERE ca.staff_id = ${staff.staffId}
        AND (${from}::date IS NULL OR t.operating_date >= ${from}::date)
        AND (${to}::date IS NULL OR t.operating_date <= ${to}::date)
      ORDER BY t.operating_date ASC
    `;
  });

  app.get("/api/my/fatigue", async (request, reply) => {
    const user = request.user!;
    const staff = await staffForRequest(user.username);
    if (!staff) {
      reply.code(404);
      return { error: `no staff record linked to ${user.username}` };
    }
    const { value, hit } = await cached(
      `fatigue:staff:${staff.staffId}`,
      async () => {
        const rows = await prisma.$queryRaw`
          SELECT * FROM crew_fatigue_v WHERE staff_id = ${staff.staffId}
        `;
        return (rows as unknown[])[0] ?? null;
      },
      TTL.fatigue,
    );
    reply.header("X-Cache", hit ? "hit" : "miss");
    reply.header("Cache-Control", `private, max-age=${TTL.fatigue}`);
    return value;
  });

  app.get("/api/my/next", async (request, reply) => {
    const user = request.user!;
    const staff = await staffForRequest(user.username);
    if (!staff) {
      reply.code(404);
      return { error: `no staff record linked to ${user.username}` };
    }
    const rows = await prisma.$queryRaw`
      SELECT ca.crew_role, t.trip_id, t.route_id, t.operating_date,
             t.status, t.vehicle_id, t.legs
      FROM crew_assignment ca
      JOIN trip t ON t.trip_id = ca.trip_id
      WHERE ca.staff_id = ${staff.staffId}
        AND t.status IN ('scheduled', 'in_progress')
      ORDER BY t.operating_date ASC
      LIMIT 1
    `;
    return (rows as unknown[])[0] ?? null;
  });
}
