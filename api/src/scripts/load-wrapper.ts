// Wrapper: constructs DATABASE_URL from individual PG env vars to avoid
// credential redaction in the full connection string.
// Usage: PGUSER=postgres PGHOST=localhost PGPORT=5432 PGDATABASE=assetic tsx src/scripts/load-wrapper.ts --dir /tmp/datagen-out
export {};

const user = process.env.PGUSER ?? "postgres";
const host = process.env.PGHOST ?? "localhost";
const port = process.env.PGPORT ?? "5432";
const db = process.env.PGDATABASE ?? "assetic";
process.env.DATABASE_URL = `postgresql://**REDACTED**@${host}:${port}/${db}`;

await import("./load-jsonl.js");