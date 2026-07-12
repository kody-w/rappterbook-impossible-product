import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
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

async function collectFiles(directory) {
  const entriesInDirectory = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entriesInDirectory) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(absolutePath));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
  return files;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function contentManifest(directory) {
  const absoluteFiles = await collectFiles(directory);
  const paths = absoluteFiles
    .map((absolutePath) => relative(directory, absolutePath).replaceAll("\\", "/"))
    .filter((path) => path !== "provenance.json")
    .sort();
  const files = {};
  const aggregate = createHash("sha256");
  for (const path of paths) {
    const content = await readFile(resolve(directory, path));
    const digest = sha256(content);
    files[path] = digest;
    aggregate.update(`${path}\0${digest}\n`);
  }
  return { digest: aggregate.digest("hex"), files };
}

function gitValue(arguments_, fallback = null) {
  try {
    return execFileSync("git", arguments_, { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return fallback;
  }
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const entry of entries) {
  await cp(resolve(root, entry), resolve(output, entry), { recursive: true });
}

const content = await contentManifest(output);
const githubSha = process.env.GITHUB_SHA ?? gitValue(["rev-parse", "HEAD"], "unknown");
const provenance = {
  schemaVersion: 1,
  GITHUB_SHA: githubSha,
  GITHUB_RUN_ID: process.env.GITHUB_RUN_ID ?? "local",
  GITHUB_RUN_ATTEMPT: process.env.GITHUB_RUN_ATTEMPT ?? "local",
  buildTimestamp: process.env.BUILD_TIMESTAMP ?? new Date().toISOString(),
  gitTreeSha: gitValue(["rev-parse", `${githubSha}^{tree}`]),
  contentDigest: {
    algorithm: "sha256",
    value: content.digest,
    fileCount: Object.keys(content.files).length,
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
  `Built ${entries.length} static entries in _site/ (${provenance.contentDigest.fileCount} files, sha256:${content.digest}).`,
);
