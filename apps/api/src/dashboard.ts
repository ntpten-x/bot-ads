import { Router } from "express";
import { z } from "zod";
import type { Pool } from "pg";
export function dashboardRoutes(pool: Pool) {
  const router = Router();
  router.get("/dashboard", async (req, res) => {
    const auth =
      ((req as any).auth as {
        kind?: string;
        id?: string | null;
        customer_id?: string | null;
        all_accounts?: boolean;
      } | null) ?? {};
    const customerId = auth.customer_id ?? null;
    const allAccounts = auth.kind === "local-admin" || auth.all_accounts === true;
    const [accounts, devices] = await Promise.all([
      pool.query(
        !customerId
          ? "SELECT id FROM ad_accounts UNION SELECT account_id AS id FROM managed_accounts UNION SELECT state->>'bound_account' AS id FROM bot_devices WHERE state->>'bound_account' IS NOT NULL ORDER BY id LIMIT 200"
          : allAccounts
          ? "SELECT account_id AS id FROM managed_accounts WHERE customer_id=$1 ORDER BY account_id LIMIT 200"
          : `SELECT ma.account_id AS id
             FROM managed_accounts ma
             JOIN api_client_accounts access
               ON access.account_id=ma.account_id AND access.client_id=$2
             WHERE ma.customer_id=$1 ORDER BY ma.account_id LIMIT 200`,
        !customerId ? [] : allAccounts ? [customerId] : [customerId, auth.id],
      ),
      pool.query(
        !customerId
          ? "SELECT id,updated_at,state->>'bound_account' AS account_id,state->>'enabled' AS enabled,state->'job'->>'status' AS job_status FROM bot_devices ORDER BY updated_at DESC LIMIT 100"
          : allAccounts
          ? `SELECT id,updated_at,state->>'bound_account' AS account_id,
                    state->>'enabled' AS enabled,
                    state->'job'->>'status' AS job_status
             FROM bot_devices
             WHERE state->>'bound_account' IN (
               SELECT account_id FROM managed_accounts WHERE customer_id=$1
             )
             ORDER BY updated_at DESC LIMIT 100`
          : `SELECT id,updated_at,state->>'bound_account' AS account_id,
                    state->>'enabled' AS enabled,
                    state->'job'->>'status' AS job_status
             FROM bot_devices
             WHERE state->>'bound_account' IN (
               SELECT access.account_id
               FROM api_client_accounts access
               JOIN managed_accounts ma ON ma.account_id=access.account_id
               WHERE access.client_id=$2 AND ma.customer_id=$1
             )
             ORDER BY updated_at DESC LIMIT 100`,
        !customerId ? [] : allAccounts ? [customerId] : [customerId, auth.id],
      ),
    ]);
    res.json({
      accounts: accounts.rows.map((r) => r.id),
      devices: devices.rows,
      server_time: new Date().toISOString(),
    });
  });
  router.get("/accounts/:account/summary", async (req, res) => {
    const account = z.string().regex(/^\d+$/).parse(req.params.account);
    const r = await pool.query(
      `SELECT
 (SELECT count(*) FROM campaigns WHERE account_id=$1)::int AS campaigns,
 (SELECT count(*) FROM ad_sets WHERE account_id=$1)::int AS ad_sets,
 (SELECT count(*) FROM ads WHERE account_id=$1)::int AS ads,
 (SELECT count(*) FROM insight_observations WHERE account_id=$1)::int AS observations,
 (SELECT count(*) FROM import_jobs WHERE account_id=$1)::int AS imports,
 (SELECT max(created_at) FROM import_jobs WHERE account_id=$1) AS last_import`,
      [account],
    );
    res.json({ ...r.rows[0], coverage: "unverified" });
  });
  router.get("/devices/:device/commands", async (req, res) => {
    const device = z.uuid().parse(req.params.device);
    const result = await pool.query(
      `SELECT id,status,command #- '{action,base64}' AS command,created_at,completed_at,result->>'error' AS error,result->'ui'->>'outcome' AS outcome,result->'ui'->>'approval_id' AS approval_id FROM bot_commands WHERE device_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100`,
      [device],
    );
    res.json(result.rows);
  });
  return router;
}
