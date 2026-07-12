import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const siteRoot = resolve(root, ".release-contract-tests", "smoke");
const fixedBuildTimestamp = "2026-07-12T03:00:00.000Z";
const headSha = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const treeSha = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
  cwd: root,
  encoding: "utf8",
}).trim();

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("deployment smoke validates and builds a complete static artifact", async () => {
  execFileSync(process.execPath, ["scripts/check-static.mjs"], {
    cwd: root,
    stdio: "pipe",
  });

  try {
    execFileSync(process.execPath, ["scripts/build.mjs"], {
      cwd: root,
      env: {
        ...process.env,
        BUILD_TIMESTAMP: fixedBuildTimestamp,
        GITHUB_RUN_ATTEMPT: "1",
        GITHUB_RUN_ID: "123456789",
        GITHUB_SHA: headSha,
        SITE_OUTPUT_DIR: ".release-contract-tests/smoke",
      },
      stdio: "pipe",
    });
    await access(resolve(siteRoot, "index.html"));
    await access(resolve(siteRoot, "src/app.mjs"));
    await access(resolve(siteRoot, "evolution/frames/frame-01.json"));
    await access(resolve(siteRoot, "evolution/frames/frame-02.json"));
    await access(resolve(siteRoot, "evolution/frames/frame-03.json"));
    await access(resolve(siteRoot, "evolution/strategies/frame-03/science.md"));
    await access(resolve(siteRoot, "provenance.json"));
    const deployedHtml = await readFile(resolve(siteRoot, "index.html"), "utf8");
    const provenance = JSON.parse(
      await readFile(resolve(siteRoot, "provenance.json"), "utf8"),
    );
    assert.match(deployedHtml, /Proof of Possible/);
    assert.match(deployedHtml, /v3\.0\.0 · Frame 3/);
    assert.doesNotMatch(deployedHtml, /(?:src|href)=["']https?:\/\//i);
    assert.equal(provenance.buildTimestamp, fixedBuildTimestamp);
    assert.equal(provenance.GITHUB_SHA, headSha);
    assert.equal(provenance.gitTreeSha, treeSha);
    assert.equal(provenance.GITHUB_RUN_ID, "123456789");
    assert.equal(provenance.GITHUB_RUN_ATTEMPT, "1");
    assert.equal(provenance.contentDigest.algorithm, "sha256");
    assert.equal(provenance.files["index.html"], sha256(deployedHtml));
    assert.equal(Object.hasOwn(provenance.files, "provenance.json"), false);

    const aggregate = createHash("sha256");
    const paths = Object.keys(provenance.files).sort();
    for (const path of paths) {
      const content = await readFile(resolve(siteRoot, path));
      const digest = sha256(content);
      assert.equal(provenance.files[path], digest, `${path} digest`);
      aggregate.update(`${path}\0${digest}\n`);
    }
    assert.equal(provenance.contentDigest.fileCount, paths.length);
    assert.equal(provenance.contentDigest.value, aggregate.digest("hex"));
  } finally {
    await rm(siteRoot, { recursive: true, force: true });
  }
});
