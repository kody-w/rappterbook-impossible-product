import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { manifestDirectory } from "./artifact-integrity.mjs";
import { resolveBuildIdentity } from "./provenance.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, process.env.SITE_OUTPUT_DIR ?? "_site");
const entries = [
  "index.html",
  "styles.css",
  ".nojekyll",
  "assets",
  "src",
  "evolution",
];

if (output === root || !output.startsWith(`${root}${sep}`)) {
  throw new Error("SITE_OUTPUT_DIR must stay inside the repository");
}

const identity = resolveBuildIdentity(root);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const entry of entries) {
  await cp(resolve(root, entry), resolve(output, entry), { recursive: true });
}

const content = await manifestDirectory(output, { exclude: ["provenance.json"] });
const provenance = {
  schemaVersion: 2,
  ...identity,
  buildTimestamp: process.env.BUILD_TIMESTAMP ?? new Date().toISOString(),
  contentDigest: {
    algorithm: "sha256",
    value: content.value,
    fileCount: content.fileCount,
    excludes: ["provenance.json"],
  },
  files: content.files,
};
await writeFile(
  resolve(output, "provenance.json"),
  `${JSON.stringify(provenance, null, 2)}\n`,
  "utf8",
);

console.log(
  `Built ${entries.length} static entries in ${relative(root, output)}/ `
  + `(${provenance.contentDigest.fileCount} files, sha256:${content.value}).`,
);
