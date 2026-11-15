import { z } from "zod";
import { readFile } from "node:fs/promises";
import { botCommandSchema } from "../packages/core/src/control.js";
const [device, command, ...args] = process.argv.slice(2);
z.uuid().parse(device);
const token = process.env.API_TOKEN;
if (!token) throw new Error("API_TOKEN required");
let path = "commands";
let body: unknown;
switch (command) {
  case "prepare":
    body = { command: "report.prepare", goal: args[0] ?? "messages" };
    break;
  case "collect":
    body = {
      command: "start",
      levels: args.length ? args : ["ads"],
      maxSteps: 5,
      scan_columns: true,
    };
    break;
  case "start":
    body = {
      command,
      levels: args.length ? args : ["campaigns", "adsets", "ads"],
      maxSteps: 5,
    };
    break;
  case "pause":
  case "resume":
  case "status":
    body = { command };
    break;
  case "state":
    path = "state";
    break;
  case "result":
    path = `commands/${z.uuid().parse(args[0])}`;
    break;
  case "inspect":
    body = { command: "ui.action", action: { type: "inspect" } };
    break;
  case "focus":
    body = { command: "ui.focus" };
    break;
  case "screenshot":
    body = { command: "ui.screenshot" };
    break;
  case "navigate":
    body = { command: "ui.navigate", url: args[0] };
    break;
  case "send":
    body = JSON.parse(await readFile(args[0], "utf8"));
    break;
  default:
    throw new Error(
      "Usage: npm run bot -- DEVICE_UUID prepare|collect|start|pause|resume|status|state|inspect|focus|screenshot|navigate|send|result [args]",
    );
}
if (body) body = botCommandSchema.parse(body);
const response = await fetch(
  `http://127.0.0.1:4318/devices/${device}/${path}`,
  {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  },
);
const result = await response.json();
if (!response.ok) throw new Error(JSON.stringify(result));
console.log(JSON.stringify(result, null, 2));
