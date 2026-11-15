import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const base = "http://127.0.0.1:4318";
const token = process.env.API_TOKEN!;
async function req(path: string, body?: unknown) {
  return fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
const csv = await readFile("samples/meta-report.csv", "utf8");
const account = String(Date.now());
const payload = {
  filename: "integration.csv",
  csv: csv.replaceAll("123456789", account),
  expected_account_id: account,
  context: {
    timezone: "Asia/Bangkok",
    attribution: "7-day click",
    result_type: "leads",
  },
  expected: { rows: 2, spend: 200 },
};
assert.equal((await fetch(base + "/export?account_id=" + account)).status, 401);
assert.equal((await req("/health")).status, 200);
const first = await req("/imports", payload);
assert.equal(first.status, 201);
const job = await first.json();
const second = await req("/imports", payload);
assert.equal(second.status, 200);
assert.equal((await second.json()).job_id, job.job_id);
assert.equal(
  (await req("/imports", { ...payload, expected: { spend: 201 } })).status,
  422,
);
let exported = await (await req("/export?account_id=" + account)).json();
assert.equal(exported.records.length, 2);
const update = {
  ...payload,
  filename: "updated.csv",
  csv: payload.csv.replace("150.50", "160.50"),
  expected: { rows: 2, spend: 210 },
};
assert.equal((await req("/imports", update)).status, 201);
exported = await (await req("/export?account_id=" + account)).json();
assert.equal(exported.records.length, 2);
assert.equal(
  exported.records.reduce((n: number, r: { spend: number }) => n + r.spend, 0),
  210,
);
const conflict = {
  ...payload,
  filename: "conflict.csv",
  csv: payload.csv.replaceAll(",111,Sample campaign", ",999,Sample campaign"),
};
assert.equal((await req("/imports", conflict)).status, 409);
exported = await (await req("/export?account_id=" + account)).json();
assert.equal(
  exported.records.reduce((n: number, r: { spend: number }) => n + r.spend, 0),
  210,
);
const device = randomUUID();
const command = await (
  await req(`/devices/${device}/commands`, {
    command: "start",
    levels: ["campaigns"],
    maxSteps: 1,
  })
).json();
assert.equal(
  (
    await req(`/devices/${device}/commands`, {
      command: "click",
      selector: "button",
    })
  ).status,
  400,
);
assert.equal(
  (await (await req(`/devices/${device}/commands/next`)).json()).id,
  command.id,
);
await req(`/devices/${device}/commands/${command.id}/result`, { ok: true });
assert.equal(
  (await (await req(`/devices/${device}/commands/${command.id}`)).json())
    .status,
  "done",
);
assert.equal(
  await (await req(`/devices/${device}/commands/next`)).json(),
  null,
);
console.log(
  "API integration passed: auth, validate, atomic upsert, duplicate import, rollback, export, bot queue",
);

const detail = await (
  await req(`/devices/${device}/commands/${command.id}`)
).json();
assert.equal(detail.command.command, "start");
