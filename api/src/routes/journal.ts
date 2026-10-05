import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";

/**
 * Journal append endpoint.
 * Appends a hash-chained entry to the append-only journal_entry table.
 * Uses raw SQL (not Prisma) because the journal has INSERT-only grants and
 * hash-chain computation that Prisma doesn't model.
 *
 * POST /api/journal
 * Body: {
 *   chain_key: string,       // e.g. "custody:cgo-0001"
 *   event_type: string,      // must match the CHECK constraint enum
 *   entity_type: string,
 *   entity_id: string,
 *   payload: object,
 *   valid_time: string (ISO),
 *   actor_id: string,
 *   agent_run_id?: string
 * }
 */

export async function registerJournalRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/journal", async (request, reply) => {
    const body = request.body as {
      chain_key: string;
      event_type: string;
      entity_type: string;
      entity_id: string;
      payload: Record<string, unknown>;
      valid_time: string;
      actor_id: string;
      agent_run_id?: string;
    };

    // Compute hash chain: find the last row in this chain
    const lastRow = (await prisma.$queryRaw`
      SELECT row_hash FROM journal_entry
      WHERE chain_key = ${body.chain_key}
      ORDER BY journal_id DESC
      LIMIT 1
    `) as { row_hash: string | null }[];

    const prevHash = lastRow[0]?.row_hash ?? "GENESIS";

    // Compute row_hash using the Postgres function assetic_journal_row_hash()
    // so the hash is over the stored representation (canonical JSONB key order,
    // Postgres timestamp text format), not the JS input. This ensures
    // insert and verification use the same canonicalization.
    const seqResult = (await prisma.$queryRaw`
      SELECT nextval('journal_entry_journal_id_seq') AS next_id
    `) as { next_id: bigint }[];

    const journalId = seqResult[0].next_id;
    const payloadJson = JSON.stringify(body.payload);

    const hashResult = (await prisma.$queryRaw`
      SELECT assetic_journal_row_hash(
        ${body.chain_key}, ${journalId}, ${prevHash},
        ${body.event_type}, ${body.entity_id},
        ${payloadJson}::jsonb, ${body.valid_time}::timestamptz
      ) AS row_hash
    `) as { row_hash: string }[];

    const rowHash = hashResult[0].row_hash;

    await prisma.$executeRaw`
      INSERT INTO journal_entry
        (journal_id, chain_key, event_type, entity_type, entity_id,
         actor_id, agent_run_id, payload, valid_time, transaction_time,
         prev_hash, row_hash, schema_version)
      VALUES
        (${journalId}, ${body.chain_key}, ${body.event_type},
         ${body.entity_type}, ${body.entity_id},
         ${body.actor_id}, ${body.agent_run_id ?? null},
         ${payloadJson}::jsonb, ${body.valid_time}::timestamptz,
         now(),
         ${prevHash}, ${rowHash}, 1)
    `;

    reply.code(201);
    return {
      journal_id: journalId.toString(),
      chain_key: body.chain_key,
      row_hash: rowHash,
      prev_hash: prevHash,
    };
  });

  // Read journal entries for an entity
  app.get("/api/journal/:entityType/:entityId", async (request) => {
    const { entityType, entityId } = request.params as {
      entityType: string;
      entityId: string;
    };
    const rows = await prisma.$queryRaw`
      SELECT journal_id, chain_key, event_type, entity_type, entity_id,
             actor_id, agent_run_id, payload, valid_time, transaction_time,
             prev_hash, row_hash, schema_version
      FROM journal_entry
      WHERE entity_type = ${entityType} AND entity_id = ${entityId}
      ORDER BY journal_id ASC
    `;
    return (rows as Array<{ journal_id: bigint }>).map((row) => ({
      ...row,
      journal_id: row.journal_id.toString(),
    }));
  });

  // Verify a chain's integrity
  app.get("/api/journal/verify/:chainKey", async (request) => {
    const { chainKey } = request.params as { chainKey: string };
    const rows = (await prisma.$queryRaw`
      SELECT journal_id, prev_hash, row_hash, chain_key, event_type, entity_id,
             payload, valid_time
      FROM journal_entry
      WHERE chain_key = ${chainKey}
      ORDER BY journal_id ASC
    `) as {
      journal_id: bigint;
      prev_hash: string;
      row_hash: string;
      chain_key: string;
      event_type: string;
      entity_id: string;
      payload: unknown;
      valid_time: Date;
    }[];

    let prevHash = "GENESIS";
    const verification = [];
    for (const row of rows) {
      const expectedHashResult = (await prisma.$queryRaw`
        SELECT assetic_journal_row_hash(
          ${row.chain_key}, ${row.journal_id}, ${prevHash},
          ${row.event_type}, ${row.entity_id},
          ${row.payload}::jsonb, ${row.valid_time}::timestamptz
        ) AS expected_hash
      `) as { expected_hash: string }[];
      const expectedHash = expectedHashResult[0].expected_hash;
      const valid = expectedHash === row.row_hash;
      const chainValid = row.prev_hash === prevHash;
      prevHash = row.row_hash;
      verification.push({ journal_id: row.journal_id.toString(), valid, chainValid });
    }

    return {
      chain_key: chainKey,
      entries: verification.length,
      all_valid: verification.every((v) => v.valid && v.chainValid),
      details: verification,
    };
  });
}