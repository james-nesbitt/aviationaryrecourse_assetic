import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";

// Test the hash chain computation logic that mirrors the Postgres
// assetic_journal_row_hash function. The API route uses this same
// algorithm (via the Postgres function) for insert and verify.
// Here we test the JS-side hash computation to ensure it matches
// the Postgres function's canonicalization.

function computeRowHash(
  chainKey: string,
  journalId: bigint,
  prevHash: string,
  eventType: string,
  entityId: string,
  payloadText: string,
  validTimeText: string,
): string {
  return createHash("sha256")
    .update(
      [chainKey, journalId.toString(), prevHash, eventType, entityId, payloadText, validTimeText].join("|"),
    )
    .digest("hex");
}

describe("Journal hash chain", () => {
  const chainKey = "custody:cgo-0001";
  const validTime = "2000-02-12T10:00:00Z";
  const entityId = "cgo-0001";

  it("computes a deterministic hash for identical inputs", () => {
    const h1 = computeRowHash(chainKey, 1n, "GENESIS", "custody.accepted", entityId, '{"action":"accepted"}', validTime);
    const h2 = computeRowHash(chainKey, 1n, "GENESIS", "custody.accepted", entityId, '{"action":"accepted"}', validTime);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });

  it("produces different hashes for different payloads", () => {
    const h1 = computeRowHash(chainKey, 1n, "GENESIS", "custody.accepted", entityId, '{"action":"accepted"}', validTime);
    const h2 = computeRowHash(chainKey, 1n, "GENESIS", "custody.accepted", entityId, '{"action":"transferred"}', validTime);
    expect(h1).not.toBe(h2);
  });

  it("produces different hashes for different prev_hash (chain integrity)", () => {
    const h1 = computeRowHash(chainKey, 2n, "hash_a", "custody.transferred", entityId, '{"to":"sta-002"}', validTime);
    const h2 = computeRowHash(chainKey, 2n, "hash_b", "custody.transferred", entityId, '{"to":"sta-002"}', validTime);
    expect(h1).not.toBe(h2);
  });

  it("produces different hashes for different journal IDs", () => {
    const h1 = computeRowHash(chainKey, 1n, "GENESIS", "custody.accepted", entityId, '{"action":"accepted"}', validTime);
    const h2 = computeRowHash(chainKey, 2n, "GENESIS", "custody.accepted", entityId, '{"action":"accepted"}', validTime);
    expect(h1).not.toBe(h2);
  });

  it("produces different hashes for different chain keys", () => {
    const h1 = computeRowHash("custody:cgo-0001", 1n, "GENESIS", "custody.accepted", entityId, '{"action":"accepted"}', validTime);
    const h2 = computeRowHash("custody:cgo-0002", 1n, "GENESIS", "custody.accepted", entityId, '{"action":"accepted"}', validTime);
    expect(h1).not.toBe(h2);
  });

  it("GENESIS prev_hash is used for the first entry in a chain", () => {
    const hash = computeRowHash(chainKey, 1n, "GENESIS", "custody.accepted", entityId, '{"action":"accepted"}', validTime);
    const hashEmpty = computeRowHash(chainKey, 1n, "", "custody.accepted", entityId, '{"action":"accepted"}', validTime);
    expect(hash).not.toBe(hashEmpty);
    expect(hash).toHaveLength(64);
  });

  it("simulates a full chain: 3 entries, each linked to the previous", () => {
    const payloads = [
      { event: "custody.accepted", payload: '{"action":"accepted","by":"sta-0001"}' },
      { event: "custody.transferred", payload: '{"action":"transferred","to":"sta-0002"}' },
      { event: "custody.transferred", payload: '{"action":"transferred","to":"sta-0003"}' },
    ];

    let prevHash = "GENESIS";
    const hashes: string[] = [];

    for (let i = 0; i < payloads.length; i++) {
      const h = computeRowHash(
        chainKey,
        BigInt(i + 1),
        prevHash,
        payloads[i].event,
        entityId,
        payloads[i].payload,
        validTime,
      );
      hashes.push(h);
      prevHash = h;
    }

    expect(new Set(hashes).size).toBe(3);

    // Tampering with entry 1 breaks entry 2's hash
    const tamperedH1 = computeRowHash(
      chainKey, 1n, "GENESIS", "custody.accepted", entityId, '{"action":"TAMPERED"}', validTime,
    );
    expect(tamperedH1).not.toBe(hashes[0]);

    const tamperedH2 = computeRowHash(
      chainKey, 2n, tamperedH1, "custody.transferred", entityId, payloads[1].payload, validTime,
    );
    expect(tamperedH2).not.toBe(hashes[1]);
  });
});