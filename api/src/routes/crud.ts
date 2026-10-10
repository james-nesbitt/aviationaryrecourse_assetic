import type { FastifyInstance, FastifyReply } from "fastify";
import { prisma } from "../lib/prisma.js";
import { requireRole } from "../lib/auth.js";
import { ADMIN_ROLE, canWrite, writeRoleFor, type EntityKey, type Operation } from "../lib/permissions.js";
import { pickFields, missingFields } from "../lib/pickFields.js";
import { datasetAnchor } from "./domain.js";
import { snakeKeys } from "../lib/serialize.js";

/**
 * Generic entity CRUD, driven by one spec per entity. Each spec names the
 * Prisma delegate, the natural key, and the wire-format field allowlist per
 * operation — the same contract the UI registry declares. Permission comes
 * from the domain-role model in lib/permissions.ts; sysadmin overrides.
 *
 * Deletes are soft: deleted_at is stamped and reads filter it, so the audit
 * journal stays the source of truth and FK chains stay intact.
 */

interface EntitySpec {
  /** Registry key == wire path segment. */
  key: EntityKey;
  /** Prisma model delegate name (camelCase). */
  model: keyof typeof prisma;
  /** The snake_case natural-key body field. */
  idField: string;
  /** camelCase Prisma name of the natural key. */
  idPrisma: string;
  /** Fields a create accepts, snake_case. */
  createFields: readonly string[];
  /** Fields a create requires, snake_case. */
  createRequired: readonly string[];
  /** Fields a patch accepts, snake_case (never includes the key). */
  updateFields: readonly string[];
  /** Server-side defaults for create: values the caller never supplies. */
  createDefaults?: (body: Record<string, unknown>, anchorDate: Date) => Record<string, unknown>;
  /** Domain validation beyond field presence; returns the error message or null. */
  validateCreate?: (body: Record<string, unknown>) => string | null;
  /** Optional: hook after create/update/delete, e.g. trip materialisation. */
  afterCreate?: (id: string) => Promise<unknown>;
}

const SPECS: EntitySpec[] = [
  {
    key: "operators", model: "operator", idField: "operator_id", idPrisma: "operatorId",
    createFields: ["operator_id", "name", "type", "country", "hub_iata", "founded_year", "fleet_size_hint"],
    createRequired: ["operator_id", "name", "type", "country", "hub_iata"],
    updateFields: ["name", "type", "country", "hub_iata", "founded_year", "fleet_size_hint"],
    createDefaults: (body) => ({ fleetSizeHint: body.fleet_size_hint ?? 0 }),
  },
  {
    key: "vehicles", model: "vehicle", idField: "vehicle_id", idPrisma: "vehicleId",
    createFields: ["vehicle_id", "operator_id", "model_id", "kind", "registration", "status", "base_iata", "home_iata"],
    createRequired: ["vehicle_id", "operator_id", "kind"],
    updateFields: ["registration", "status", "base_iata", "home_iata", "model_id"],
  },
  {
    key: "vehicle-maintenance", model: "vehicleMaintenance", idField: "maintenance_id", idPrisma: "maintenanceId",
    createFields: ["maintenance_id", "vehicle_id", "facility_id", "maintenance_type", "start_date", "end_date"],
    createRequired: ["maintenance_id", "vehicle_id", "maintenance_type", "start_date", "end_date"],
    updateFields: ["facility_id", "maintenance_type", "start_date", "end_date"],
    createDefaults: (_body, anchorDate) => ({ status: "scheduled" }),
  },
  {
    key: "staff", model: "staff", idField: "staff_id", idPrisma: "staffId",
    createFields: ["staff_id", "given_name", "family_name", "role_class", "role", "operator_id", "base_iata", "date_of_birth", "hire_date", "certifications", "keycloak_username"],
    createRequired: ["staff_id", "given_name", "family_name", "role_class", "role", "operator_id", "base_iata", "date_of_birth", "hire_date"],
    updateFields: ["given_name", "family_name", "role", "base_iata", "certifications", "keycloak_username"],
    createDefaults: (body) => ({ certifications: body.certifications ?? [] }),
  },
  {
    key: "customers", model: "carrierCustomer", idField: "customer_id", idPrisma: "customerId",
    createFields: ["customer_id", "customer_type", "company_name", "contact_name", "email", "operator_id", "account_manager_id", "contract_start", "contract_end", "monthly_volume_kg"],
    createRequired: ["customer_id", "customer_type", "company_name", "operator_id", "contract_start"],
    updateFields: ["contact_name", "email", "account_manager_id", "contract_end", "monthly_volume_kg"],
    // DB CHECK: cargo_shipper requires monthly_volume_kg; charter forbids it.
    // Expressed here so callers get a 400 naming the field, not a raw P2002.
    validateCreate: (body) => {
      const type = body.customer_type;
      const vol = body.monthly_volume_kg;
      if (type === "cargo_shipper" && (vol === undefined || vol === null)) return "monthly_volume_kg is required for cargo_shipper customers";
      if (type === "charter" && vol !== undefined && vol !== null) return "monthly_volume_kg must be null for charter customers";
      return null;
    },
  },
  {
    key: "aircraft-models", model: "aircraftModel", idField: "model_id", idPrisma: "modelId",
    createFields: ["model_id", "manufacturer", "family", "icao_type", "name", "pax_capacity_typical", "cargo_capacity_kg", "range_km", "engine_count", "category"],
    createRequired: ["model_id", "manufacturer", "icao_type", "name", "category"],
    updateFields: ["name", "pax_capacity_typical", "cargo_capacity_kg", "range_km", "category"],
  },
  {
    key: "airports", model: "airport", idField: "iata", idPrisma: "iata",
    createFields: [],
    createRequired: [],
    updateFields: ["name", "city", "country", "timezone"],
  },
];

/** snake_case → Prisma camelCase for every field the CRUD surface touches. */
const CRUD_FIELD_MAP: Record<string, string> = {
  operator_id: "operatorId", name: "name", type: "type", country: "country",
  hub_iata: "hubIata", founded_year: "foundedYear", fleet_size_hint: "fleetSizeHint",
  vehicle_id: "vehicleId", model_id: "modelId", kind: "kind", registration: "registration",
  status: "status", base_iata: "baseIata", home_iata: "homeIata",
  maintenance_id: "maintenanceId", facility_id: "facilityId",
  maintenance_type: "maintenanceType", start_date: "startDate", end_date: "endDate",
  staff_id: "staffId", given_name: "givenName", family_name: "familyName",
  role_class: "roleClass", role: "role", date_of_birth: "dateOfBirth",
  hire_date: "hireDate", certifications: "certifications",
  keycloak_username: "keycloakUsername",
  customer_id: "customerId", customer_type: "customerType",
  company_name: "companyName", contact_name: "contactName", email: "email",
  account_manager_id: "accountManagerId", contract_start: "contractStart",
  contract_end: "contractEnd", monthly_volume_kg: "monthlyVolumeKg",
  manufacturer: "manufacturer", family: "family", icao_type: "icaoType",
  pax_capacity_typical: "paxCapacityTypical", cargo_capacity_kg: "cargoCapacityKg",
  range_km: "rangeKm", engine_count: "engineCount", category: "category",
  iata: "iata", city: "city", timezone: "timezone",
};

/** Body fields that are calendar dates on the wire (YYYY-MM-DD). */
const DATE_FIELDS = new Set([
  "date_of_birth", "hire_date", "contract_start", "contract_end",
  "start_date", "end_date", "ordered_on", "founded_year_is_not_a_date",
]);

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  const s = String(value);
  // YYYY-MM-DD (or with time) → ISO datetime Prisma accepts
  return new Date(s.length === 10 ? `${s}T00:00:00.000Z` : s);
}

function mappedPick(body: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of fields) {
    if (body[key] !== undefined) {
      const mapped = CRUD_FIELD_MAP[key] ?? key;
      out[mapped] = DATE_FIELDS.has(key) ? toDate(body[key]) : body[key];
    }
  }
  return out;
}

async function journalWrite(
  op: Operation, entity: EntityKey, entityId: string, actorId: string, payload: Record<string, unknown>,
): Promise<void> {
  const eventType = op === "create" ? "dispatch.created" : op === "update" ? "dispatch.updated" : "dispatch.deleted";
  const lastRow = (await prisma.$queryRaw`
    SELECT row_hash FROM journal_entry WHERE chain_key = ${`crud:${entity}:${entityId}`}
    ORDER BY journal_id DESC LIMIT 1
  `) as { row_hash: string | null }[];
  const prevHash = lastRow[0]?.row_hash ?? "GENESIS";
  const seq = (await prisma.$queryRaw`SELECT nextval('journal_entry_journal_id_seq') AS next_id`) as { next_id: bigint }[];
  const journalId = seq[0].next_id;
  const payloadText = JSON.stringify(snakeKeys(payload));
  const hash = (await prisma.$queryRaw`
    SELECT assetic_journal_row_hash(
      ${`crud:${entity}:${entityId}`}, ${journalId}, ${prevHash},
      ${eventType}, ${entityId}, ${payloadText}::jsonb, now()
    ) AS row_hash
  `) as { row_hash: string }[];
  await prisma.$executeRaw`
    INSERT INTO journal_entry
      (journal_id, chain_key, event_type, entity_type, entity_id,
       actor_id, agent_run_id, payload, valid_time, transaction_time,
       prev_hash, row_hash, schema_version)
    VALUES
      (${journalId}, ${`crud:${entity}:${entityId}`}, ${eventType}, ${entity}, ${entityId},
       ${actorId}, null, ${payloadText}::jsonb, now(), now(),
       ${prevHash}, ${hash[0].row_hash}, 1)
  `;
}

import type { AsseticUser } from "../lib/auth.js";

function guard(user: AsseticUser, entity: EntityKey, op: Operation, reply: FastifyReply): boolean {
  const role = writeRoleFor(entity, op);
  if (role === null) {
    reply.code(405).send({ error: "operation_not_offered" });
    return false;
  }
  if (!canWrite(user.roles, entity, op)) {
    // requireRole throws with the right status/message; call it for uniform errors
    requireRole(user, role === ADMIN_ROLE ? ADMIN_ROLE : role);
  }
  return true;
}

export async function registerCrudRoutes(app: FastifyInstance): Promise<void> {
  for (const spec of SPECS) {
    const delegate = prisma[spec.model] as unknown as {
      create: (args: { data: Record<string, unknown> }) => Promise<Record<string, unknown>>;
      update: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<Record<string, unknown>>;
      updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>;
      findUnique: (args: { where: Record<string, unknown> }) => Promise<Record<string, unknown> | null>;
    };

    if (spec.createFields.length > 0) {
      app.post(`/api/${spec.key}`, async (request, reply) => {
        const user = request.user!;
        if (!guard(user, spec.key, "create", reply)) return reply;
        const body = request.body as Record<string, unknown>;
        const missing = missingFields(body, spec.createRequired);
        if (missing.length > 0) {
          return reply.code(400).send({ error: "missing_fields", fields: missing });
        }
        const domainError = spec.validateCreate?.(body) ?? null;
        if (domainError !== null) {
          return reply.code(400).send({ error: "validation_failed", message: domainError });
        }
        const { anchorDate } = await datasetAnchor();
        const data = {
          ...mappedPick(body, spec.createFields),
          ...(spec.createDefaults?.(body, anchorDate) ?? {}),
          generatedAt: anchorDate,
        };
        let created: Record<string, unknown>;
        try {
          created = await delegate.create({ data });
        } catch (err) {
          const e = err as { code?: string };
          if (e.code === "P2002") {
            return reply.code(409).send({
              error: "key_exists",
              message: `A record (possibly soft-deleted) already exists with ${spec.idField} ${String(body[spec.idField])}.`,
            });
          }
          throw err;
        }
        await journalWrite("create", spec.key, String(body[spec.idField] ?? ""), user.sub, {
          created: Object.keys(mappedPick(body, spec.createFields)),
        });
        reply.code(201);
        return created;
      });
    }

    app.patch(`/api/${spec.key}/:id`, async (request, reply) => {
      const user = request.user!;
      if (!guard(user, spec.key, "update", reply)) return reply;
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, unknown>;
      const existing = await delegate.findUnique({ where: { [spec.idPrisma]: id } });
      if (!existing || existing.deletedAt !== null) {
        return reply.code(404).send({ error: "not_found" });
      }
      const data = mappedPick(body, spec.updateFields);
      if (Object.keys(data).length === 0) {
        return reply.code(400).send({ error: "no_mutable_fields" });
      }
      const updated = await delegate.update({ where: { [spec.idPrisma]: id }, data });
      await journalWrite("update", spec.key, id, user.sub, { fields: Object.keys(data) });
      return updated;
    });

    if (writeRoleFor(spec.key, "delete") !== null) {
      app.delete(`/api/${spec.key}/:id`, async (request, reply) => {
        const user = request.user!;
        if (!guard(user, spec.key, "delete", reply)) return reply;
        const { id } = request.params as { id: string };
        const result = await delegate.updateMany({
          where: { [spec.idPrisma]: id, deletedAt: null },
          data: { deletedAt: new Date() },
        });
        if (result.count === 0) {
          const existing = await delegate.findUnique({ where: { [spec.idPrisma]: id } });
          return reply.code(existing ? 409 : 404).send({
            error: existing ? "already_deleted" : "not_found",
          });
        }
        await journalWrite("delete", spec.key, id, user.sub, {});
        reply.code(204);
        return null;
      });
    }
  }
}