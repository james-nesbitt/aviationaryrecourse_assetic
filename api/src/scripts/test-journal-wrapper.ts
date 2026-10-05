// Wrapper for test-journal — sets DATABASE_URL from PG env vars
export {};

const user = process.env.PGUSER ?? "postgres";
const host = process.env.PGHOST ?? "localhost";
const port = process.env.PGPORT ?? "5432";
const db = process.env.PGDATABASE ?? "assetic";
process.env.DATABASE_URL = `postgresql://**REDACTED**@${host}:${port}/${db}`;

await import("./test-journal.js");