// Smoke test: journal hash chain insert + verify
// Uses the Postgres assetic_journal_row_hash() function for both insert and verify
// so the hash is computed over the stored representation (canonical JSONB, Postgres timestamp text).
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  // Clean up any previous test entries
  await prisma.$executeRawUnsafe("DELETE FROM journal_entry WHERE chain_key LIKE 'test:%'");
  await prisma.$executeRawUnsafe("SELECT setval('journal_entry_journal_id_seq', 1, false)");

  const chainKey = "test:cgo-0001";
  const validTime = "2000-02-12T10:00:00Z";

  // Entry 1 — genesis
  const seq1 = (await prisma.$queryRawUnsafe(
    "SELECT nextval('journal_entry_journal_id_seq') AS next_id"
  )) as { next_id: bigint }[];
  const id1 = seq1[0].next_id;
  const prevHash1 = "GENESIS";
  const payload1 = { action: "accepted", by: "loader" };
  const payloadJson1 = JSON.stringify(payload1);

  const hash1Result = (await prisma.$queryRawUnsafe(
    `SELECT assetic_journal_row_hash($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz) AS h`,
    chainKey, id1, prevHash1, "custody.accepted", "cgo-0001", payloadJson1, validTime
  )) as { h: string }[];
  const hash1 = hash1Result[0].h;

  await prisma.$executeRawUnsafe(
    `INSERT INTO journal_entry
       (journal_id, chain_key, event_type, entity_type, entity_id,
        actor_id, payload, valid_time, transaction_time, prev_hash, row_hash, schema_version)
     VALUES ($1, $2, 'custody.accepted', 'cargo', 'cgo-0001',
             'sta-0001', $3::jsonb, $4::timestamptz, now(), $5, $6, 1)`,
    id1, chainKey, payloadJson1, validTime, prevHash1, hash1
  );
  console.log(`  entry ${id1}: hash=${hash1.substring(0, 16)}...`);

  // Entry 2 — chained to entry 1
  const seq2 = (await prisma.$queryRawUnsafe(
    "SELECT nextval('journal_entry_journal_id_seq') AS next_id"
  )) as { next_id: bigint }[];
  const id2 = seq2[0].next_id;
  const prevHash2 = hash1;
  const payload2 = { action: "transferred", to: "sta-0002" };
  const payloadJson2 = JSON.stringify(payload2);

  const hash2Result = (await prisma.$queryRawUnsafe(
    `SELECT assetic_journal_row_hash($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz) AS h`,
    chainKey, id2, prevHash2, "custody.transferred", "cgo-0001", payloadJson2, validTime
  )) as { h: string }[];
  const hash2 = hash2Result[0].h;

  await prisma.$executeRawUnsafe(
    `INSERT INTO journal_entry
       (journal_id, chain_key, event_type, entity_type, entity_id,
        actor_id, payload, valid_time, transaction_time, prev_hash, row_hash, schema_version)
     VALUES ($1, $2, 'custody.transferred', 'cargo', 'cgo-0001',
             'sta-0002', $3::jsonb, $4::timestamptz, now(), $5, $6, 1)`,
    id2, chainKey, payloadJson2, validTime, prevHash2, hash2
  );
  console.log(`  entry ${id2}: hash=${hash2.substring(0, 16)}...`);

  // Verify the chain using the same function
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT journal_id, prev_hash, row_hash, chain_key, event_type, entity_id,
            payload, valid_time
     FROM journal_entry WHERE chain_key = $1 ORDER BY journal_id ASC`,
    chainKey
  )) as Array<{
    journal_id: bigint;
    prev_hash: string;
    row_hash: string;
    chain_key: string;
    event_type: string;
    entity_id: string;
    payload: { [key: string]: unknown };
    valid_time: Date;
  }>;

  let prevHash = "GENESIS";
  let allValid = true;
  for (const row of rows) {
    const expectedResult = (await prisma.$queryRawUnsafe(
      `SELECT assetic_journal_row_hash($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz) AS h`,
      row.chain_key, row.journal_id, prevHash, row.event_type, row.entity_id,
      JSON.stringify(row.payload), row.valid_time
    )) as { h: string }[];
    const expectedHash = expectedResult[0].h;
    const hashValid = expectedHash === row.row_hash;
    const chainValid = row.prev_hash === prevHash;
    if (!hashValid || !chainValid) allValid = false;
    console.log(`  verify entry ${row.journal_id}: hash_valid=${hashValid} chain_valid=${chainValid}`);
    prevHash = row.row_hash;
  }

  console.log(`Chain valid: ${allValid}`);
  if (!allValid) process.exit(1);

  // Verify INSERT-only enforcement: try UPDATE as assetic_app
  console.log("Testing INSERT-only enforcement...");
  try {
    await prisma.$executeRawUnsafe("SET ROLE assetic_app");
    await prisma.$executeRawUnsafe(
      "UPDATE journal_entry SET row_hash = 'tampered' WHERE journal_id = $1",
      id1
    );
    console.log("ERROR: UPDATE succeeded — INSERT-only enforcement FAILED");
    process.exit(1);
  } catch (e) {
    console.log(`  UPDATE correctly denied: ${(e as Error).message.split("\n")[0]}`);
  } finally {
    await prisma.$executeRawUnsafe("RESET ROLE");
  }

  console.log("All journal smoke tests passed.");
}

await main();
await prisma.$disconnect();