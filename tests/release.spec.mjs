import { expect, test as base } from "@playwright/test";

const allowedOrigin = "http://127.0.0.1:4173";
const storageKey = "proof-of-possible:workspace:v2";
const journalKey = "proof-of-possible:journal:v2";
const proofPatterns = [
  {
    label: "Ask a real person",
    before: 24,
    after: 12,
    mission: /one question of 12 words or fewer/,
  },
  {
    label: "Make a tiny artifact",
    before: 3,
    after: 1,
    mission: /no more than 1 part that demonstrates/,
  },
  {
    label: "Check a real constraint",
    before: 3,
    after: 1,
    mission: /up to 1 explicit requirement affecting/,
  },
  {
    label: "Send a reversible probe",
    before: 60,
    after: 30,
    mission: /one reversible probe of 30 words or fewer/,
  },
];

const test = base.extend({
  releaseGuard: [async ({ page }, use) => {
    const runtimeErrors = [];
    const externalRequests = [];
    page.on("pageerror", (error) => runtimeErrors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") {
        runtimeErrors.push(`console: ${message.text()}`);
      }
    });
    page.on("request", (request) => {
      if (new URL(request.url()).origin !== allowedOrigin) {
        externalRequests.push(request.url());
      }
    });
    await use();
    expect(runtimeErrors, "uncaught page or console errors").toEqual([]);
    expect(externalRequests, "third-party runtime requests").toEqual([]);
  }, { auto: true }],
});

async function fillMinimumDraft(page, options = {}) {
  const goal = options.goal ?? "Publish a clear landing page";
  const obstacle = options.obstacle
    ?? "I have no polished copy and only a few minutes";
  const proofLabel = options.proofLabel ?? "Make a tiny artifact";
  await page.getByLabel("Goal").fill(goal);
  await page.getByLabel("Binding constraint").fill(obstacle);
  await page.getByLabel(proofLabel).check();
  await expect(page.locator("#draft-status")).toContainText("Draft saved");
}

async function completeSprint(page, options = {}) {
  await fillMinimumDraft(page, options);
  await page.getByRole("button", { name: "Compile one experiment" }).click();
  await page.getByRole("button", { name: /Freeze and start 5 minutes sprint/ }).click();
  await page.getByRole("button", { name: "Record result" }).click();
  await page.getByLabel("Action taken").check();
  await page.getByLabel(options.status ?? "Completed").check();
  const verdict = options.verdict ?? "observed";
  await page.locator(`[name="criterionVerdict"][value="${verdict}"]`).check();
  await page.getByLabel("Separate observation").fill(
    options.observation
      ?? "The rough landing page opened and displayed one concrete offer.",
  );
  if (options.url) {
    await page.getByLabel("Supporting URL").fill(options.url);
  }
  await page.getByLabel("Confidence after the test").fill("55");
  await page.getByRole("button", { name: "Save criterion-linked receipt" }).click();
  await expect(page.getByRole("heading", { name: "Receipt and next decision" })).toBeVisible();
}

async function resetWorkspace(page) {
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole("heading", { name: "What needs a real-world answer?" })).toBeVisible();
}

async function downloadBuffer(download) {
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function assertNoHorizontalOverflow(page, stateName) {
  const dimensions = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const offenders = [...document.body.querySelectorAll("*")]
      .filter((node) => {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") {
          return false;
        }
        const rectangle = node.getBoundingClientRect();
        return rectangle.width > viewport + 1
          || rectangle.right > viewport + 1
          || rectangle.left < -1;
      })
      .map((node) => ({
        className: node.className,
        clientWidth: node.clientWidth,
        id: node.id,
        left: Math.round(node.getBoundingClientRect().left),
        right: Math.round(node.getBoundingClientRect().right),
        scrollWidth: node.scrollWidth,
        tag: node.tagName,
        width: Math.round(node.getBoundingClientRect().width),
      }))
      .slice(0, 10);
    return {
      viewport,
      documentWidth: document.documentElement.scrollWidth,
      offenders,
    };
  });
  expect(
    dimensions.documentWidth,
    `${stateName} document width; offenders=${JSON.stringify(dimensions.offenders)}`,
  ).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.offenders, `${stateName} overflowing elements`).toEqual([]);
}

test("browser opens the built artifact with build-time provenance", async ({ page }) => {
  await page.goto("/");
  const provenance = await page.evaluate(async () => {
    const response = await fetch("./provenance.json", { cache: "no-store" });
    return response.json();
  });
  expect(provenance.GITHUB_SHA).toMatch(/^[0-9a-f]{40}$/);
  expect(String(provenance.GITHUB_RUN_ID).length).toBeGreaterThan(0);
  expect(String(provenance.GITHUB_RUN_ATTEMPT).length).toBeGreaterThan(0);
  expect(provenance.buildTimestamp).toMatch(/^\d{4}-\d\d-\d\dT/);
  expect(provenance.contentDigest.value).toMatch(/^[0-9a-f]{64}$/);
  expect(provenance.files["src/app.mjs"]).toMatch(/^[0-9a-f]{64}$/);
  await expect(page.locator("#release-provenance")).toContainText(
    provenance.GITHUB_SHA.slice(0, 12),
  );
});

test("main journey restores a draft and preserves the preregistered criterion", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "What needs a real-world answer?" })).toBeVisible();

  await fillMinimumDraft(page);
  await page.reload();
  await expect(page.getByLabel("Goal")).toHaveValue("Publish a clear landing page");
  await expect(page.getByLabel("Binding constraint")).toHaveValue(
    "I have no polished copy and only a few minutes",
  );
  await expect(page.getByLabel("Make a tiny artifact")).toBeChecked();
  await expect(page.locator("#metric-ratio")).toHaveText(
    "0 evidence-bearing receipts / 0 sprints started",
  );

  await page.getByRole("button", { name: "Compile one experiment" }).click();
  const criterion = await page.getByLabel("Binary or explicit success criterion").inputValue();
  await page.getByLabel("Hard timebox").selectOption("1");
  await expect(page.getByLabel("Stop condition")).toHaveValue(/after 1 minute,/);
  await page.getByRole("button", { name: "Freeze and start 1 minute sprint" }).click();

  await expect(page.locator("#active-success")).toHaveText(criterion);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Run only the frozen mission." })).toBeVisible();
  await expect(page.locator("#active-success")).toHaveText(criterion);
  await expect(page.locator("#frozen-at")).not.toBeEmpty();

  await page.getByRole("button", { name: "Record result" }).click();
  await expect(page.locator("#outcome-criterion")).toHaveText(criterion);
  await page.getByLabel("Action taken").check();
  await page.getByLabel("Completed").check();
  await page.locator("#verdict-observed").check();
  await page.getByLabel("Separate observation").fill(
    "The rough landing page opened and showed one concrete offer.",
  );
  await page.getByLabel("Confidence after the test").fill("55");
  await page.getByRole("button", { name: "Save criterion-linked receipt" }).click();

  await expect(page.locator("#receipt")).toContainText(criterion);
  await expect(page.locator("#receipt")).toContainText("Not independently verified");
  await expect(page.locator("#receipt")).toContainText("Action taken");
  await expect(page.locator("#metric-ratio")).toHaveText(
    "1 evidence-bearing receipt / 1 sprint started",
  );
  await expect(page.locator("#decision-title")).toHaveText("Stop: the criterion was observed.");
});

test("scope-reduction button genuinely simplifies every proof pattern", async ({ page }) => {
  for (const pattern of proofPatterns) {
    await page.goto("/");
    await resetWorkspace(page);
    await fillMinimumDraft(page, { proofLabel: pattern.label });
    await page.getByRole("button", { name: "Compile one experiment" }).click();
    await expect(page.locator("#scopeValue")).toHaveValue(String(pattern.before));
    const beforeMission = await page.locator("#mission").inputValue();

    await page.getByRole("button", { name: "Reduce declared scope" }).click();

    await expect(page.locator("#scopeValue")).toHaveValue(String(pattern.after));
    await expect(page.locator("#mission")).toHaveValue(pattern.mission);
    const afterMission = await page.locator("#mission").inputValue();
    expect(afterMission).not.toEqual(beforeMission);
    expect(afterMission).not.toMatch(/\b1 (?:parts|requirements|words)\b/i);
    const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
    expect(stored.state.draft.revisions.at(-1).type).toBe("scope_reduction");
    expect(stored.state.draft.revisions.at(-1).toValue).toBe(pattern.after);
  }
});

test("both status-specific decision buttons are wired to real state changes", async ({ page }) => {
  await page.goto("/");
  await completeSprint(page, { status: "Attempted", verdict: "not_observed" });
  await expect(page.locator("#decision-primary")).toHaveText("Create a smaller linked test");
  await page.locator("#decision-primary").click();
  await expect(page.getByRole("heading", { name: "Review the compiled mission" })).toBeVisible();
  await expect(page.locator("#review-context")).toContainText("decision: revise shrink");
  await expect(page.locator("#scopeValue")).toHaveValue("1");
  let stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  expect(stored.state.draft.decision).toBe("revise_shrink");

  await resetWorkspace(page);
  await completeSprint(page);
  await expect(page.locator("#decision-secondary")).toHaveText("Create a linked continuation");
  await page.locator("#decision-secondary").click();
  await expect(page.getByRole("heading", { name: "Review the compiled mission" })).toBeVisible();
  await expect(page.locator("#review-context")).toContainText("decision: continue");
  stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  expect(stored.state.draft.decision).toBe("continue");
  expect(stored.state.goals[0].outcome.criterionVerdict).toBe("observed");
});

test("skip link moves keyboard focus to main content", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.locator(".skip-link")).toBeFocused();
  const focusStyle = await page.locator(".skip-link").evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
    };
  });
  expect(focusStyle.outlineStyle).not.toBe("none");
  expect(focusStyle.outlineWidth).toBeGreaterThanOrEqual(3);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main-content$/);
  await expect(page.locator("#main-content")).toBeFocused();
});

test("all populated states and long content reflow at 320px and 200% text", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  const goal = `Publish ${"G".repeat(120)}`;
  const obstacle = `Constraint ${"C".repeat(170)}`;
  await fillMinimumDraft(page, { goal, obstacle });
  await assertNoHorizontalOverflow(page, "intake");

  await page.getByRole("button", { name: "Compile one experiment" }).click();
  await assertNoHorizontalOverflow(page, "review");
  await page.getByRole("button", { name: /Freeze and start 5 minutes sprint/ }).click();
  await assertNoHorizontalOverflow(page, "sprint");
  await page.getByRole("button", { name: "Record result" }).click();
  await page.getByLabel("Action taken").check();
  await page.getByLabel("Completed").check();
  await page.locator("#verdict-observed").check();
  await page.getByLabel("Separate observation").fill(
    `Visible result ${"O".repeat(1000)}`,
  );
  await page.getByLabel("Supporting URL").fill(
    `https://example.com/${"u".repeat(1000)}`,
  );
  await page.getByLabel("Confidence after the test").fill("55");
  await assertNoHorizontalOverflow(page, "outcome");

  await page.getByRole("button", { name: "Save criterion-linked receipt" }).click();
  await expect(page.locator("#history-list")).toContainText(goal);
  await assertNoHorizontalOverflow(page, "receipt and populated history");
});

test("primary, journal, and double-corruption recovery states are truthful", async ({ page }) => {
  await page.goto("/");
  await completeSprint(page);
  const newest = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  newest.revision = 2;
  newest.writtenAt = "2026-07-12T03:02:00.000Z";
  newest.writerId = "newer-journal";
  const older = structuredClone(newest);
  older.revision = 1;
  older.writtenAt = "2026-07-12T03:01:00.000Z";
  older.writerId = "older-primary";
  older.state.goals = [];
  older.state.activeGoalId = null;
  older.state.draft = null;

  await page.evaluate(({ primary, journal, storage, recovery }) => {
    localStorage.setItem(storage, JSON.stringify(primary));
    localStorage.setItem(recovery, JSON.stringify(journal));
  }, { primary: older, journal: newest, storage: storageKey, recovery: journalKey });
  await page.reload();
  await expect(page.locator("#metric-ratio")).toHaveText(
    "1 evidence-bearing receipt / 1 sprint started",
  );
  await expect(page.locator("#recovery-warning")).toContainText(
    "newer validated journal revision (2)",
  );
  await expect(page.locator("#reset-warning")).toBeHidden();

  await page.evaluate(({ journal, storage, recovery }) => {
    localStorage.setItem(storage, "{bad");
    localStorage.setItem(recovery, JSON.stringify(journal));
  }, { journal: newest, storage: storageKey, recovery: journalKey });
  await page.reload();
  await expect(page.locator("#recovery-warning")).toContainText(
    "primary workspace was invalid",
  );
  await expect(page.locator("#metric-ratio")).toHaveText(
    "1 evidence-bearing receipt / 1 sprint started",
  );

  await page.evaluate(({ storage, recovery }) => {
    localStorage.setItem(storage, "{bad");
    localStorage.setItem(recovery, "{\"also\":");
  }, { storage: storageKey, recovery: journalKey });
  await page.reload();
  await expect(page.locator("#recovery-warning")).toBeHidden();
  await expect(page.locator("#reset-warning")).toContainText(
    "none passed semantic validation",
  );
  await expect(page.locator("#metric-ratio")).toHaveText(
    "0 evidence-bearing receipts / 0 sprints started",
  );
  const corruptCopies = await page.evaluate(({ storage, recovery }) => ({
    primary: localStorage.getItem(storage),
    journal: localStorage.getItem(recovery),
  }), { storage: storageKey, recovery: journalKey });
  expect(corruptCopies).toEqual({ primary: "{bad", journal: "{\"also\":" });
});

test("export, clear, import, and adversarial imports preserve honest data", async ({ page }) => {
  await page.goto("/");
  await completeSprint(page);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  const exported = await downloadBuffer(await downloadPromise);
  const exportedJson = JSON.parse(exported.toString("utf8"));

  await page.getByRole("button", { name: "Delete local workspace" }).click();
  await page.getByRole("button", { name: "Delete everything" }).click();
  await expect(page.locator("#metric-ratio")).toHaveText(
    "0 evidence-bearing receipts / 0 sprints started",
  );
  await expect(page.locator("#history-empty")).toBeVisible();

  await page.locator("#import-file").setInputFiles({
    name: "workspace-export.json",
    mimeType: "application/json",
    buffer: exported,
  });
  await expect(page.locator("#import-status")).toContainText("Validated import merged successfully");
  await expect(page.locator("#metric-ratio")).toHaveText(
    "1 evidence-bearing receipt / 1 sprint started",
  );

  const beforeContradiction = await page.evaluate((key) => localStorage.getItem(key), storageKey);
  const contradictory = structuredClone(exportedJson);
  const contradictoryGoal = contradictory.state.goals[0];
  contradictoryGoal.outcome.observation = "x";
  contradictoryGoal.outcome.evidenceBearing = true;
  contradictoryGoal.outcome.actionKind = "could_not_start";
  contradictoryGoal.sprint.action.kind = "could_not_start";
  await page.locator("#import-file").setInputFiles({
    name: "contradictory.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(contradictory)),
  });
  await expect(page.locator("#import-status")).toContainText("Import rejected");
  await expect(page.locator("#metric-ratio")).toHaveText(
    "1 evidence-bearing receipt / 1 sprint started",
  );
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey))
    .toBe(beforeContradiction);

  await page.locator("#import-file").setInputFiles({
    name: "malformed.json",
    mimeType: "application/json",
    buffer: Buffer.from("{not-json"),
  });
  await expect(page.locator("#import-status")).toContainText("Import rejected");
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey))
    .toBe(beforeContradiction);

  await page.getByRole("button", { name: "Delete local workspace" }).click();
  await page.getByRole("button", { name: "Delete everything" }).click();
  const derivedSpoof = structuredClone(exportedJson);
  derivedSpoof.state.goals[0].outcome.observation = "x";
  derivedSpoof.state.goals[0].outcome.evidenceBearing = true;
  await page.locator("#import-file").setInputFiles({
    name: "derived-spoof.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(derivedSpoof)),
  });
  await expect(page.locator("#import-status")).toContainText("Validated import merged successfully");
  await expect(page.locator("#metric-ratio")).toHaveText(
    "0 evidence-bearing receipts / 1 sprint started",
  );

  await page.getByRole("button", { name: "Delete local workspace" }).click();
  await page.getByRole("button", { name: "Delete everything" }).click();
  const storageKeys = await page.evaluate(({ storage, recovery }) => ({
    primary: localStorage.getItem(storage),
    journal: localStorage.getItem(recovery),
  }), { storage: storageKey, recovery: journalKey });
  expect(storageKeys).toEqual({ primary: null, journal: null });
});
