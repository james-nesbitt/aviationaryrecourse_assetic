import { describe, expect, it, vi } from "vitest";
import { encodeCursor, keysetAfter, paginate, parsePage } from "./pagination.js";

describe("parsePage", () => {
  it("defaults to 50, caps at 200, floors at 1", () => {
    expect(parsePage({}).limit).toBe(50);
    expect(parsePage({ limit: "500" }).limit).toBe(200);
    expect(parsePage({ limit: "0" }).limit).toBe(1);
    expect(parsePage({ limit: "abc" }).limit).toBe(50);
  });

  it("decodes a cursor and nulls a malformed one", () => {
    const cursor = encodeCursor({ operatingDate: "1999-02-15", routeId: "rte-0001" }, ["operatingDate", "routeId"]);
    expect(parsePage({ after: cursor }).after).toEqual({ operatingDate: "1999-02-15", routeId: "rte-0001" });
    expect(parsePage({ after: "not-a-cursor!!" }).after).toBeNull();
    expect(parsePage({}).after).toBeNull();
  });
});

describe("keysetAfter", () => {
  it("is absent on page one", () => {
    expect(keysetAfter(null, ["a"])).toBeUndefined();
  });

  it("single key: strictly greater", () => {
    expect(keysetAfter({ a: 5 }, ["a"])).toEqual({ a: { gt: 5 } });
  });

  it("two keys: greater on first OR equal-then-greater", () => {
    expect(keysetAfter({ a: 1, b: 2 }, ["a", "b"])).toEqual({
      OR: [
        { a: { gt: 1 } },
        { AND: [{ a: 1 }, { b: { gt: 2 } }] },
      ],
    });
  });

  it("stops the branch at keys absent from the cursor", () => {
    expect(keysetAfter({ a: 1 }, ["a", "b"])).toEqual({ a: { gt: 1 } });
  });
});

describe("paginate", () => {
  const rows = Array.from({ length: 120 }, (_, i) => ({ id: i }));

  it("returns limit rows and a cursor when more exist", async () => {
    const findMany = vi.fn(async (args: { where?: unknown; orderBy: unknown[]; take: number }) =>
      rows.slice(0, args.take));
    const page = await paginate(findMany, { orderBy: [{ id: "asc" }] }, parsePage({ limit: "50" }), ["id"]);
    expect(page.rows).toHaveLength(50);
    expect(page.next_cursor).toBe(encodeCursor({ id: 49 }, ["id"]));
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 51 }));
  });

  it("returns no cursor on the last page", async () => {
    const findMany = vi.fn(async (args: { take: number }) => rows.slice(0, args.take));
    const last = await paginate(findMany, { orderBy: [{ id: "asc" }] }, parsePage({ limit: "120" }), ["id"]);
    expect(last.rows).toHaveLength(120);
    expect(last.next_cursor).toBeNull();
  });

  it("ANDs the keyset filter with the caller's where", async () => {
    const findMany = vi.fn(async (args: { where?: unknown; take: number }) => rows.slice(0, args.take));
    const after = encodeCursor({ id: 10 }, ["id"]);
    await paginate(findMany, { where: { status: "completed" }, orderBy: [{ id: "asc" }] }, parsePage({ after }), ["id"]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { AND: [{ status: "completed" }, { id: { gt: 10 } }] },
    }));
  });

  it("passes include through untouched", async () => {
    const findMany = vi.fn(async (args: { take: number; include?: unknown }) => {
      expect(args.include).toEqual({ operator: true });
      return rows.slice(0, args.take);
    });
    await paginate(findMany, { orderBy: [{ id: "asc" }], include: { operator: true } }, parsePage({}), ["id"]);
  });
});