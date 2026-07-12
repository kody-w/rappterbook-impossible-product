import { expect, test as base } from "@playwright/test";

const allowedOrigin = "http://127.0.0.1:4173";
const storageKey = "proof-of-possible:workspace:v3";
const journalKey = "proof-of-possible:journal:v3";
const frameTwoStorageKey = "proof-of-possible:workspace:v2";
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
    mission: /no more than 1 part that can expose/,
  },
  {
    label: "Check a real constraint",
    before: 3,
    after: 1,
    mission: /up to 1 explicit requirement that could/,
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

async function fillAssumption(page, options = {}) {
  await page.getByLabel("Decision this proof will inform").fill(
    options.goal ?? "Decide whether to publish the landing page",
  );
  await page.getByLabel("Target or unit").fill(
    options.target ?? "one first-time visitor",
  );
  await page.getByLabel("Uncertain assumption").fill(
    options.claim ?? "A first-time visitor can understand the concrete offer",
  );
  await page.getByLabel("Observable signal").fill(
    options.signal ?? "The visitor can state the offer without any prompting",
  );
  await page.getByLabel("Binding constraint").fill(
    options.obstacle ?? "I have no polished copy and only a few minutes",
  );
  await page.getByLabel(options.proofLabel ?? "Make a tiny artifact").check();
  if (options.routeLabel) {
    await page.getByLabel(options.routeLabel).check();
  }
  if (options.safetySensitive || options.outboundOptIn) {
    await page.getByText("Safety and retaliation controls").click();
  }
  if (options.safetySensitive) {
    await page.locator("#safetySensitive").check();
  }
  if (options.outboundOptIn) {
    await page.locator("#outboundOptIn").check();
  }
  await expect(page.locator("#draft-status")).toContainText("Draft saved");
}

async function freezeProbe(page, options = {}) {
  await page.getByRole("button", { name: "Compile one experiment" }).click();
  if (options.pacingMode) {
    await page.getByLabel("Pacing").selectOption(options.pacingMode);
  }
  if (options.minutes) {
    await page.getByLabel("Minute cap").selectOption(String(options.minutes));
  }
  await page.getByRole("button", { name: /^Freeze/ }).click();
  await expect(page.getByRole("heading", { name: "Copy the handoff, then begin." })).toBeVisible();
}

async function recordActionReceipt(page, options = {}) {
  await page.getByRole("button", {
    name: options.copy ? /Copy & begin/ : "Begin without copying",
  }).click();
  await expect(page.locator("#action-started-at")).not.toHaveText("Not begun");
  await page.getByRole("button", { name: "Record result" }).click();
  await page.getByLabel(options.status ?? "Completed").check();
  await page.locator(
    `[name="interpretation"][value="${options.interpretation ?? "supports"}"]`,
  ).check();
  await page.getByLabel("Why was this result diagnostic—or not?").selectOption(
    options.diagnosis ?? "none",
  );
  await page.getByLabel("Separate observation").fill(
    options.observation
      ?? "The visitor stated the concrete offer without prompting.",
  );
  if (options.postConfidence !== undefined) {
    await page.getByLabel("Confidence after the test").fill(
      String(options.postConfidence),
    );
  }
  await page.getByRole("button", { name: "Save criterion-linked receipt" }).click();
  await expect(page.getByRole("heading", { name: "Receipt and next decision" })).toBeVisible();
}

async function completeProbe(page, options = {}) {
  await fillAssumption(page, options);
  await freezeProbe(page, options);
  await recordActionReceipt(page, options);
}

async function resetWorkspace(page) {
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole("heading", {
    name: "What belief should this decision test?",
  })).toBeVisible();
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
        id: node.id,
        left: Math.round(node.getBoundingClientRect().left),
        right: Math.round(node.getBoundingClientRect().right),
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

function frameTwoEnvelope() {
  const recordedAt = "2026-07-12T02:04:00.000Z";
  const plan = {
    mission: "Make one rough artifact with no more than 3 parts.",
    successCriterion: "Observed if one concrete offer can be read.",
    stopCondition: "Stop after 5 minutes.",
    scope: {
      key: "artifactParts",
      label: "Artifact parts",
      value: 3,
      min: 1,
      unit: "parts",
    },
  };
  const state = {
    version: 2,
    goals: [{
      id: "frame2-goal",
      createdAt: "2026-07-12T02:00:00.000Z",
      updatedAt: recordedAt,
      status: "completed",
      intake: {
        goal: "Publish a clear landing page",
        obstacle: "No polished copy exists",
        proofPattern: "make",
        why: "",
        timeboxMinutes: 5,
        baselineConfidence: 30,
      },
      originalPlan: structuredClone(plan),
      preregisteredPlan: structuredClone(plan),
      revisions: [],
      sprint: {
        durationSeconds: 300,
        startedAt: "2026-07-12T02:00:00.000Z",
        endsAt: "2026-07-12T02:05:00.000Z",
        action: { kind: "taken", recordedAt, elapsedSeconds: 240 },
      },
      outcome: {
        status: "completed",
        actionKind: "taken",
        criterionVerdict: "observed",
        observation: "The concrete offer was visible on the rough page.",
        url: "",
        evidenceBearing: true,
        externalVerification: "not_independently_verified",
        postConfidence: 45,
        confidenceDelta: 15,
        recordedAt,
      },
      predecessorId: null,
      lineageRootId: "frame2-goal",
      decision: null,
    }],
    activeGoalId: null,
    draft: null,
    settings: {
      timerHidden: false,
      updatedAt: "2026-07-12T02:05:00.000Z",
    },
  };
  return {
    format: "proof-of-possible-workspace",
    schemaVersion: 2,
    revision: 4,
    writtenAt: "2026-07-12T02:06:00.000Z",
    writerId: "frame2-tab",
    state,
  };
}

test("built artifact exposes exact generated provenance and Frame 3 files", async ({ page }) => {
  await page.goto("/");
  const provenance = await page.evaluate(async () => {
    const response = await fetch("./provenance.json", { cache: "no-store" });
    return response.json();
  });
  expect(provenance.GITHUB_SHA).toMatch(/^[0-9a-f]{40}$/);
  expect(String(provenance.GITHUB_RUN_ID).length).toBeGreaterThan(0);
  expect(String(provenance.GITHUB_RUN_ATTEMPT).length).toBeGreaterThan(0);
  expect(provenance.contentDigest.value).toMatch(/^[0-9a-f]{64}$/);
  expect(provenance.files["src/app.mjs"]).toMatch(/^[0-9a-f]{64}$/);
  expect(provenance.files["evolution/frames/frame-03.json"]).toMatch(/^[0-9a-f]{64}$/);
  expect(provenance.files["evolution/strategies/frame-03/science.md"])
    .toMatch(/^[0-9a-f]{64}$/);
  await expect(page.locator("#release-provenance")).toContainText(
    provenance.GITHUB_SHA.slice(0, 12),
  );
  await expect(page.locator("footer")).toContainText("v3.0.0 · Frame 3");
});

test("assumption-first journey creates executable branches and distinct timestamps", async ({ page }) => {
  await page.goto("/");
  await fillAssumption(page);
  await page.reload();
  await expect(page.getByLabel("Uncertain assumption")).toHaveValue(
    "A first-time visitor can understand the concrete offer",
  );
  await page.getByRole("button", { name: "Compile one experiment" }).click();
  const beliefId = await page.locator("#review-context").textContent();
  expect(beliefId).toContain("belief-");
  await expect(page.getByLabel("Copy-ready payload or artifact/check skeleton"))
    .toHaveValue(/TINY ARTIFACT SKELETON/);
  await page.getByText("Directional interpretation branches").click();
  await expect(page.locator("#supportsBranch")).toHaveValue(/only if/);
  await page.getByRole("button", { name: /^Freeze/ }).click();
  await expect(page.getByRole("button", { name: "Record result" })).toBeDisabled();
  await page.waitForTimeout(20);
  await page.getByRole("button", { name: /Copy & begin/ }).click();
  await page.waitForTimeout(20);
  await page.getByRole("button", { name: "Record result" }).click();
  await page.getByLabel("Completed").check();
  await page.locator("#interpretation-supports").check();
  await page.getByLabel("Separate observation").fill(
    "The visitor stated the concrete offer without prompting.",
  );
  await page.getByRole("button", { name: "Save criterion-linked receipt" }).click();
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  const goal = stored.state.goals[0];
  expect(goal.sprint.startedAt).not.toBe(goal.sprint.actionStartedAt);
  expect(goal.sprint.actionStartedAt).not.toBe(goal.outcome.recordedAt);
  expect(goal.outcome.beliefCriterionMet).toBe(true);
  expect(goal.outcome.postConfidence).toBeNull();
  await expect(page.locator("#receipt")).toContainText("Not independently verified");
  await expect(page.locator("#receipt")).toContainText("Directional signal recorded");
});

test("unsafe ask stays private until explicit outbound opt-in", async ({ page }) => {
  await page.goto("/");
  await fillAssumption(page, {
    proofLabel: "Ask a real person",
    safetySensitive: true,
  });
  await page.getByRole("button", { name: "Compile one experiment" }).click();
  await expect(page.getByLabel("Barrier-aware route")).toHaveValue("prepare_private");
  await expect(page.getByLabel("Copy-ready payload or artifact/check skeleton"))
    .toHaveValue(/PRIVATE PREPARATION — DO NOT SEND/);

  await resetWorkspace(page);
  await fillAssumption(page, {
    proofLabel: "Ask a real person",
    safetySensitive: true,
    outboundOptIn: true,
  });
  await page.getByRole("button", { name: "Compile one experiment" }).click();
  await expect(page.getByLabel("Barrier-aware route")).toHaveValue("act_now");
  await expect(page.getByLabel("Copy-ready payload or artifact/check skeleton"))
    .toHaveValue(/^To:/);
});

test("untimed safe-stop saves nullable confidence and dignified evidence", async ({ page }) => {
  await page.goto("/");
  await fillAssumption(page, { routeLabel: "Stop safely" });
  await freezeProbe(page, { pacingMode: "untimed" });
  await expect(page.locator("#timer-label")).toHaveText("Untimed mode");
  await expect(page.locator("#sprint-timer")).toHaveText("—");
  await page.getByRole("button", { name: "Record barrier or safe stop" }).click();
  await expect(page.locator("#action-safe-stop")).toBeChecked();
  await expect(page.locator("#status-safe-stopped")).toBeChecked();
  await page.getByLabel("Separate observation").fill(
    "Retaliation risk made outbound contact unacceptable.",
  );
  await page.getByRole("button", { name: "Save criterion-linked receipt" }).click();
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  const goal = stored.state.goals[0];
  expect(goal.sprint.durationSeconds).toBeNull();
  expect(goal.sprint.endsAt).toBeNull();
  expect(goal.sprint.actionStartedAt).toBeNull();
  expect(goal.outcome.postConfidence).toBeNull();
  expect(goal.outcome.status).toBe("safe_stopped");
  await expect(page.locator("#receipt")).toContainText("Did not begin");
});

test("active-effort ask pauses while waiting for response", async ({ page }) => {
  await page.goto("/");
  await fillAssumption(page, { proofLabel: "Ask a real person" });
  await freezeProbe(page, { pacingMode: "active_effort", minutes: 1 });
  await page.getByRole("button", { name: "Begin without copying" }).click();
  await page.waitForTimeout(1100);
  await page.getByRole("button", {
    name: "Waiting for response—pause effort",
  }).click();
  const paused = await page.evaluate((key) => {
    const workspace = JSON.parse(localStorage.getItem(key));
    return workspace.state.goals[0].sprint.effort.accumulatedSeconds;
  }, storageKey);
  await page.waitForTimeout(1100);
  const stillPaused = await page.evaluate((key) => {
    const workspace = JSON.parse(localStorage.getItem(key));
    return workspace.state.goals[0].sprint.effort.accumulatedSeconds;
  }, storageKey);
  expect(stillPaused).toBe(paused);
  await expect(page.locator("#timer-note")).toContainText("waiting time does not count");
  await page.getByRole("button", { name: "Resume active effort" }).click();
  await page.waitForTimeout(1100);
  await page.getByRole("button", { name: "Record result" }).click();
  await page.getByLabel("Attempted").check();
  await page.locator('[name="interpretation"][value="inconclusive"]').check();
  await page.getByLabel("Why was this result diagnostic—or not?")
    .selectOption("absent_signal");
  await page.getByLabel("Separate observation").fill(
    "No response arrived during the observation window.",
  );
  await page.getByRole("button", { name: "Save criterion-linked receipt" }).click();
  const activeSeconds = await page.evaluate((key) => {
    const workspace = JSON.parse(localStorage.getItem(key));
    return workspace.state.goals[0].sprint.action.activeEffortSeconds;
  }, storageKey);
  expect(activeSeconds).toBeLessThan(10);
});

test("reasoned successor preserves belief ID and permits route/action changes", async ({ page }) => {
  await page.goto("/");
  await completeProbe(page, {
    status: "Attempted",
    interpretation: "inconclusive",
    diagnosis: "weak_test",
  });
  const before = await page.evaluate((key) => {
    const workspace = JSON.parse(localStorage.getItem(key));
    return workspace.state.goals[0].intake.assumption.id;
  }, storageKey);
  await expect(page.locator("#decision-primary")).toHaveText("Revise / pivot");
  await page.locator("#decision-primary").click();
  await expect(page.getByRole("heading", { name: "Review the executable probe" }))
    .toBeVisible();
  await expect(page.getByLabel("Proof action")).toHaveValue("ask");
  await page.getByLabel("Barrier-aware route").selectOption("prepare_private");
  await page.getByLabel("Proof action").selectOption("check");
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  expect(stored.state.draft.intake.assumption.id).toBe(before);
  expect(stored.state.draft.predecessorDecision).toBe("pivot");
  expect(stored.state.draft.intake.route).toBe("prepare_private");
  expect(stored.state.draft.intake.proofPattern).toBe("check");
  expect(stored.state.goals[0].decisions[0].kind).toBe("pivot");
});

test("duplicate low-information proof offers conclude, replicate, and pivot", async ({ page }) => {
  await page.goto("/");
  await completeProbe(page, {
    status: "Attempted",
    interpretation: "inconclusive",
    diagnosis: "weak_test",
  });
  await page.getByLabel("Reason (required for an override)").fill(
    "A deliberate same-test replication will check whether the ambiguity repeats.",
  );
  await page.getByText("All reasoned choices").click();
  await page.getByRole("button", { name: "Replicate deliberately" }).last().click();
  await page.getByRole("button", { name: /^Freeze/ }).click();
  await recordActionReceipt(page, {
    status: "Attempted",
    interpretation: "inconclusive",
    diagnosis: "weak_test",
    observation: "The same ambiguous visitor response appeared again.",
  });
  await expect(page.locator("#lineage-synthesis")).toContainText(
    "repeated without a discriminating change",
  );
  await expect(page.locator("#lineage-list > li")).toHaveCount(2);
  await expect(page.getByText("All reasoned choices")).toBeVisible();
  const decisionOptions = page.locator(".decision-options");
  if (!await decisionOptions.evaluate((details) => details.open)) {
    await page.getByText("All reasoned choices").click();
  }
  await expect(page.getByRole("button", { name: "Conclude / stop" }).last()).toBeVisible();
  await expect(page.getByRole("button", { name: "Replicate deliberately" }).last())
    .toBeVisible();
  await expect(page.getByRole("button", { name: "Revise / pivot" }).last()).toBeVisible();
});

test("contradictory receipts synthesize a mixed state without certainty", async ({ page }) => {
  await page.goto("/");
  await completeProbe(page);
  await page.getByLabel("Reason (required for an override)").fill(
    "A second independent observation may expose instability.",
  );
  await page.locator("#decision-secondary").click();
  await page.getByRole("button", { name: /^Freeze/ }).click();
  await recordActionReceipt(page, {
    status: "Completed",
    interpretation: "weakens",
    diagnosis: "none",
    observation: "The second visitor could not identify the concrete offer.",
  });
  await expect(page.locator("#lineage-state")).toHaveText("mixed");
  await expect(page.locator("#lineage-synthesis")).toContainText(
    "not statistically certain",
  );
  await expect(page.locator("#decision-brief")).toContainText("Contradiction detected");
});

test("Frame 2 local workspace migrates safely and removes old key", async ({ page }) => {
  const envelope = frameTwoEnvelope();
  await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, { key: frameTwoStorageKey, value: envelope });
  await page.goto("/");
  await expect(page.locator("#migration-notice")).toBeVisible();
  await expect(page.locator("#metric-ratio")).toHaveText(
    "1 evidence-bearing receipt / 1 sprint started",
  );
  await page.getByRole("button", { name: "View lineage" }).click();
  await expect(page.locator("#receipt")).toContainText("belief-frame2-goal");
  await expect(page.locator("#receipt")).toContainText(
    "Unknown in migrated Frame 2 data",
  );
  const keys = await page.evaluate(({ current, old }) => ({
    current: localStorage.getItem(current),
    old: localStorage.getItem(old),
  }), { current: storageKey, old: frameTwoStorageKey });
  expect(keys.current).not.toBeNull();
  expect(keys.old).toBeNull();
});

test("scope reduction still genuinely simplifies every proof pattern", async ({ page }) => {
  for (const pattern of proofPatterns) {
    await page.goto("/");
    await resetWorkspace(page);
    await fillAssumption(page, { proofLabel: pattern.label });
    await page.getByRole("button", { name: "Compile one experiment" }).click();
    await expect(page.locator("#scopeValue")).toHaveValue(String(pattern.before));
    await page.getByRole("button", { name: "Reduce declared scope" }).click();
    await expect(page.locator("#scopeValue")).toHaveValue(String(pattern.after));
    await expect(page.locator("#mission")).toHaveValue(pattern.mission);
    const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
    expect(stored.state.draft.revisions.at(-1).type).toBe("scope_reduction");
  }
});

test("skip link and decision lineage retain visible keyboard focus", async ({ page }) => {
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
  await expect(page.locator("#main-content")).toBeFocused();
  await completeProbe(page);
  await page.locator("#lineage-list").focus();
  await expect(page.locator("#lineage-list")).toBeFocused();
});

test("all populated states reflow at 320px and 200% text", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await fillAssumption(page, {
    goal: `Decide ${"G".repeat(110)}`,
    target: `Unit ${"T".repeat(120)}`,
    claim: `Assumption ${"C".repeat(170)}`,
    signal: `Signal ${"S".repeat(170)}`,
    obstacle: `Constraint ${"B".repeat(170)}`,
  });
  await assertNoHorizontalOverflow(page, "assumption intake");
  await page.getByRole("button", { name: "Compile one experiment" }).click();
  await page.getByText("Directional interpretation branches").click();
  await assertNoHorizontalOverflow(page, "review and branches");
  await page.getByRole("button", { name: /^Freeze/ }).click();
  await assertNoHorizontalOverflow(page, "frozen handoff");
  await page.getByRole("button", { name: "Begin without copying" }).click();
  await page.getByRole("button", { name: "Record result" }).click();
  await page.getByLabel("Completed").check();
  await page.locator("#interpretation-supports").check();
  await page.getByLabel("Separate observation").fill(
    `Visible signal ${"O".repeat(1000)}`,
  );
  await page.getByLabel("Supporting URL").fill(
    `https://example.com/${"u".repeat(1000)}`,
  );
  await assertNoHorizontalOverflow(page, "outcome");
  await page.getByRole("button", { name: "Save criterion-linked receipt" }).click();
  await assertNoHorizontalOverflow(page, "receipt lineage and decision brief");
});

test("primary, journal, and double-corruption recovery remain truthful", async ({ page }) => {
  await page.goto("/");
  await completeProbe(page);
  const newest = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
  newest.revision = 2;
  newest.writtenAt = "2026-07-12T05:02:00.000Z";
  newest.writerId = "newer-journal";
  const older = structuredClone(newest);
  older.revision = 1;
  older.writtenAt = "2026-07-12T05:01:00.000Z";
  older.writerId = "older-primary";
  older.state.goals = [];
  older.state.activeGoalId = null;
  await page.evaluate(({ primary, journal, storage, recovery }) => {
    localStorage.setItem(storage, JSON.stringify(primary));
    localStorage.setItem(recovery, JSON.stringify(journal));
  }, { primary: older, journal: newest, storage: storageKey, recovery: journalKey });
  await page.reload();
  await expect(page.locator("#recovery-warning")).toContainText(
    "newer validated journal revision (2)",
  );
  await expect(page.locator("#metric-ratio")).toContainText("1 evidence-bearing receipt");

  await page.evaluate(({ journal, storage, recovery }) => {
    localStorage.setItem(storage, "{bad");
    localStorage.setItem(recovery, JSON.stringify(journal));
  }, { journal: newest, storage: storageKey, recovery: journalKey });
  await page.reload();
  await expect(page.locator("#recovery-warning")).toContainText(
    "primary workspace was invalid",
  );

  await page.evaluate(({ storage, recovery }) => {
    localStorage.setItem(storage, "{bad");
    localStorage.setItem(recovery, "{\"also\":");
  }, { storage: storageKey, recovery: journalKey });
  await page.reload();
  await expect(page.locator("#reset-warning")).toContainText(
    "none passed semantic validation",
  );
  const corrupt = await page.evaluate(({ storage, recovery }) => ({
    primary: localStorage.getItem(storage),
    journal: localStorage.getItem(recovery),
  }), { storage: storageKey, recovery: journalKey });
  expect(corrupt).toEqual({ primary: "{bad", journal: "{\"also\":" });
});

test("export, delete, import, and adversarial import preserve decisions", async ({ page }) => {
  await page.goto("/");
  await completeProbe(page);
  await page.getByLabel("Reason (required for an override)").fill(
    "The first signal is enough for this reversible decision.",
  );
  await page.locator("#decision-primary").click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  const exported = await downloadBuffer(await downloadPromise);
  const exportedJson = JSON.parse(exported.toString("utf8"));
  await page.getByRole("button", { name: "Delete local workspace" }).click();
  await page.getByRole("button", { name: "Delete everything" }).click();
  await page.locator("#import-file").setInputFiles({
    name: "workspace-export.json",
    mimeType: "application/json",
    buffer: exported,
  });
  await expect(page.locator("#import-status")).toContainText(
    "Existing receipts and decisions were preserved",
  );
  const before = await page.evaluate((key) => localStorage.getItem(key), storageKey);
  const contradictory = structuredClone(exportedJson);
  contradictory.state.goals[0].outcome.actionKind = "could_not_start";
  contradictory.state.goals[0].sprint.action.kind = "could_not_start";
  await page.locator("#import-file").setInputFiles({
    name: "contradictory.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(contradictory)),
  });
  await expect(page.locator("#import-status")).toContainText("Import rejected");
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(before);
});

test("multi-tab storage event preserves committed receipt and belief lineage", async ({ page, context }) => {
  const secondPage = await context.newPage();
  await page.goto("/");
  await secondPage.goto("/");
  await completeProbe(page);
  await expect(secondPage.locator("#metric-ratio")).toHaveText(
    "1 evidence-bearing receipt / 1 sprint started",
  );
  await expect(secondPage.locator("#history-list")).toContainText(
    "A first-time visitor can understand the concrete offer",
  );
  await secondPage.getByRole("button", { name: "View lineage" }).click();
  await expect(secondPage.locator("#lineage-list > li")).toHaveCount(1);
  await secondPage.close();
});
