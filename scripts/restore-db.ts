import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const file = process.argv[2];
if (!file) throw new Error("Usage: npm run db:restore -- path/to/backup.dump");
if (process.env.DB_RESTORE_CONFIRM !== "restore-local-database")
  throw new Error(
    "Set DB_RESTORE_CONFIRM=restore-local-database to confirm this destructive local restore",
  );
const input = createReadStream(resolve(file));
const child = spawn(
  "docker",
  [
    "compose",
    "exec",
    "-T",
    "postgres",
    "sh",
    "-lc",
    'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner',
  ],
  { stdio: ["pipe", "inherit", "inherit"] },
);
input.pipe(child.stdin);
const code = await new Promise<number | null>((resolveCode) =>
  child.on("close", resolveCode),
);
if (code !== 0) throw new Error(`pg_restore failed with exit code ${code}`);
console.log(`Database restored from ${resolve(file)}`);
