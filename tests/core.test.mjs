import assert from "node:assert/strict";
import test from "node:test";

import {
  computeMetrics,
  createEmptyState,
  createGoal,
  deserializeState,
  findGoal,
  formatConfidenceDelta,
  generatePlan,
  getRemainingSeconds,
  recordOutcome,
  serializeState,
  simplifyMission,
  startSprint,
  suggestSimplerPlan,
  validateIntake,
  validateOutcome,
  validatePlan,
} from "../src/core.mjs";

const validIntake = {
  goal: "Publish a clear landing page",
  why: "I need to learn whether the offer makes sense.",
  obstacle: "I only have ten minutes and no polished copy.",
  proof: "A stranger can open a public page with one concrete offer.",
  timeboxMinutes: 10,
  baselineConfidence: 35,
};

const startTime = Date.parse("2026-07-12T02:00:00.000Z");

function plannedState() {
  return createGoal(createEmptyState(), validIntake, {
    id: "goal-1",
    now: "2026-07-12T01:59:00.000Z",
  });
}

function runningState() {
  const state = plannedState();
  const goal = findGoal(state, "goal-1");
  return startSprint(state, goal.id, goal.currentPlan, startTime);
}

test("intake accepts all required fields at the allowed boundary", () => {
  const result = validateIntake(validIntake);
  assert.equal(result.valid, true);
  assert.equal(result.value.timeboxMinutes, 10);
});

test("intake rejects empty content, out-of-range timeboxes, and confidence", () => {
  const result = validateIntake({
    goal: " ",
    why: "...",
    obstacle: "",
    proof: "none",
    timeboxMinutes: 11,
    baselineConfidence: -1,
  });
  assert.equal(result.valid, false);
  assert.deepEqual(Object.keys(result.errors).sort(), [
    "baselineConfidence",
    "goal",
    "obstacle",
    "proof",
    "timeboxMinutes",
    "why",
  ]);
});

test("blank numeric fields are not silently treated as zero confidence", () => {
  const intake = validateIntake({ ...validIntake, baselineConfidence: "" });
  const outcome = validateOutcome({
    status: "attempted",
    note: "No response arrived.",
    url: "",
    postConfidence: "",
  });
  assert.equal(intake.valid, false);
  assert.ok(intake.errors.baselineConfidence);
  assert.equal(outcome.valid, false);
  assert.ok(outcome.errors.postConfidence);
});

test("mission generation is deterministic and contains proof and stop condition", () => {
  const first = generatePlan(validIntake);
  const second = generatePlan({ ...validIntake });
  assert.deepEqual(first, second);
  assert.match(first.mission, /smallest honest attempt/i);
  assert.match(first.successCriterion, /stranger can open/i);
  assert.match(first.stopCondition, /10 minutes/i);
});

test("plan validation prevents an empty edited mission", () => {
  const result = validatePlan({
    mission: "",
    successCriterion: "Looks good",
    stopCondition: "",
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.mission);
  assert.ok(result.errors.stopCondition);
});

test("creating a goal records the immutable original plan and metric denominator", () => {
  const state = plannedState();
  const goal = findGoal(state, "goal-1");
  assert.equal(goal.status, "planned");
  assert.deepEqual(goal.originalPlan, goal.currentPlan);
  assert.deepEqual(computeMetrics(state), {
    goalsCreated: 1,
    outcomesRecorded: 0,
    firstEvidenceRate: 0,
    firstEvidencePercent: 0,
  });
});

test("starting a sprint creates a wall-clock deadline capped by intake", () => {
  const state = runningState();
  const goal = findGoal(state, "goal-1");
  assert.equal(goal.status, "running");
  assert.equal(goal.sprint.durationSeconds, 600);
  assert.equal(goal.sprint.endsAt, "2026-07-12T02:10:00.000Z");
});

test("remaining time derives from the deadline and never becomes negative", () => {
  const endsAt = "2026-07-12T02:10:00.000Z";
  assert.equal(getRemainingSeconds(endsAt, startTime), 600);
  assert.equal(getRemainingSeconds(endsAt, startTime + 599_100), 1);
  assert.equal(getRemainingSeconds(endsAt, startTime + 700_000), 0);
  assert.equal(getRemainingSeconds("invalid", startTime), 0);
});

test("simplifying preserves original plan and appends provenance without resetting timer", () => {
  const state = runningState();
  const before = findGoal(state, "goal-1");
  const simpler = suggestSimplerPlan(before.currentPlan);
  const updated = simplifyMission(
    state,
    "goal-1",
    simpler,
    "The first version cannot fit the remaining time.",
    "2026-07-12T02:03:00.000Z",
  );
  const after = findGoal(updated, "goal-1");
  assert.deepEqual(after.originalPlan, before.originalPlan);
  assert.deepEqual(after.sprint, before.sprint);
  assert.equal(after.revisions.length, 1);
  assert.deepEqual(after.revisions[0].from, before.currentPlan);
  assert.deepEqual(after.revisions[0].to, simpler);
});

test("an unchanged mission is not accepted as a simplification", () => {
  const state = runningState();
  const goal = findGoal(state, "goal-1");
  assert.throws(
    () => simplifyMission(state, goal.id, goal.currentPlan, "Too large", "2026-07-12T02:02:00.000Z"),
    /Change at least one/,
  );
});

test("outcome requires a valid status, evidence, and post-confidence", () => {
  const invalid = validateOutcome({
    status: "success",
    note: "",
    url: "javascript:alert(1)",
    postConfidence: 101,
  });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.status);
  assert.ok(invalid.errors.url);
  assert.ok(invalid.errors.postConfidence);
});

test("blocked is valid evidence and updates confidence and First-Evidence Rate", () => {
  const completed = recordOutcome(runningState(), "goal-1", {
    status: "blocked",
    note: "The publishing account requires approval I do not control.",
    url: "",
    postConfidence: 20,
  }, "2026-07-12T02:06:00.000Z");
  const goal = findGoal(completed, "goal-1");
  assert.equal(goal.status, "blocked");
  assert.equal(goal.outcome.confidenceDelta, -15);
  assert.equal(completed.activeGoalId, null);
  assert.equal(computeMetrics(completed).firstEvidencePercent, 100);
});

test("a valid HTTPS evidence URL can replace a note", () => {
  const result = validateOutcome({
    status: "attempted",
    note: "",
    url: "https://example.com/evidence",
    postConfidence: 40,
  });
  assert.equal(result.valid, true);
});

test("serialization round-trips state and safely recovers corrupt storage", () => {
  const state = runningState();
  assert.deepEqual(deserializeState(serializeState(state)), {
    state,
    recovered: false,
  });
  const recovered = deserializeState("{bad json");
  assert.equal(recovered.recovered, true);
  assert.deepEqual(recovered.state, createEmptyState());
});

test("confidence deltas include an explicit plus sign only when positive", () => {
  assert.equal(formatConfidenceDelta(15), "+15");
  assert.equal(formatConfidenceDelta(0), "0");
  assert.equal(formatConfidenceDelta(-15), "-15");
});
