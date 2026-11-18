import pg from "pg";
export async function cleanupWebFixture(account, device) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Delete only a fixture with our exact marker and its bound account. Never discover user data by name alone.
    const check = await client.query(
      "SELECT 1 FROM bot_devices WHERE id=$1 AND state->>'bound_account'=$2 AND state->'ui'->'snapshot'->>'title'='Campaign editor (test fixture)'",
      [device, account],
    );
    if (!check.rowCount)
      throw new Error("Fixture marker mismatch; refusing cleanup");
    for (const table of [
      "insight_import_history",
      "data_quality_reports",
      "import_files",
      "insights_breakdowns",
    ])
      await client.query(
        `DELETE FROM ${table} WHERE job_id IN (SELECT id FROM import_jobs WHERE account_id=$1)`,
        [account],
      );
    for (const table of [
      "insight_observations",
      "sync_checkpoints",
      "sync_errors",
      "ad_creatives",
      "ads",
      "ad_sets",
      "campaigns",
      "import_jobs",
    ])
      await client.query(`DELETE FROM ${table} WHERE account_id=$1`, [account]);
    await client.query("DELETE FROM ad_accounts WHERE id=$1", [account]);
    await client.query("DELETE FROM managed_accounts WHERE account_id=$1", [
      account,
    ]);
    await client.query("DELETE FROM bot_commands WHERE device_id=$1", [device]);
    await client.query("DELETE FROM bot_devices WHERE id=$1", [device]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}
