import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function assertSafeManifestPath(path) {
  const segments = path.split("/");
  if (
    path.length === 0
    || path.startsWith("/")
    || path.includes("\\")
    || segments.includes("")
    || segments.includes(".")
    || segments.includes("..")
  ) {
    throw new Error(`Unsafe artifact path: ${path}`);
  }
}

async function collectFiles(directory) {
  const directoryEntries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of directoryEntries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Artifact symlinks are forbidden: ${absolutePath}`);
    }
    if (entry.isDirectory()) {
      files.push(...await collectFiles(absolutePath));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
  return files;
}

export function digestManifest(files) {
  const aggregate = createHash("sha256");
  const paths = Object.keys(files).sort();
  for (const path of paths) {
    assertSafeManifestPath(path);
    const digest = files[path];
    if (!/^[0-9a-f]{64}$/.test(digest)) {
      throw new Error(`Invalid SHA-256 digest for ${path}`);
    }
    aggregate.update(`${path}\0${digest}\n`);
  }
  return aggregate.digest("hex");
}

export async function manifestDirectory(directory, options = {}) {
  const root = resolve(directory);
  const rootStats = await lstat(root);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error(`Artifact root must be a real directory: ${root}`);
  }
  const excluded = new Set(options.exclude ?? []);
  const absoluteFiles = await collectFiles(root);
  const paths = absoluteFiles
    .map((absolutePath) => relative(root, absolutePath).replaceAll("\\", "/"))
    .filter((path) => !excluded.has(path))
    .sort();
  const files = {};
  for (const path of paths) {
    assertSafeManifestPath(path);
    files[path] = sha256(await readFile(resolve(root, path)));
  }
  return {
    algorithm: "sha256",
    value: digestManifest(files),
    fileCount: paths.length,
    files,
  };
}

export function assertSameManifest(actual, expected, label = "artifact") {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${label} bytes changed after attestation`);
  }
}
