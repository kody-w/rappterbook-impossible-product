import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, readFile, rm } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("deployment smoke validates and builds a complete static artifact", async () => {
  execFileSync(process.execPath, ["scripts/check-static.mjs"], {
    cwd: root,
    stdio: "pipe",
  });

  try {
    execFileSync(process.execPath, ["scripts/build.mjs"], {
      cwd: root,
      stdio: "pipe",
    });
    await access(new URL("../_site/index.html", import.meta.url));
    await access(new URL("../_site/src/app.mjs", import.meta.url));
    await access(new URL("../_site/evolution/frames/frame-01.json", import.meta.url));
    const deployedHtml = await readFile(new URL("../_site/index.html", import.meta.url), "utf8");
    assert.match(deployedHtml, /Proof of Possible/);
    assert.doesNotMatch(deployedHtml, /(?:src|href)=["']https?:\/\//i);
  } finally {
    await rm(new URL("../_site", import.meta.url), { recursive: true, force: true });
  }
});
