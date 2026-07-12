import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "_site");
const entries = [
  "index.html",
  "styles.css",
  ".nojekyll",
  "assets",
  "src",
  "evolution",
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const entry of entries) {
  await cp(resolve(root, entry), resolve(output, entry), { recursive: true });
}

console.log(`Built ${entries.length} static entries in _site/.`);
