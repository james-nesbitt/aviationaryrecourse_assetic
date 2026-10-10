/**
 * Cursor-based pagination for list endpoints (spec: list-pagination, 1b).
 *
 * A cursor is an opaque base64url token encoding the last row's values for
 * the endpoint's orderBy keys. Pagination is keyset comparison, NOT
 * Prisma's native `cursor` (which requires a unique field — the orderBy
 * tuples here are compound and non-unique, e.g. operatingDate+routeId).
 *
 * The "after" filter is the standard keyset shape on the ordered keys:
 * for keys [a, b] and cursor row (va, vb):
 *   OR( a > va, AND( a = va, b > vb ) )
 * i.e. strictly after the cursor row on the tuple. Ascending-only (every
 * list orders ascending today); a descending key would flip its gt/lt —
 * supported when needed.
 */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export interface PageRequest {
  limit: number;
  /** Values of the last row's sort keys, decoded from the cursor. */
  after: Record<string, unknown> | null;
}

export interface PageResult<T> {
  rows: T[];
  /** Cursor to the next page; null when this page is the last. */
  next_cursor: string | null;
}

/** Parse `?after=&limit=` into a bounded page request. */
export function parsePage(query: Record<string, unknown>): PageRequest {
  const limitRaw = Number(query.limit ?? DEFAULT_LIMIT);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : DEFAULT_LIMIT, 1), MAX_LIMIT);
  let after: Record<string, unknown> | null = null;
  if (typeof query.after === "string" && query.after !== "") {
    try {
      const decoded = JSON.parse(Buffer.from(query.after, "base64url").toString("utf8"));
      if (decoded !== null && typeof decoded === "object") after = decoded as Record<string, unknown>;
    } catch {
      // Malformed cursors page from the start rather than erroring; a bad
      // token is a client bug, not a request worth a 400 round-trip.
      after = null;
    }
  }
  return { limit, after };
}

/** Encode the last row's sort-key values into the next-page cursor. */
export function encodeCursor(row: Record<string, unknown>, keys: readonly string[]): string {
  const payload: Record<string, unknown> = {};
  for (const key of keys) payload[key] = row[key] ?? null;
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function buildBranch(after: Record<string, unknown>, keys: readonly string[], depth: number): Record<string, unknown> {
  const key = keys[depth];
  const gt: Record<string, unknown> = { [key]: { gt: after[key] } };
  if (depth === keys.length - 1) return gt;
  return { OR: [gt, { AND: [{ [key]: after[key] }, buildBranch(after, keys, depth + 1)] }] };
}

/**
 * Keyset where-clause for rows strictly after the cursor row on the
 * ordered key tuple. Null/undefined cursor values in the token end the
 * branch at the keys actually present.
 */
export function keysetAfter(
  after: Record<string, unknown> | null,
  keys: readonly string[],
): Record<string, unknown> | undefined {
  if (after === null) return undefined;
  const present = keys.filter((k) => after[k] !== null && after[k] !== undefined);
  if (present.length === 0) return undefined;
  return buildBranch(after, present, 0);
}

/**
 * Page a findMany with keyset pagination: the caller's where gains the
 * after-filter (ANDed so filters and soft-delete still apply); take is
 * limit+1 to detect a next page; the cursor encodes the last row's
 * sort-key values. baseArgs.include passes through unchanged.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function paginate<T>(
  findMany: (args: any) => Promise<T[]>,
  baseArgs: { where?: unknown; orderBy: unknown[]; include?: unknown },
  page: PageRequest,
  keys: readonly string[],
): Promise<PageResult<T>> {
  const extra = keysetAfter(page.after, keys);
  const where = extra !== undefined ? { AND: [baseArgs.where ?? {}, extra] } : baseArgs.where;
  const rows = await findMany({
    ...(baseArgs.include !== undefined ? { include: baseArgs.include } : {}),
    where,
    orderBy: baseArgs.orderBy,
    take: page.limit + 1,
  });
  const hasMore = rows.length > page.limit;
  const pageRows = hasMore ? rows.slice(0, page.limit) : rows;
  const last = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && last !== undefined
    ? encodeCursor(last as unknown as Record<string, unknown>, keys)
    : null;
  return { rows: pageRows, next_cursor: nextCursor };
}