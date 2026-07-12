import { access, readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFile(resolve(root, path), "utf8");
const [
  html,
  css,
  app,
  core,
  frameOne,
  frameTwo,
  frameThree,
  timeline,
  packageJson,
  buildScript,
  serverScript,
] = await Promise.all([
  read("index.html"),
  read("styles.css"),
  read("src/app.mjs"),
  read("src/core.mjs"),
  read("evolution/frames/frame-01.json").then(JSON.parse),
  read("evolution/frames/frame-02.json").then(JSON.parse),
  read("evolution/frames/frame-03.json").then(JSON.parse),
  read("evolution/timeline.json").then(JSON.parse),
  read("package.json").then(JSON.parse),
  read("scripts/build.mjs"),
  read("scripts/serve.mjs"),
]);
const failures = [];

function check(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

check(frameOne.strategyLenses.length === 8, "Frame 1 must preserve eight strategy lenses.");
check(frameOne.selectedMutations.length === 3, "Frame 1 must preserve exactly three mutations.");
check(frameTwo.strategies.length === 8, "Frame 2 must preserve eight strategy audits.");
check(frameTwo.selectedMutations.length === 3, "Frame 2 must select exactly three mutations.");
check(frameTwo.consensus.selectedCount === 3, "Frame 2 consensus must report exactly three selections.");
check(frameThree.strategies.length === 8, "Frame 3 must preserve eight strategy audits.");
check(frameThree.selectedMutations.length === 3, "Frame 3 must select exactly three mutations.");
check(frameThree.consensus.selectedCount === 3, "Frame 3 consensus must report exactly three selections.");
check(
  JSON.stringify(frameTwo.selectedMutations.map((mutation) => mutation.id)) === JSON.stringify([
    "assisted-experiment-compiler",
    "criterion-linked-evidence",
    "recoverable-local-workspace",
  ]),
  "Frame 2 must preserve the same three selected product mutations.",
);
check(
  frameTwo.consensus.candidateScores.every(
    (candidate) => candidate.total === candidate.auditVotes.reduce((sum, vote) => sum + vote, 0),
  ),
  "Frame 2 consensus totals must equal their transparent audit votes.",
);
check(
  JSON.stringify(frameThree.selectedMutations.map((mutation) => mutation.id)) === JSON.stringify([
    "decision-grade-assumption-probes",
    "barrier-capacity-aware-routes",
    "belief-lineage-reasoned-decisions",
  ]),
  "Frame 3 must preserve exactly the three consensus product mutations.",
);
check(
  frameThree.consensus.candidateScores.every(
    (candidate) => candidate.total === candidate.auditVotes.reduce((sum, vote) => sum + vote, 0),
  ),
  "Frame 3 consensus totals must equal transparent audit votes.",
);
check(
  frameThree.baseline.acceptedLiveCommitSha
    === "fdddf6444a0ba2f3fcad81663053b8983fcfac3d",
  "Frame 3 must identify the accepted live baseline.",
);

const strategyDirectory = resolve(root, "evolution/strategies/frame-02");
const strategyFiles = (await readdir(strategyDirectory)).sort();
const expectedStrategyFiles = [
  "accessibility.md",
  "activation.md",
  "adversarial.md",
  "behavior.md",
  "clarity.md",
  "measurement.md",
  "reliability.md",
  "retention.md",
];
check(
  JSON.stringify(strategyFiles) === JSON.stringify(expectedStrategyFiles),
  "Frame 2 must preserve exactly eight named raw strategy files.",
);

const frameThreeStrategyDirectory = resolve(root, "evolution/strategies/frame-03");
const frameThreeStrategyFiles = (await readdir(frameThreeStrategyDirectory)).sort();
const expectedFrameThreeStrategyFiles = [
  "activation.md",
  "collaboration.md",
  "experience.md",
  "inclusive.md",
  "learning.md",
  "localfirst.md",
  "science.md",
  "usecases.md",
];
check(
  JSON.stringify(frameThreeStrategyFiles) === JSON.stringify(expectedFrameThreeStrategyFiles),
  "Frame 3 must preserve exactly eight named raw strategy files.",
);

check(timeline.frames.length === 12, "Evolution timeline must contain exactly 12 frames.");
check(
  timeline.frames.slice(0, 3).every((item) => item.status === "shipped"),
  "Frames 1 through 3 must be marked shipped.",
);
check(
  timeline.frames.slice(3).every((item) => item.status === "pending"),
  "Frames 4–12 must remain pending.",
);

check(html.includes('href="#main-content"'), "Page must include a skip link.");
check(html.includes('aria-live="polite"'), "Page must include polite status announcements.");
check(css.includes(":focus-visible"), "Styles must define visible keyboard focus.");
check(css.includes("prefers-reduced-motion"), "Styles must honor reduced motion.");
check(html.includes("Content-Security-Policy"), "Page must declare a restrictive content security policy.");
check(
  html.includes("not universally private"),
  "Privacy copy must not imply universal privacy.",
);
check(html.indexOf('class="workspace"') < html.indexOf('class="metrics-section"'), "Task workspace must precede metrics.");
check(html.includes("v3.0.0 · Frame 3"), "Page must identify the Frame 3 release.");
check(html.includes('id="copy-begin"'), "Page must expose an explicit Copy & begin event.");
check(html.includes('id="lineage-list"'), "Page must expose a keyboard-readable lineage.");
check(
  html.includes('value="untimed"') && html.includes('value="active_effort"'),
  "Page must expose untimed and active-effort pacing.",
);

const htmlExternalResource = /(?:src|href)=["']https?:\/\//i;
const cssExternalResource = /(?:@import\s+(?:url\()?|url\()\s*["']?https?:\/\//i;
const jsExternalResource = /(?:import\s*(?:\(|[^;]*?\bfrom\s*)|fetch\s*\(|new\s+(?:Worker|SharedWorker|WebSocket|EventSource)\s*\(|sendBeacon\s*\()\s*["'`]https?:\/\//i;
check(!htmlExternalResource.test(html), "HTML must not load third-party runtime resources.");
check(!cssExternalResource.test(css), "CSS must not load third-party runtime resources.");
check(!jsExternalResource.test(`${app}\n${core}`), "JavaScript must not load third-party runtime resources.");

check(
  packageJson.devDependencies?.["@playwright/test"] === "1.61.1",
  "Playwright must be pinned exactly for reproducible release tests.",
);
check(
  packageJson.scripts?.["test:e2e"]?.includes("npm run build"),
  "Browser tests must build the artifact before opening it.",
);
check(
  buildScript.includes("provenance.json")
    && buildScript.includes("GITHUB_SHA")
    && buildScript.includes("GITHUB_RUN_ID")
    && buildScript.includes("GITHUB_RUN_ATTEMPT")
    && buildScript.includes("contentDigest"),
  "Build must emit deployed provenance and a deterministic content digest.",
);
check(
  serverScript.includes('resolve(repositoryRoot, "_site")'),
  "Browser test server must serve the built _site artifact.",
);
check(
  frameTwo.release.currentDeploymentSourceOfTruth === "/provenance.json"
    && !Object.hasOwn(frameTwo.release, "implementationCommitSha")
    && !Object.hasOwn(frameTwo.release, "pagesWorkflowRunUrl"),
  "Frame 2 must defer current deployment identity to generated provenance.",
);
check(
  frameTwo.release.completionRelease?.selectedMutationCount === 3
    && frameTwo.release.completionRelease?.strategyEvidenceFileCount === 8
    && frameTwo.release.completionRelease?.nextFrameStarted === false
    && frameTwo.release.completionRelease?.productMutationAdded === false,
  "Frame 2 completion repair must not start Frame 3 or add a fourth mutation.",
);
check(
  frameThree.release.currentDeploymentSourceOfTruth === "/provenance.json"
    && frameThree.release.generatedProvenanceMechanism.includes("tree digest")
    && !Object.hasOwn(frameThree.release, "implementationCommitSha")
    && !Object.hasOwn(frameThree.release, "pagesWorkflowRunUrl"),
  "Frame 3 must defer mutable deployment identity to generated provenance.",
);

const references = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
  .map((match) => match[1]);
for (const reference of references) {
  if (reference.startsWith("#") || reference.startsWith("data:")) {
    continue;
  }
  const localPath = reference.replace(/^\.\//, "").split(/[?#]/)[0];
  try {
    await access(resolve(root, localPath || "."));
  } catch {
    failures.push(`Missing local resource referenced by index.html: ${reference}`);
  }
}

const [testWorkflow, pagesWorkflow] = await Promise.all([
  read(".github/workflows/test.yml"),
  read(".github/workflows/pages.yml"),
]);
check(testWorkflow.includes("npm run test:e2e"), "Test workflow must block on the browser contract.");
check(pagesWorkflow.includes("npm run test:e2e"), "Pages validation must block on the browser contract.");
check(
  pagesWorkflow.indexOf("npm run test:e2e")
    < pagesWorkflow.indexOf("actions/upload-pages-artifact@v3"),
  "Pages must upload only after browser tests pass.",
);
check(
  pagesWorkflow.indexOf("actions/upload-pages-artifact@v3")
    < pagesWorkflow.indexOf("actions/deploy-pages@v4"),
  "Pages must deploy the already-tested uploaded artifact.",
);
check(
  !pagesWorkflow.includes("node scripts/build.mjs"),
  "Pages deploy job must not rebuild after the browser-tested artifact is uploaded.",
);

if (failures.length > 0) {
  failures.forEach((failure) => console.error(`FAIL: ${failure}`));
  process.exitCode = 1;
} else {
  console.log(
    `Static checks passed (${references.length} local references, HTML/JS/CSS runtime scan, Frame 3: 8 strategies, 3 mutations, 12 frames).`,
  );
}
