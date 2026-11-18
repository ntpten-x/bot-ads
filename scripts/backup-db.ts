import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";

const directory = resolve("backups");
await mkdir(directory, { recursive: true });
const stamp = new Date().toISOString().replaceAll(":", "-");
const output = resolve(directory, `meta-collector-${stamp}.dump`);

const child = spawn(
  "docker",
  [
    "compose",
    "exec",
    "-T",
    "postgres",
    "sh",
    "-lc",
    'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner',
  ],
  { stdio: ["ignore", "pipe", "inherit"] },
);
const stream = createWriteStream(output, { flags: "wx" });
const [code] = await Promise.all([
  new Promise<number | null>((resolveCode) => child.on("close", resolveCode)),
  pipeline(child.stdout, stream),
]);
if (code !== 0) throw new Error(`pg_dump failed with exit code ${code}`);
const info = await stat(output);
if (info.size < 1024) throw new Error("Database backup is unexpectedly small");
console.log(`Database backup created: ${output} (${info.size} bytes)`);
