import { build } from "esbuild";
import { mkdir, copyFile, rm } from "node:fs/promises";
await rm("dist/extension", { recursive: true, force: true });
await mkdir("dist/extension", { recursive: true });
await build({
  entryPoints: ["apps/extension/src/popup.ts"],
  bundle: true,
  outfile: "dist/extension/popup.js",
  target: "chrome120",
});
await build({
  entryPoints: ["apps/extension/src/background.ts"],
  bundle: true,
  outfile: "dist/extension/background.js",
  target: "chrome120",
});
for (const file of ["manifest.json", "popup.html", "styles.css"])
  await copyFile(`apps/extension/${file}`, `dist/extension/${file}`);
await build({
  entryPoints: ["apps/api/src/server.ts"],
  bundle: true,
  platform: "node",
  packages: "external",
  format: "esm",
  outfile: "dist/api/server.js",
});
console.log("Built extension and API");
