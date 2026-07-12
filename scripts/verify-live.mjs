import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  digestManifest,
  manifestDirectory,
  sha256,
} from "./artifact-integrity.mjs";
import {
  readArtifactProvenance,
  resolveBuildIdentity,
  validateArtifactProvenance,
} from "./provenance.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export class ExternalRedirectError extends Error {}

function deploymentUrl(baseUrl, path, cacheKey) {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL(path, normalizedBase);
  const expectedOrigin = new URL(normalizedBase).origin;
  if (url.origin !== expectedOrigin) {
    throw new Error(`Manifest path escaped the Pages origin: ${path}`);
  }
  url.searchParams.set("release_verify", cacheKey);
  return url;
}

async function fetchBytes(fetchImplementation, url) {
  const response = await fetchImplementation(url, {
    cache: "no-store",
    redirect: "manual",
  });
  if (response.status >= 300 && response.status < 400) {
    throw new ExternalRedirectError(
      `External or unexpected redirect for ${url.pathname}: `
      + `${response.status} ${response.headers.get("location") ?? "(no location)"}`,
    );
  }
  if (!response.ok) {
    throw new Error(`Missing live asset ${url.pathname}: HTTP ${response.status}`);
  }
  if (response.url && new URL(response.url).origin !== url.origin) {
    throw new ExternalRedirectError(`Live asset escaped the expected origin: ${response.url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function verifyRemoteOnce(options) {
  const {
    baseUrl,
    expectedDirectory,
    expectedProvenance,
    expectedProvenanceBytes,
    fetchImplementation = fetch,
    cacheKey = "release",
  } = options;
  const liveProvenanceBytes = await fetchBytes(
    fetchImplementation,
    deploymentUrl(baseUrl, "provenance.json", cacheKey),
  );
  if (!liveProvenanceBytes.equals(expectedProvenanceBytes)) {
    throw new Error("Live provenance bytes do not equal the uploaded Pages artifact");
  }
  let liveProvenance;
  try {
    liveProvenance = JSON.parse(liveProvenanceBytes.toString("utf8"));
  } catch (error) {
    throw new Error(`Live provenance is not valid JSON: ${error.message}`);
  }
  if (JSON.stringify(liveProvenance) !== JSON.stringify(expectedProvenance)) {
    throw new Error("Live provenance fields drifted from the uploaded Pages artifact");
  }

  const fetchedFiles = {};
  for (const [path, expectedDigest] of Object.entries(expectedProvenance.files).sort()) {
    const bytes = await fetchBytes(
      fetchImplementation,
      deploymentUrl(baseUrl, path, cacheKey),
    );
    const actualDigest = sha256(bytes);
    if (actualDigest !== expectedDigest) {
      throw new Error(`Live asset hash drift for ${path}: ${actualDigest} != ${expectedDigest}`);
    }
    const expectedBytes = await readFile(resolve(expectedDirectory, path));
    if (!bytes.equals(expectedBytes)) {
      throw new Error(`Live asset bytes do not equal the uploaded artifact: ${path}`);
    }
    fetchedFiles[path] = actualDigest;
  }
  if (digestManifest(fetchedFiles) !== expectedProvenance.contentDigest.value) {
    throw new Error("Live manifest does not reproduce the expected content digest");
  }
  return {
    sha: expectedProvenance.GITHUB_SHA,
    tree: expectedProvenance.gitTreeSha,
    runId: expectedProvenance.GITHUB_RUN_ID,
    runAttempt: expectedProvenance.GITHUB_RUN_ATTEMPT,
    contentDigest: expectedProvenance.contentDigest.value,
    fileCount: expectedProvenance.contentDigest.fileCount,
  };
}

export async function verifyLiveWithRetry(options) {
  const expectedDirectory = resolve(options.expectedDirectory);
  const identity = options.identity
    ?? resolveBuildIdentity(repositoryRoot, options.environment ?? process.env);
  const expectedProvenance = await validateArtifactProvenance(expectedDirectory, identity);
  const expectedArtifact = await manifestDirectory(expectedDirectory);
  const expectedProvenanceBytes = await readFile(
    resolve(expectedDirectory, "provenance.json"),
  );
  const attempts = options.attempts ?? 18;
  const delayMilliseconds = options.delayMilliseconds ?? 10_000;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await verifyRemoteOnce({
        ...options,
        expectedDirectory,
        expectedProvenance,
        expectedProvenanceBytes,
        cacheKey: `${identity.GITHUB_RUN_ID}-${identity.GITHUB_RUN_ATTEMPT}-${attempt}`,
      });
      console.log(
        `Verified live Pages SHA ${result.sha}, tree ${result.tree}, `
        + `${result.fileCount} assets, content sha256:${result.contentDigest}, `
        + `artifact sha256:${expectedArtifact.value}.`,
      );
      return {
        ...result,
        artifactDigest: expectedArtifact.value,
        artifactFileCount: expectedArtifact.fileCount,
      };
    } catch (error) {
      if (error instanceof ExternalRedirectError) {
        throw error;
      }
      lastError = error;
      if (attempt < attempts) {
        console.warn(`Live verification attempt ${attempt}/${attempts} failed: ${error.message}`);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMilliseconds));
      }
    }
  }
  throw new Error(`Live deployment did not converge: ${lastError?.message ?? "unknown error"}`);
}

async function main() {
  const baseUrl = process.env.DEPLOYED_URL;
  if (!baseUrl) {
    throw new Error("DEPLOYED_URL is required");
  }
  await verifyLiveWithRetry({
    baseUrl,
    expectedDirectory: resolve(repositoryRoot, "_expected-site"),
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Live release verification failed: ${error.message}`);
    process.exitCode = 1;
  });
}
