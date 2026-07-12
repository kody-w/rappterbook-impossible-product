import assert from "node:assert/strict";
import test from "node:test";

import {
  CRITERION_VERDICTS,
  PROOF_PATTERNS,
  compileDraft,
  computeMetrics,
  createEmptyState,
  createExport,
  createLinkedDraft,
  deserializeWorkspace,
  findGoal,
  formatConfidenceDelta,
  formatMinutes,
  generatePlan,
  getRemainingSeconds,
  isEvidenceBearingObservation,
  mergeStates,
  parseImport,
  recordOutcome,
  recoverWorkspace,
  saveDraft,
  serializeWorkspace,
  shrinkDraft,
  startSprint,
  suggestSimplerPlan,
  updateDraftReview,
  validateIntake,
  validateOutcome,
  validatePlan,
} from "../src/core.mjs";

const validIntake = {
  goal: "Publish a clear landing page",
  obstacle: "I have no polished copy and only a few minutes",
  proofPattern: "make",
};

const startTime = Date.parse("2026-07-12T02:00:00.000Z");

function reviewedState(intake = validIntake) {
  return compileDraft(createEmptyState(), intake, {
    id: "draft-1",
    now: "2026-07-12T01:59:00.000Z",
  });
}

function runningState(intake = validIntake) {
  return startSprint(reviewedState(intake), {
    id: "sprint-1",
    now: "2026-07-12T02:00:00.000Z",
    nowMilliseconds: startTime,
  });
}

function evidenceInput(overrides = {}) {
  return {
    actionKind: "taken",
    status: "attempted",
    criterionVerdict: "inconclusive",
    observation: "The rough page opened but the headline remained unclear.",
    url: "",
    postConfidence: 40,
    ...overrides,
  };
}

function completedState(overrides = {}) {
  return recordOutcome(
    runningState(),
    "sprint-1",
    evidenceInput(overrides),
    "2026-07-12T02:04:00.000Z",
  );
}

test("two text inputs and one proof choice are sufficient for review", () => {
  const result = validateIntake(validIntake);
  assert.equal(result.valid, true);
  assert.equal(result.value.timeboxMinutes, 5);
  assert.equal(result.value.baselineConfidence, 30);
  assert.equal(result.value.why, "");
});

test("intake rejects an absent proof choice and meaningless text", () => {
  const result = validateIntake({
    goal: " ",
    obstacle: "...",
    proofPattern: "",
  });
  assert.equal(result.valid, false);
  assert.deepEqual(Object.keys(result.errors).sort(), [
    "goal",
    "obstacle",
    "proofPattern",
  ]);
});

test("every proof pattern deterministically compiles one concrete target and criterion", () => {
  for (const proofPattern of Object.keys(PROOF_PATTERNS)) {
    const input = { ...validIntake, proofPattern };
    const first = generatePlan(input);
    const second = generatePlan(input);
    assert.deepEqual(first, second);
    assert.match(first.mission, /^(Ask|Make|Check|Send) one /);
    assert.match(first.successCriterion, /Observed if/);
    assert.match(first.stopCondition, /5 minutes/);
    assert.ok(first.scope.value > first.scope.min);
  }
});

test("one-minute copy is grammatically singular", () => {
  const plan = generatePlan({ ...validIntake, timeboxMinutes: 1 });
  assert.match(plan.stopCondition, /after 1 minute,/);
  assert.doesNotMatch(plan.stopCondition, /1 minutes/);
  assert.equal(formatMinutes(1), "1 minute");
  assert.equal(formatMinutes(2), "2 minutes");
});

test("autosaved intake draft does not enter history or the metric denominator", () => {
  const state = saveDraft(createEmptyState(), {
    goal: "A partial goal",
    obstacle: "",
    proofPattern: "",
  }, {
    id: "draft-1",
    now: "2026-07-12T01:00:00.000Z",
  });
  assert.equal(state.draft.intake.goal, "A partial goal");
  assert.equal(state.goals.length, 0);
  assert.deepEqual(computeMetrics(state), {
    sprintsStarted: 0,
    evidenceBearingReceipts: 0,
    criterionLinkedEvidenceRate: 0,
    criterionLinkedEvidencePercent: 0,
  });
});

test("review edits remain draft-only until sprint start", () => {
  const state = reviewedState();
  const updated = updateDraftReview(state, {
    ...state.draft.intake,
    ...state.draft.plan,
    mission: "Make one rough clickable artifact with no more than 3 parts.",
    timeboxMinutes: 7,
    baselineConfidence: 25,
  }, "2026-07-12T01:59:30.000Z");
  assert.equal(updated.goals.length, 0);
  assert.equal(updated.draft.intake.timeboxMinutes, 7);
  assert.match(updated.draft.plan.mission, /^Make/);
});

test("scope reduction lowers the declared variable instead of prepending prose", () => {
  const before = reviewedState();
  const previousPlan = before.draft.plan;
  const after = shrinkDraft(before, "2026-07-12T01:59:30.000Z");
  assert.ok(after.draft.plan.scope.value < previousPlan.scope.value);
  assert.equal(after.draft.plan.scope.key, previousPlan.scope.key);
  assert.doesNotMatch(after.draft.plan.mission, /Do only the first|smaller slice/i);
  assert.equal(after.draft.revisions[0].type, "scope_reduction");
  assert.equal(after.draft.revisions[0].fromValue, 3);
  assert.equal(after.draft.revisions[0].toValue, 1);
});

test("declared scope cannot shrink below its explicit minimum", () => {
  const plan = generatePlan(validIntake);
  plan.scope.value = plan.scope.min;
  assert.throws(() => suggestSimplerPlan(plan), /already at its minimum/);
});

test("invalid edited mission cannot start", () => {
  const result = validatePlan({
    ...generatePlan(validIntake),
    mission: "",
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.mission);
});

test("starting creates one committed sprint and freezes the reviewed criterion", () => {
  const reviewed = reviewedState();
  const frozenCriterion = reviewed.draft.plan.successCriterion;
  const state = startSprint(reviewed, {
    id: "sprint-1",
    now: "2026-07-12T02:00:00.000Z",
    nowMilliseconds: startTime,
  });
  const goal = findGoal(state, "sprint-1");
  assert.equal(state.draft, null);
  assert.equal(goal.status, "running");
  assert.equal(goal.preregisteredPlan.successCriterion, frozenCriterion);
  assert.equal(goal.sprint.durationSeconds, 300);
  assert.equal(goal.sprint.endsAt, "2026-07-12T02:05:00.000Z");
  assert.equal(computeMetrics(state).sprintsStarted, 1);
});

test("remaining time derives from the frozen deadline and never becomes negative", () => {
  const endsAt = "2026-07-12T02:05:00.000Z";
  assert.equal(getRemainingSeconds(endsAt, startTime), 300);
  assert.equal(getRemainingSeconds(endsAt, startTime + 299_100), 1);
  assert.equal(getRemainingSeconds(endsAt, startTime + 400_000), 0);
  assert.equal(getRemainingSeconds("invalid", startTime), 0);
});

test("a two-character note and a URL alone are not evidence-bearing", () => {
  assert.equal(isEvidenceBearingObservation("ok"), false);
  assert.equal(isEvidenceBearingObservation("No access"), true);
  const shortNote = validateOutcome(evidenceInput({
    observation: "ok",
    url: "https://example.com/receipt",
  }));
  const urlOnly = validateOutcome(evidenceInput({
    observation: "",
    url: "https://example.com/receipt",
  }));
  assert.equal(shortNote.valid, false);
  assert.equal(urlOnly.valid, false);
  assert.ok(shortNote.errors.observation);
  assert.ok(urlOnly.errors.observation);
});

test("outcome validation separates action, activity status, criterion verdict, and observation", () => {
  const result = validateOutcome(evidenceInput());
  assert.equal(result.valid, true);
  assert.equal(result.value.actionKind, "taken");
  assert.equal(result.value.status, "attempted");
  assert.equal(result.value.criterionVerdict, "inconclusive");
  assert.match(result.value.observation, /rough page/);
});

test("could-not-start requires compassionate blocked status and verdict", () => {
  const invalid = validateOutcome(evidenceInput({
    actionKind: "could_not_start",
    status: "attempted",
    criterionVerdict: "not_observed",
    observation: "Account approval was unavailable.",
  }));
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.status);
  assert.ok(invalid.errors.criterionVerdict);

  const valid = validateOutcome(evidenceInput({
    actionKind: "could_not_start",
    status: "blocked",
    criterionVerdict: "blocked",
    observation: "Account approval was unavailable.",
  }));
  assert.equal(valid.valid, true);
});

test("recorded receipt preserves preregistration and action timing without claiming verification", () => {
  const before = runningState();
  const criterion = findGoal(before, "sprint-1").preregisteredPlan.successCriterion;
  const after = completedState();
  const goal = findGoal(after, "sprint-1");
  assert.equal(goal.preregisteredPlan.successCriterion, criterion);
  assert.equal(goal.sprint.action.kind, "taken");
  assert.equal(goal.sprint.action.elapsedSeconds, 240);
  assert.equal(goal.outcome.externalVerification, "not_independently_verified");
  assert.equal(goal.outcome.evidenceBearing, true);
  assert.equal(after.activeGoalId, null);
});

test("criterion-linked rate always exposes evidence receipts over sprints started", () => {
  const metrics = computeMetrics(completedState());
  assert.deepEqual(metrics, {
    sprintsStarted: 1,
    evidenceBearingReceipts: 1,
    criterionLinkedEvidenceRate: 1,
    criterionLinkedEvidencePercent: 100,
  });
});

test("next decisions are status-specific", async () => {
  const { recommendNextDecision } = await import("../src/core.mjs");
  assert.equal(recommendNextDecision(findGoal(completedState({
    status: "completed",
    criterionVerdict: "observed",
  }), "sprint-1")), "stop");
  assert.equal(recommendNextDecision(findGoal(completedState({
    status: "attempted",
    criterionVerdict: "observed",
  }), "sprint-1")), "continue");
  assert.equal(recommendNextDecision(findGoal(completedState({
    criterionVerdict: "not_observed",
  }), "sprint-1")), "revise_shrink");
  assert.equal(recommendNextDecision(findGoal(completedState({
    actionKind: "could_not_start",
    status: "blocked",
    criterionVerdict: "blocked",
    observation: "The account owner denied access.",
  }), "sprint-1")), "seek_access");
});

test("a linked successor preserves original receipt provenance and stays out of metrics", () => {
  const completed = completedState({ criterionVerdict: "not_observed" });
  const linked = createLinkedDraft(
    completed,
    "sprint-1",
    "revise_shrink",
    { id: "draft-2", now: "2026-07-12T02:05:00.000Z" },
  );
  assert.equal(linked.draft.predecessorId, "sprint-1");
  assert.equal(linked.draft.lineageRootId, "sprint-1");
  assert.equal(linked.draft.decision, "revise_shrink");
  assert.equal(findGoal(linked, "sprint-1").outcome.criterionVerdict, "not_observed");
  assert.equal(computeMetrics(linked).sprintsStarted, 1);
  assert.ok(linked.draft.plan.scope.value < linked.draft.originalPlan.scope.value);
});

test("workspace envelope round-trips with revision metadata", () => {
  const state = runningState();
  const serialized = serializeWorkspace(state, {
    revision: 7,
    writtenAt: "2026-07-12T02:01:00.000Z",
    writerId: "tab-a",
  });
  const parsed = deserializeWorkspace(serialized);
  assert.equal(parsed.revision, 7);
  assert.equal(parsed.writerId, "tab-a");
  assert.deepEqual(parsed.state, state);
});

test("one corrupt primary payload recovers the validated journal", () => {
  const state = completedState();
  const journal = serializeWorkspace(state, {
    revision: 8,
    writtenAt: "2026-07-12T02:05:00.000Z",
    writerId: "tab-a",
  });
  const recovered = recoverWorkspace("{bad", journal, null);
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.source, "journal");
  assert.deepEqual(recovered.state, state);
});

test("malformed import fails before state mutation and export round-trips", () => {
  const state = completedState();
  const exported = createExport(state, "2026-07-12T02:06:00.000Z");
  assert.deepEqual(parseImport(exported), state);
  assert.throws(() => parseImport("{bad"), /JSON/);
  assert.throws(
    () => parseImport(JSON.stringify({ format: "proof-of-possible-export", state: {} })),
    /valid Proof of Possible/,
  );
});

test("multi-tab merge preserves a committed receipt and frozen deadline", () => {
  const running = runningState();
  const completed = completedState();
  const staleOtherTab = {
    ...running,
    draft: saveDraft(running, {
      goal: "Draft from another tab",
      obstacle: "No account access",
      proofPattern: "ask",
    }, {
      id: "draft-other",
      now: "2026-07-12T02:05:00.000Z",
    }).draft,
  };
  const merged = mergeStates(completed, staleOtherTab);
  const goal = findGoal(merged, "sprint-1");
  assert.equal(goal.outcome.criterionVerdict, "inconclusive");
  assert.equal(goal.sprint.endsAt, "2026-07-12T02:05:00.000Z");
  assert.equal(merged.draft.id, "draft-other");
});

test("legacy v1 running sprint migrates without losing its deadline", () => {
  const legacy = {
    version: 1,
    activeGoalId: "legacy-1",
    goals: [{
      id: "legacy-1",
      createdAt: "2026-07-12T01:59:00.000Z",
      status: "running",
      intake: {
        goal: "Publish a clear landing page",
        obstacle: "No polished copy exists",
        proof: "A page opens",
        why: "Learn demand",
        timeboxMinutes: 5,
        baselineConfidence: 30,
      },
      originalPlan: {
        mission: "Make one rough page.",
        successCriterion: "A page opens.",
        stopCondition: "Stop after 5 minutes.",
      },
      currentPlan: {
        mission: "Make one rough page.",
        successCriterion: "A page opens.",
        stopCondition: "Stop after 5 minutes.",
      },
      revisions: [],
      sprint: {
        durationSeconds: 300,
        startedAt: "2026-07-12T02:00:00.000Z",
        endsAt: "2026-07-12T02:05:00.000Z",
      },
      outcome: null,
    }],
  };
  const migrated = recoverWorkspace(JSON.stringify(legacy), null, null);
  const goal = findGoal(migrated.state, "legacy-1");
  assert.equal(migrated.migrated, true);
  assert.equal(goal.status, "running");
  assert.equal(goal.sprint.endsAt, "2026-07-12T02:05:00.000Z");
  assert.equal(migrated.state.activeGoalId, "legacy-1");
});

test("confidence deltas remain explicit", () => {
  assert.equal(formatConfidenceDelta(15), "+15");
  assert.equal(formatConfidenceDelta(0), "0");
  assert.equal(formatConfidenceDelta(-15), "-15");
  assert.equal(CRITERION_VERDICTS.has("blocked"), true);
});
