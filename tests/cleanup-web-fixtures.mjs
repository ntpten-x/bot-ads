import pg from "pg";
import { cleanupWebFixture } from "./helpers/web-fixture.mjs";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const r = await pool.query(
  "SELECT id,state->>'bound_account' AS account FROM bot_devices WHERE state->'ui'->'snapshot'->>'title'='Campaign editor (test fixture)'",
);
await pool.end();
for (const row of r.rows) await cleanupWebFixture(row.account, row.id);
console.log(`Removed ${r.rows.length} frontend test fixtures`);
