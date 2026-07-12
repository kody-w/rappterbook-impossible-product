import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  assertSameManifest,
  digestManifest,
  manifestDirectory,
} from "./artifact-integrity.mjs";

export const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;

function isTruthy(value) {
  return ["1", "true", "yes"].includes(String(value ?? "").toLowerCase());
}

function gitOutput(repositoryRoot, arguments_) {
  try {
    return execFileSync("git", arguments_, {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    throw new Error(`Required git lookup failed (${arguments_.join(" ")}): ${detail}`);
  }
}

function requireCommitSha(value, label) {
  if (!COMMIT_SHA_PATTERN.test(value ?? "")) {
    throw new Error(`${label} must be exactly 40 lowercase hexadecimal characters`);
  }
  return value;
}

export function resolveBuildIdentity(repositoryRoot, environment = process.env) {
  const root = resolve(repositoryRoot);
  const ci = isTruthy(environment.CI) || isTruthy(environment.GITHUB_ACTIONS);
  const trustedLocal = environment.TRUSTED_LOCAL_BUILD === "1";
  if (trustedLocal && ci) {
    throw new Error("TRUSTED_LOCAL_BUILD is forbidden in CI");
  }

  let githubSha = environment.GITHUB_SHA;
  if (!githubSha) {
    if (!trustedLocal) {
      throw new Error("GITHUB_SHA is required; use TRUSTED_LOCAL_BUILD=1 only for local development");
    }
    githubSha = gitOutput(root, ["rev-parse", "--verify", "HEAD^{commit}"]);
  }
  requireCommitSha(githubSha, "GITHUB_SHA");

  const resolvedCommit = requireCommitSha(
    gitOutput(root, ["rev-parse", "--verify", `${githubSha}^{commit}`]),
    "resolved commit",
  );
  if (resolvedCommit !== githubSha) {
    throw new Error(`GITHUB_SHA did not resolve exactly: expected ${githubSha}, got ${resolvedCommit}`);
  }

  const gitTreeSha = requireCommitSha(
    gitOutput(root, ["rev-parse", "--verify", `${githubSha}^{tree}`]),
    "git tree SHA",
  );
  const headSha = requireCommitSha(
    gitOutput(root, ["rev-parse", "--verify", "HEAD^{commit}"]),
    "Git HEAD",
  );
  if (githubSha !== headSha) {
    throw new Error(`GITHUB_SHA ${githubSha} does not equal Git HEAD ${headSha}`);
  }

  const githubRunId = environment.GITHUB_RUN_ID ?? (trustedLocal ? "local" : null);
  const githubRunAttempt = environment.GITHUB_RUN_ATTEMPT ?? (trustedLocal ? "local" : null);
  if (!githubRunId || !githubRunAttempt) {
    throw new Error("GITHUB_RUN_ID and GITHUB_RUN_ATTEMPT are required outside trusted local mode");
  }
  if (ci && (!/^\d+$/.test(githubRunId) || !/^[1-9]\d*$/.test(githubRunAttempt))) {
    throw new Error("CI run identity must contain numeric GITHUB_RUN_ID and GITHUB_RUN_ATTEMPT");
  }

  return {
    GITHUB_SHA: githubSha,
    GITHUB_RUN_ID: githubRunId,
    GITHUB_RUN_ATTEMPT: githubRunAttempt,
    gitTreeSha,
    buildMode: ci ? "github-actions" : trustedLocal ? "trusted-local" : "verified-checkout",
  };
}

export async function readArtifactProvenance(directory) {
  const path = resolve(directory, "provenance.json");
  let provenance;
  try {
    provenance = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Invalid artifact provenance at ${path}: ${error.message}`);
  }
  return provenance;
}

export async function validateArtifactProvenance(directory, identity) {
  const provenance = await readArtifactProvenance(directory);
  for (const field of [
    "GITHUB_SHA",
    "GITHUB_RUN_ID",
    "GITHUB_RUN_ATTEMPT",
    "gitTreeSha",
    "buildMode",
  ]) {
    if (provenance[field] !== identity[field]) {
      throw new Error(`Artifact provenance ${field} does not match the verified checkout`);
    }
  }
  if (
    provenance.contentDigest?.algorithm !== "sha256"
    || !COMMIT_SHA_PATTERN.test(provenance.GITHUB_SHA)
    || !COMMIT_SHA_PATTERN.test(provenance.gitTreeSha)
    || !/^[0-9a-f]{64}$/.test(provenance.contentDigest?.value ?? "")
    || provenance.contentDigest?.excludes?.length !== 1
    || provenance.contentDigest.excludes[0] !== "provenance.json"
  ) {
    throw new Error("Artifact provenance schema or digest metadata is invalid");
  }
  if (digestManifest(provenance.files ?? {}) !== provenance.contentDigest.value) {
    throw new Error("Artifact provenance manifest does not produce its declared content digest");
  }
  if (Object.keys(provenance.files ?? {}).length !== provenance.contentDigest.fileCount) {
    throw new Error("Artifact provenance file count does not match its manifest");
  }
  const actualContent = await manifestDirectory(directory, { exclude: ["provenance.json"] });
  const expectedContent = {
    algorithm: provenance.contentDigest.algorithm,
    value: provenance.contentDigest.value,
    fileCount: provenance.contentDigest.fileCount,
    files: provenance.files,
  };
  assertSameManifest(actualContent, expectedContent, "Provenance-covered artifact");
  return provenance;
}
