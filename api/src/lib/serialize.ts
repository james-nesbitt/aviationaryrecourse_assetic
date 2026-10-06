/**
 * Convert Prisma's camelCase keys to the snake_case wire format.
 *
 * The database columns, datagen JSONL, and raw SQL views all use snake_case.
 * Prisma maps those columns to camelCase model fields. Without this
 * conversion the API would emit two different shapes depending on whether a
 * route used the Prisma client or $queryRaw, and UI field access would break
 * for one of them.
 */

function toSnake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

export function snakeKeys<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => snakeKeys(item)) as T;
  }
  if (value instanceof Date) {
    return value as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[toSnake(k)] = snakeKeys(v);
    }
    return out as T;
  }
  return value;
}