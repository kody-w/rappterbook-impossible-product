import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFile, readFile, rm } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import {
  snapshotArtifact,
  verifyArtifact,
} from "../scripts/attest-artifact.mjs";
import {
  consensusProblems,
  deriveConsensusRanking,
} from "../scripts/consensus.mjs";
import { workflowPolicyProblems } from "../scripts/release-policy.mjs";
import {
  ExternalRedirectError,
  verifyLiveWithRetry,
} from "../scripts/verify-live.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratchRoot = resolve(root, ".release-contract-tests", "release");
const headSha = git("rev-parse", "HEAD");
const treeSha = git("rev-parse", "HEAD^{tree}");
const parentSha = git("rev-parse", "HEAD^");

function git(...arguments_) {
  const result = spawnSync("git", arguments_, {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function buildEnvironment(name, overrides = {}) {
  const environment = {
    ...process.env,
    BUILD_TIMESTAMP: "2026-07-12T04:45:00.000Z",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_RUN_ID: "987654321",
    GITHUB_SHA: headSha,
    SITE_OUTPUT_DIR: relative(root, resolve(scratchRoot, name)),
    ...overrides,
  };
  for (const [key, value] of Object.entries(environment)) {
    if (value === null) {
      delete environment[key];
    }
  }
  delete environment.TRUSTED_LOCAL_BUILD;
  if (overrides.TRUSTED_LOCAL_BUILD) {
    environment.TRUSTED_LOCAL_BUILD = overrides.TRUSTED_LOCAL_BUILD;
  }
  return environment;
}

function runBuild(name, overrides = {}) {
  return spawnSync(process.execPath, ["scripts/build.mjs"], {
    cwd: root,
    encoding: "utf8",
    env: buildEnvironment(name, overrides),
  });
}

function assertBuildFailed(result, pattern) {
  assert.notEqual(result.status, 0, "build unexpectedly succeeded");
  assert.match(`${result.stdout}\n${result.stderr}`, pattern);
}

after(async () => {
  await rm(scratchRoot, { recursive: true, force: true });
});

test("build rejects a hardcoded fake 40-hex GITHUB_SHA", () => {
  const result = runBuild("fake-sha", { GITHUB_SHA: "f".repeat(40) });
  assertBuildFailed(result, /Required git lookup failed/);
});

test("build rejects a resolvable commit that does not equal Git HEAD", () => {
  const result = runBuild("mismatched-sha", { GITHUB_SHA: parentSha });
  assertBuildFailed(result, /does not equal Git HEAD/);
});

test("build fails when git is missing instead of emitting null provenance", () => {
  const result = runBuild("missing-git", {
    PATH: resolve(root, "tests", "fixtures"),
  });
  assertBuildFailed(result, /Required git lookup failed/);
});

test("build records the exact verified HEAD commit and tree", async () => {
  const result = runBuild("correct-sha");
  assert.equal(result.status, 0, result.stderr);
  const provenance = JSON.parse(
    await readFile(resolve(scratchRoot, "correct-sha", "provenance.json"), "utf8"),
  );
  assert.equal(provenance.GITHUB_SHA, headSha);
  assert.equal(provenance.gitTreeSha, treeSha);
  assert.equal(provenance.GITHUB_RUN_ID, "987654321");
  assert.equal(provenance.GITHUB_RUN_ATTEMPT, "1");
  assert.match(provenance.contentDigest.value, /^[0-9a-f]{64}$/);
});

test("trusted local mode is explicit and is forbidden in CI", () => {
  const localResult = runBuild("trusted-local", {
    CI: null,
    GITHUB_ACTIONS: null,
    GITHUB_RUN_ATTEMPT: null,
    GITHUB_RUN_ID: null,
    GITHUB_SHA: null,
    TRUSTED_LOCAL_BUILD: "1",
  });
  assert.equal(localResult.status, 0, localResult.stderr);
  const ciResult = runBuild("trusted-local-ci", {
    CI: "true",
    TRUSTED_LOCAL_BUILD: "1",
  });
  assertBuildFailed(ciResult, /TRUSTED_LOCAL_BUILD is forbidden in CI/);
});

test("artifact attestation rejects any post-test byte mutation", async () => {
  const name = "attestation";
  const environment = buildEnvironment(name);
  const result = runBuild(name);
  assert.equal(result.status, 0, result.stderr);
  const artifactDirectory = relative(root, resolve(scratchRoot, name));
  const attestationPath = relative(root, resolve(scratchRoot, `${name}.json`));
  await snapshotArtifact({ artifactDirectory, attestationPath, environment });
  await verifyArtifact({ artifactDirectory, attestationPath, environment });
  await appendFile(resolve(scratchRoot, name, "index.html"), "\nmutation\n", "utf8");
  await assert.rejects(
    verifyArtifact({ artifactDirectory, attestationPath, environment }),
    /changed after attestation/,
  );
});

test("checked-in workflows satisfy the immutable single-build release policy", async () => {
  const [testWorkflow, pagesWorkflow] = await Promise.all([
    readFile(resolve(root, ".github/workflows/test.yml"), "utf8"),
    readFile(resolve(root, ".github/workflows/pages.yml"), "utf8"),
  ]);
  assert.deepEqual(workflowPolicyProblems(testWorkflow, "test"), []);
  assert.deepEqual(workflowPolicyProblems(pagesWorkflow, "pages"), []);
});

test("policy rejects an npm rebuild inserted after Chromium installation", async () => {
  const pagesWorkflow = await readFile(
    resolve(root, ".github/workflows/pages.yml"),
    "utf8",
  );
  const mutated = pagesWorkflow.replace(
    "      - name: Build the browser-tested Pages artifact once",
    "      - name: Unauthorized post-Chromium rebuild\n"
      + "        run: npm run build\n"
      + "      - name: Build the browser-tested Pages artifact once",
  );
  const problems = workflowPolicyProblems(mutated, "pages");
  assert.ok(problems.some((problem) => problem.includes("exactly once; found 2 builds")));
});

test("policy rejects filesystem mutation between attestation and upload", async () => {
  const pagesWorkflow = await readFile(
    resolve(root, ".github/workflows/pages.yml"),
    "utf8",
  );
  const mutated = pagesWorkflow.replace(
    "      - name: Run browser release contract",
    "      - name: Mutate the attested site\n"
      + "        run: touch _site/index.html\n"
      + "      - name: Run browser release contract",
  );
  const problems = workflowPolicyProblems(mutated, "pages");
  assert.ok(problems.some((problem) => problem.includes("may mutate the artifact")));
});

test("policy rejects a mutable action tag and a non-attested upload path", async () => {
  const pagesWorkflow = await readFile(
    resolve(root, ".github/workflows/pages.yml"),
    "utf8",
  );
  const mutated = pagesWorkflow
    .replace(
      "actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4.3.1",
      "actions/checkout@v4",
    )
    .replace("          path: _site", "          path: .");
  const problems = workflowPolicyProblems(mutated, "pages");
  assert.ok(problems.some((problem) => problem.includes("full immutable commit SHA")));
  assert.ok(problems.some((problem) => problem.includes("attested _site")));
});

const pagesPolicyMutations = [
  {
    name: "npm run build --silent alias",
    mutate: (source) => source.replace(
      "        run: npm run build\n      - name: Snapshot",
      "        run: npm run build --silent\n      - name: Snapshot",
    ),
  },
  {
    name: "direct node scripts/build.mjs invocation",
    mutate: (source) => source.replace(
      "        run: npm run build\n      - name: Snapshot",
      "        run: node scripts/build.mjs\n      - name: Snapshot",
    ),
  },
  {
    name: "sh -c build alias",
    mutate: (source) => source.replace(
      "        run: npm run build\n      - name: Snapshot",
      "        run: sh -c 'npm run build'\n      - name: Snapshot",
    ),
  },
  {
    name: "harmless-looking post-browser touch",
    mutate: (source) => source.replace(
      "      - name: Verify artifact immutability after browser tests",
      "      - name: Touch the tested site\n"
        + "        run: touch _site/x\n"
        + "      - name: Verify artifact immutability after browser tests",
    ),
  },
  {
    name: "multiline build run block",
    mutate: (source) => source.replace(
      "        run: npm run build\n      - name: Snapshot",
      "        run: |\n"
        + "          npm run build\n"
        + "      - name: Snapshot",
    ),
  },
  {
    name: "extra pinned uses action",
    mutate: (source) => source.replace(
      "      - name: Upload the tested Pages artifact",
      "      - name: Unexpected pinned action\n"
        + "        uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4.3.1\n"
        + "      - name: Upload the tested Pages artifact",
    ),
  },
  {
    name: "critical step reordering",
    mutate: (source) => source.replace(
      "      - name: Build the browser-tested Pages artifact once\n"
        + "        run: npm run build\n"
        + "      - name: Snapshot the browser-tested Pages artifact\n"
        + "        run: node scripts/attest-artifact.mjs snapshot",
      "      - name: Snapshot the browser-tested Pages artifact\n"
        + "        run: node scripts/attest-artifact.mjs snapshot\n"
        + "      - name: Build the browser-tested Pages artifact once\n"
        + "        run: npm run build",
    ),
  },
  {
    name: "missing pre-upload verification",
    mutate: (source) => source.replace(
      "      - name: Verify artifact immutability immediately before upload\n"
        + "        run: node scripts/attest-artifact.mjs verify\n",
      "",
    ),
  },
  {
    name: "changed upload path",
    mutate: (source) => source.replace("          path: _site", "          path: _site/"),
  },
];

for (const policyMutation of pagesPolicyMutations) {
  test(`fail-closed Pages policy rejects ${policyMutation.name}`, async () => {
    const pagesWorkflow = await readFile(
      resolve(root, ".github/workflows/pages.yml"),
      "utf8",
    );
    const mutated = policyMutation.mutate(pagesWorkflow);
    assert.notEqual(mutated, pagesWorkflow, "mutation fixture did not alter the workflow");
    const problems = workflowPolicyProblems(mutated, "pages");
    assert.ok(
      problems.some((problem) => problem.includes("not allowlisted")),
      `mutation escaped structural allowlist: ${JSON.stringify(problems)}`,
    );
  });
}

test("Frame 3 ranking is derived from votes with score 20 above score 17", async () => {
  const frame = JSON.parse(
    await readFile(resolve(root, "evolution/frames/frame-03.json"), "utf8"),
  );
  const ranking = deriveConsensusRanking(frame.consensus.candidateScores, {
    selectionThreshold: frame.consensus.selectionThreshold,
    selectedCount: frame.consensus.selectedCount,
  });
  assert.deepEqual(consensusProblems(frame), []);
  assert.equal(ranking.find((candidate) => candidate.total === 20).rank, 4);
  assert.equal(ranking.find((candidate) => candidate.total === 17).rank, 5);
  assert.equal(ranking.filter((candidate) => candidate.selected).length, 3);
  assert.equal(frame.strategies.length, 8);
});

test("live verifier hashes every uploaded asset and rejects redirects", async () => {
  const name = "live-verifier";
  const environment = buildEnvironment(name);
  const buildResult = runBuild(name);
  assert.equal(buildResult.status, 0, buildResult.stderr);
  const expectedDirectory = resolve(scratchRoot, name);
  const provenance = JSON.parse(
    await readFile(resolve(expectedDirectory, "provenance.json"), "utf8"),
  );
  const identity = {
    GITHUB_SHA: provenance.GITHUB_SHA,
    GITHUB_RUN_ID: provenance.GITHUB_RUN_ID,
    GITHUB_RUN_ATTEMPT: provenance.GITHUB_RUN_ATTEMPT,
    gitTreeSha: provenance.gitTreeSha,
    buildMode: provenance.buildMode,
  };
  const baseUrl = "https://pages.example/frame-03/";
  const fetchImplementation = async (url) => {
    const path = decodeURIComponent(url.pathname).replace("/frame-03/", "");
    try {
      return new Response(await readFile(resolve(expectedDirectory, path)), { status: 200 });
    } catch {
      return new Response("missing", { status: 404 });
    }
  };
  const verified = await verifyLiveWithRetry({
    baseUrl,
    expectedDirectory,
    identity,
    fetchImplementation,
    attempts: 1,
    delayMilliseconds: 0,
  });
  assert.equal(verified.fileCount, Object.keys(provenance.files).length);
  assert.equal(verified.contentDigest, provenance.contentDigest.value);

  await assert.rejects(
    verifyLiveWithRetry({
      baseUrl,
      expectedDirectory,
      identity,
      fetchImplementation: async () => new Response(null, {
        status: 302,
        headers: { location: "https://evil.example/" },
      }),
      attempts: 3,
      delayMilliseconds: 0,
    }),
    ExternalRedirectError,
  );
});
