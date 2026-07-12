import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertSameManifest,
  manifestDirectory,
} from "./artifact-integrity.mjs";
import {
  resolveBuildIdentity,
  validateArtifactProvenance,
} from "./provenance.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function insideRepository(path) {
  const absolutePath = resolve(repositoryRoot, path);
  if (absolutePath === repositoryRoot || !absolutePath.startsWith(`${repositoryRoot}${sep}`)) {
    throw new Error(`Release path must stay inside the repository: ${path}`);
  }
  return absolutePath;
}

export async function snapshotArtifact(options = {}) {
  const environment = options.environment ?? process.env;
  const artifactDirectory = insideRepository(options.artifactDirectory ?? "_site");
  const attestationPath = insideRepository(
    options.attestationPath ?? ".release-attestation.json",
  );
  const identity = resolveBuildIdentity(repositoryRoot, environment);
  const provenance = await validateArtifactProvenance(artifactDirectory, identity);
  const artifact = await manifestDirectory(artifactDirectory);
  const attestation = {
    schemaVersion: 1,
    artifactPath: relative(repositoryRoot, artifactDirectory).replaceAll("\\", "/"),
    source: identity,
    contentDigest: provenance.contentDigest,
    artifactDigest: artifact,
  };
  await mkdir(dirname(attestationPath), { recursive: true });
  await writeFile(attestationPath, `${JSON.stringify(attestation, null, 2)}\n`, "utf8");
  console.log(
    `Attested ${attestation.artifactPath} `
    + `(${artifact.fileCount} files, sha256:${artifact.value}).`,
  );
  return attestation;
}

export async function verifyArtifact(options = {}) {
  const environment = options.environment ?? process.env;
  const artifactDirectory = insideRepository(options.artifactDirectory ?? "_site");
  const attestationPath = insideRepository(
    options.attestationPath ?? ".release-attestation.json",
  );
  const identity = resolveBuildIdentity(repositoryRoot, environment);
  const provenance = await validateArtifactProvenance(artifactDirectory, identity);
  const attestation = JSON.parse(await readFile(attestationPath, "utf8"));
  const artifactPath = relative(repositoryRoot, artifactDirectory).replaceAll("\\", "/");
  if (
    attestation.schemaVersion !== 1
    || attestation.artifactPath !== artifactPath
    || JSON.stringify(attestation.source) !== JSON.stringify(identity)
    || JSON.stringify(attestation.contentDigest) !== JSON.stringify(provenance.contentDigest)
  ) {
    throw new Error("Release attestation does not match this artifact and checkout");
  }
  const actualArtifact = await manifestDirectory(artifactDirectory);
  assertSameManifest(actualArtifact, attestation.artifactDigest, "Attested artifact");
  console.log(
    `Verified immutable ${artifactPath} `
    + `(${actualArtifact.fileCount} files, sha256:${actualArtifact.value}).`,
  );
  return attestation;
}

async function main() {
  const command = process.argv[2];
  if (command === "snapshot") {
    await snapshotArtifact();
  } else if (command === "verify") {
    await verifyArtifact();
  } else {
    throw new Error("Usage: node scripts/attest-artifact.mjs <snapshot|verify>");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Release attestation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
