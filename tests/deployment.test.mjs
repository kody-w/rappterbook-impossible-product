import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const siteRoot = fileURLToPath(new URL("../_site/", import.meta.url));
const fixedBuildTimestamp = "2026-07-12T03:00:00.000Z";

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
      env: { ...process.env, BUILD_TIMESTAMP: fixedBuildTimestamp },
      stdio: "pipe",
    });
    await access(new URL("../_site/index.html", import.meta.url));
    await access(new URL("../_site/src/app.mjs", import.meta.url));
    await access(new URL("../_site/evolution/frames/frame-01.json", import.meta.url));
    await access(new URL("../_site/evolution/frames/frame-02.json", import.meta.url));
    await access(new URL("../_site/evolution/frames/frame-03.json", import.meta.url));
    await access(new URL("../_site/evolution/strategies/frame-03/science.md", import.meta.url));
    await access(new URL("../_site/provenance.json", import.meta.url));
    const deployedHtml = await readFile(new URL("../_site/index.html", import.meta.url), "utf8");
    const provenance = JSON.parse(
      await readFile(new URL("../_site/provenance.json", import.meta.url), "utf8"),
    );
    assert.match(deployedHtml, /Proof of Possible/);
    assert.match(deployedHtml, /v3\.0\.0 · Frame 3/);
    assert.doesNotMatch(deployedHtml, /(?:src|href)=["']https?:\/\//i);
    assert.equal(provenance.buildTimestamp, fixedBuildTimestamp);
    assert.equal(typeof provenance.GITHUB_SHA, "string");
    assert.ok(provenance.GITHUB_SHA.length > 0);
    assert.ok(Object.hasOwn(provenance, "GITHUB_RUN_ID"));
    assert.ok(Object.hasOwn(provenance, "GITHUB_RUN_ATTEMPT"));
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
    await rm(new URL("../_site", import.meta.url), { recursive: true, force: true });
  }
});
