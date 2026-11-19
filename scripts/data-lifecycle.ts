import pg from "pg";
import { runDataLifecycle } from "../apps/api/src/data-lifecycle.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const accountId = process.env.DATA_LIFECYCLE_ACCOUNT || undefined;
if (accountId && !/^\d+$/.test(accountId))
  throw new Error("DATA_LIFECYCLE_ACCOUNT must be numeric");
const apply =
  process.env.DATA_LIFECYCLE_APPLY === "apply-data-lifecycle";
const pool = new pg.Pool({ connectionString });
try {
  const result = await runDataLifecycle(pool, { apply, accountId });
  console.log(JSON.stringify(result, null, 2));
  if (!apply)
    console.error(
      "Dry run only. Set DATA_LIFECYCLE_APPLY=apply-data-lifecycle to apply the reviewed policy.",
    );
} finally {
  await pool.end();
}
