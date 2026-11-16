import pg from "pg";
import { readFile } from "node:fs/promises";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(4318001)");
  await client.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  for (const name of [
    "001_initial",
    "002_bot_control",
    "003_dom_captures",
  ]) {
    const { rowCount } = await client.query(
      "SELECT 1 FROM schema_migrations WHERE name=$1",
      [name],
    );
    if (!rowCount) {
      await client.query(await readFile(`db/${name}.sql`, "utf8"));
      await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [
        name,
      ]);
    }
  }
  await client.query("COMMIT");
  console.log("Database migrated");
} catch (e) {
  await client.query("ROLLBACK");
  throw e;
} finally {
  client.release();
  await pool.end();
}
