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
  timeline,
  packageJson,
] = await Promise.all([
  read("index.html"),
  read("styles.css"),
  read("src/app.mjs"),
  read("src/core.mjs"),
  read("evolution/frames/frame-01.json").then(JSON.parse),
  read("evolution/frames/frame-02.json").then(JSON.parse),
  read("evolution/timeline.json").then(JSON.parse),
  read("package.json").then(JSON.parse),
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
check(
  frameTwo.consensus.candidateScores.every(
    (candidate) => candidate.total === candidate.auditVotes.reduce((sum, vote) => sum + vote, 0),
  ),
  "Frame 2 consensus totals must equal their transparent audit votes.",
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

check(timeline.frames.length === 12, "Evolution timeline must contain exactly 12 frames.");
check(
  timeline.frames.slice(0, 2).every((item) => item.status === "shipped"),
  "Frames 1 and 2 must be marked shipped.",
);
check(
  timeline.frames.slice(2).every((item) => item.status === "pending"),
  "Frames 3–12 must remain pending.",
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

if (failures.length > 0) {
  failures.forEach((failure) => console.error(`FAIL: ${failure}`));
  process.exitCode = 1;
} else {
  console.log(
    `Static checks passed (${references.length} local references, HTML/JS/CSS runtime scan, 8 strategies, 3 mutations, 12 frames).`,
  );
}
