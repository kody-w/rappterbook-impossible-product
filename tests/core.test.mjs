import assert from "node:assert/strict";
import test from "node:test";

import {
  CRITERION_VERDICTS,
  PROOF_PATTERNS,
  STATE_VERSION,
  beginAction,
  changeDraftStrategy,
  compileDraft,
  computeMetrics,
  createEmptyState,
  createExport,
  createLinkedDraft,
  deserializeWorkspace,
  findGoal,
  formatConfidenceDelta,
  formatMinutes,
  formatScopeValue,
  generatePlan,
  getActiveEffortSeconds,
  getRemainingEffortSeconds,
  getRemainingSeconds,
  isEvidenceBearingObservation,
  mergeStates,
  parseImport,
  pauseForResponse,
  recommendNextDecision,
  recordDecision,
  recordOutcome,
  recoverWorkspace,
  resumeActiveEffort,
  saveDraft,
  serializeWorkspace,
  shrinkDraft,
  startSprint,
  suggestSimplerPlan,
  synthesizeLineage,
  updateDraftReview,
  validateIntake,
  validateOutcome,
  validatePlan,
} from "../src/core.mjs";

const validIntake = {
  goal: "Decide whether to publish the landing page",
  obstacle: "I have no polished copy and only a few minutes",
  proofPattern: "make",
  route: "act_now",
  pacingMode: "countdown",
  timeboxMinutes: 5,
  assumptionTarget: "one first-time visitor",
  assumptionClaim: "A first-time visitor can understand the concrete offer",
  assumptionSignal: "The visitor can state the offer without any prompting",
  baselineConfidence: "",
};
const startTime = Date.parse("2026-07-12T04:00:00.000Z");

function reviewedState(intake = validIntake, id = "draft-1") {
  return compileDraft(createEmptyState(), intake, {
    id,
    assumptionId: "belief-stable-1",
    now: "2026-07-12T03:59:00.000Z",
  });
}

function runningState(intake = validIntake, id = "probe-1") {
  return startSprint(reviewedState(intake), {
    id,
    now: "2026-07-12T04:00:00.000Z",
    nowMilliseconds: startTime,
  });
}

function begunState(intake = validIntake, id = "probe-1") {
  return beginAction(
    runningState(intake, id),
    id,
    "2026-07-12T04:01:00.000Z",
    "copy_begin",
  );
}

function evidenceInput(overrides = {}) {
  return {
    actionKind: "taken",
    status: "attempted",
    interpretation: "inconclusive",
    diagnosis: "weak_test",
    observation: "The rough page opened but the visitor signal remained ambiguous.",
    url: "",
    postConfidence: "",
    ...overrides,
  };
}

function completedState(overrides = {}, intake = validIntake, id = "probe-1") {
  return recordOutcome(
    begunState(intake, id),
    id,
    evidenceInput(overrides),
    "2026-07-12T04:04:00.000Z",
  );
}

function frameTwoState({ completed = true, withDraft = false } = {}) {
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
  const goal = {
    id: "frame2-goal",
    createdAt: "2026-07-12T02:00:00.000Z",
    updatedAt: completed ? recordedAt : "2026-07-12T02:00:00.000Z",
    status: completed ? "completed" : "running",
    intake: {
      goal: "Publish a clear landing page",
      obstacle: "No polished copy exists",
      proofPattern: "make",
      why: "Learn whether the offer is clear",
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
      action: completed
        ? { kind: "taken", recordedAt, elapsedSeconds: 240 }
        : null,
    },
    outcome: completed
      ? {
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
      }
      : null,
    predecessorId: null,
    lineageRootId: "frame2-goal",
    decision: null,
  };
  return {
    version: 2,
    goals: [goal],
    activeGoalId: completed ? null : goal.id,
    draft: withDraft
      ? {
        id: "frame2-draft",
        stage: "review",
        updatedAt: "2026-07-12T02:05:00.000Z",
        intake: structuredClone(goal.intake),
        plan: structuredClone(plan),
        originalPlan: structuredClone(plan),
        revisions: [],
        predecessorId: completed ? goal.id : null,
        lineageRootId: completed ? goal.id : null,
        decision: completed ? "continue" : null,
      }
      : null,
    settings: {
      timerHidden: false,
      updatedAt: "2026-07-12T02:05:00.000Z",
    },
  };
}

function frameTwoEnvelope(state = frameTwoState(), revision = 1) {
  return JSON.stringify({
    format: "proof-of-possible-workspace",
    schemaVersion: 2,
    revision,
    writtenAt: "2026-07-12T02:06:00.000Z",
    writerId: "frame2-tab",
    state,
  });
}

test("structured assumption is required and confidence is genuinely nullable", () => {
  const result = validateIntake(validIntake);
  assert.equal(result.valid, true);
  assert.equal(result.value.baselineConfidence, null);
  assert.equal(result.value.assumption.target, "one first-time visitor");
  assert.equal(result.value.assumption.decision, validIntake.goal);
});

test("intake rejects missing belief fields, proof, and meaningful text", () => {
  const result = validateIntake({
    goal: " ",
    obstacle: "...",
    proofPattern: "",
    assumptionTarget: "",
    assumptionClaim: "",
    assumptionSignal: "",
  });
  assert.equal(result.valid, false);
  for (const field of [
    "goal",
    "obstacle",
    "proofPattern",
    "assumptionTarget",
    "assumptionClaim",
    "assumptionSignal",
  ]) {
    assert.ok(result.errors[field], field);
  }
});

test("belief ID survives proof-pattern and route changes", () => {
  const reviewed = reviewedState();
  const changed = changeDraftStrategy(reviewed, {
    proofPattern: "check",
    route: "prepare_private",
  }, "2026-07-12T03:59:30.000Z");
  assert.equal(changed.draft.intake.assumption.id, "belief-stable-1");
  assert.equal(changed.draft.intake.proofPattern, "check");
  assert.equal(changed.draft.intake.route, "prepare_private");
});

test("every proof pattern compiles deterministic executable content and branches", () => {
  for (const proofPattern of Object.keys(PROOF_PATTERNS)) {
    const input = { ...validIntake, proofPattern };
    const first = generatePlan(input);
    const second = generatePlan(input);
    assert.deepEqual(first, second);
    assert.ok(first.artifactPayload.length > 30);
    assert.match(first.branches.supports, /only if/i);
    assert.match(first.branches.weakens, /weakens/i);
    assert.match(first.branches.inconclusive, /activity alone/i);
  }
});

test("opening, sending, or completing alone is explicitly excluded", () => {
  for (const proofPattern of Object.keys(PROOF_PATTERNS)) {
    const plan = generatePlan({ ...validIntake, proofPattern });
    assert.match(
      `${plan.artifactPayload} ${plan.branches.supports} ${plan.branches.inconclusive}`,
      /(alone (?:will not|does not)|activity alone)/i,
    );
  }
});

test("unsafe ask fixture cannot generate outbound contact without opt-in", () => {
  const plan = generatePlan({
    ...validIntake,
    proofPattern: "ask",
    route: "act_now",
    safetySensitive: true,
    outboundOptIn: false,
  });
  assert.equal(plan.route, "prepare_private");
  assert.equal(plan.outboundAllowed, false);
  assert.match(plan.artifactPayload, /PRIVATE PREPARATION — DO NOT SEND/);
  assert.match(plan.mission, /do not send/i);
});

test("unsafe seek-support route stays available but remains private", () => {
  const plan = generatePlan({
    ...validIntake,
    proofPattern: "send",
    route: "seek_support",
    safetySensitive: true,
    outboundOptIn: false,
  });
  assert.equal(plan.route, "seek_support");
  assert.equal(plan.outboundAllowed, false);
  assert.match(plan.artifactPayload, /DO NOT SEND/);
});

test("explicit outbound opt-in permits a copy-ready ask", () => {
  const plan = generatePlan({
    ...validIntake,
    proofPattern: "ask",
    safetySensitive: true,
    outboundOptIn: true,
  });
  assert.equal(plan.route, "act_now");
  assert.equal(plan.outboundAllowed, true);
  assert.match(plan.artifactPayload, /^To:/);
});

test("safe-stop route emits dignified evidence and no outbound requirement", () => {
  const plan = generatePlan({ ...validIntake, route: "safe_stop" });
  assert.equal(plan.outboundAllowed, false);
  assert.match(plan.mission, /safe-stop note/i);
  assert.match(plan.artifactPayload, /No outbound action is required/);
});

test("countdown, active-effort, and untimed pacing compile distinctly", () => {
  const countdown = generatePlan(validIntake);
  const active = generatePlan({ ...validIntake, pacingMode: "active_effort" });
  const untimed = generatePlan({ ...validIntake, pacingMode: "untimed" });
  assert.match(countdown.stopCondition, /5 minutes/);
  assert.match(active.stopCondition, /active effort; waiting does not count/);
  assert.match(untimed.stopCondition, /stop safely at any time/);
  assert.equal(validateIntake({ ...validIntake, pacingMode: "untimed", timeboxMinutes: "" }).value.timeboxMinutes, null);
});

test("one-minute copy remains grammatically singular", () => {
  const plan = generatePlan({ ...validIntake, timeboxMinutes: 1 });
  assert.match(plan.stopCondition, /after 1 minute,/);
  assert.doesNotMatch(plan.stopCondition, /1 minutes/);
  assert.equal(formatMinutes(1), "1 minute");
  assert.equal(formatMinutes(2), "2 minutes");
});

test("autosaved assumption draft stays out of history and denominator", () => {
  const state = saveDraft(createEmptyState(), {
    goal: "A partial decision",
    obstacle: "",
    proofPattern: "",
  }, {
    id: "draft-1",
    assumptionId: "belief-1",
    now: "2026-07-12T03:00:00.000Z",
  });
  assert.equal(state.goals.length, 0);
  assert.equal(computeMetrics(state).sprintsStarted, 0);
});

test("review edits remain draft-only", () => {
  const state = reviewedState();
  const updated = updateDraftReview(state, {
    ...state.draft.plan,
    mission: "Make one rough clickable artifact with no more than 3 parts.",
    pacingMode: "untimed",
    baselineConfidence: "",
  }, "2026-07-12T03:59:30.000Z");
  assert.equal(updated.goals.length, 0);
  assert.equal(updated.draft.intake.pacingMode, "untimed");
  assert.equal(updated.draft.intake.baselineConfidence, null);
});

test("scope reduction remains smaller and grammatical for every pattern", () => {
  const expectedMissions = {
    ask: /one question of 12 words or fewer/,
    make: /no more than 1 part that can expose/,
    check: /up to 1 explicit requirement that could/,
    send: /one reversible probe of 30 words or fewer/,
  };
  for (const proofPattern of Object.keys(PROOF_PATTERNS)) {
    const before = reviewedState({ ...validIntake, proofPattern });
    const first = shrinkDraft(before, "2026-07-12T03:59:30.000Z");
    assert.ok(first.draft.plan.scope.value < before.draft.plan.scope.value);
    assert.match(first.draft.plan.mission, expectedMissions[proofPattern]);
    assert.doesNotMatch(first.draft.plan.mission, /\b1 (?:parts|requirements|words)\b/i);
  }
  assert.equal(formatScopeValue(PROOF_PATTERNS.make.scope, 1), "1 part");
});

test("declared scope cannot shrink below minimum", () => {
  const plan = generatePlan(validIntake);
  plan.scope.value = plan.scope.min;
  assert.throws(() => suggestSimplerPlan(plan), /already at its minimum/);
});

test("all three interpretation branches and handoff are required", () => {
  const plan = generatePlan(validIntake);
  assert.equal(validatePlan({ ...plan, artifactPayload: "" }).valid, false);
  assert.equal(validatePlan({
    ...plan,
    branches: { ...plan.branches, weakens: "" },
  }).valid, false);
});

test("freezing creates a probe but does not invent an action start", () => {
  const state = runningState();
  const goal = findGoal(state, "probe-1");
  assert.equal(goal.sprint.startedAt, "2026-07-12T04:00:00.000Z");
  assert.equal(goal.sprint.actionStartedAt, null);
  assert.equal(goal.sprint.action, null);
  assert.equal(goal.intake.assumption.id, "belief-stable-1");
});

test("untimed mode stores no duration or deadline", () => {
  const state = runningState({ ...validIntake, pacingMode: "untimed" });
  const sprint = findGoal(state, "probe-1").sprint;
  assert.equal(sprint.pacingMode, "untimed");
  assert.equal(sprint.durationSeconds, null);
  assert.equal(sprint.endsAt, null);
});

test("Copy & begin records an idempotent action timestamp distinct from freeze", () => {
  const running = runningState();
  const begun = beginAction(running, "probe-1", "2026-07-12T04:01:00.000Z");
  const repeated = beginAction(begun, "probe-1", "2026-07-12T04:02:00.000Z");
  assert.equal(findGoal(begun, "probe-1").sprint.actionStartedAt, "2026-07-12T04:01:00.000Z");
  assert.deepEqual(repeated, begun);
});

test("remaining countdown derives from frozen deadline and never goes negative", () => {
  const endsAt = "2026-07-12T04:05:00.000Z";
  assert.equal(getRemainingSeconds(endsAt, startTime), 300);
  assert.equal(getRemainingSeconds(endsAt, startTime + 299_100), 1);
  assert.equal(getRemainingSeconds(endsAt, startTime + 400_000), 0);
});

test("ask waiting time does not count against active effort", () => {
  const intake = {
    ...validIntake,
    proofPattern: "ask",
    pacingMode: "active_effort",
  };
  let state = begunState(intake);
  state = pauseForResponse(state, "probe-1", "2026-07-12T04:01:30.000Z");
  let goal = findGoal(state, "probe-1");
  assert.equal(getActiveEffortSeconds(goal, "2026-07-12T04:03:30.000Z"), 30);
  assert.equal(getRemainingEffortSeconds(goal, "2026-07-12T04:03:30.000Z"), 270);
  state = resumeActiveEffort(state, "probe-1", "2026-07-12T04:04:00.000Z");
  goal = findGoal(state, "probe-1");
  assert.equal(getActiveEffortSeconds(goal, "2026-07-12T04:04:20.000Z"), 50);
});

test("non-contact proof cannot misuse response-wait pause", () => {
  const state = begunState({ ...validIntake, pacingMode: "active_effort" });
  assert.throws(
    () => pauseForResponse(state, "probe-1", "2026-07-12T04:02:00.000Z"),
    /only to ask or send/,
  );
});

test("short note and URL alone are not evidence-bearing", () => {
  assert.equal(isEvidenceBearingObservation("ok"), false);
  assert.equal(isEvidenceBearingObservation("No access"), true);
  assert.equal(validateOutcome(evidenceInput({
    observation: "ok",
    url: "https://example.com/receipt",
  })).valid, false);
});

test("blocked receipt accepts blank pre- and post-confidence", () => {
  const result = validateOutcome({
    actionKind: "could_not_start",
    status: "blocked",
    interpretation: "blocked",
    diagnosis: "blocked_access",
    observation: "Retaliation risk prevented safe contact.",
    url: "",
    postConfidence: "",
  });
  assert.equal(result.valid, true);
  assert.equal(result.value.postConfidence, null);
});

test("could-not-start requires compassionate blocked semantics", () => {
  const result = validateOutcome(evidenceInput({
    actionKind: "could_not_start",
    status: "attempted",
    interpretation: "weakens",
    observation: "Account approval was unavailable.",
  }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.status);
});

test("safe stop requires safe-stopped status", () => {
  const valid = validateOutcome(evidenceInput({
    actionKind: "safe_stop",
    status: "safe_stopped",
    interpretation: "blocked",
    diagnosis: "blocked_access",
    observation: "Contact would create unacceptable retaliation risk.",
  }));
  assert.equal(valid.valid, true);
  assert.equal(validateOutcome(evidenceInput({
    actionKind: "safe_stop",
    status: "completed",
    interpretation: "supports",
  })).valid, false);
});

test("inconclusive receipt requires an explicit diagnosis", () => {
  const result = validateOutcome(evidenceInput({ diagnosis: "none" }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.diagnosis);
});

test("taken outcome cannot be recorded before explicit begin", () => {
  assert.throws(
    () => recordOutcome(
      runningState(),
      "probe-1",
      evidenceInput(),
      "2026-07-12T04:04:00.000Z",
    ),
    /Copy & begin/,
  );
});

test("receipt separates freeze, action start, and receipt timestamps", () => {
  const goal = findGoal(completedState(), "probe-1");
  assert.equal(goal.sprint.startedAt, "2026-07-12T04:00:00.000Z");
  assert.equal(goal.sprint.actionStartedAt, "2026-07-12T04:01:00.000Z");
  assert.equal(goal.outcome.recordedAt, "2026-07-12T04:04:00.000Z");
  assert.equal(goal.sprint.action.elapsedSeconds, 180);
});

test("completion with an inconclusive signal does not satisfy belief criterion", () => {
  const goal = findGoal(completedState({ status: "completed" }), "probe-1");
  assert.equal(goal.outcome.evidenceBearing, true);
  assert.equal(goal.outcome.beliefCriterionMet, false);
});

test("directional observation after begin satisfies belief criterion without certainty claim", () => {
  const goal = findGoal(completedState({
    status: "completed",
    interpretation: "supports",
    diagnosis: "none",
    observation: "The visitor stated the concrete offer without prompting.",
  }), "probe-1");
  assert.equal(goal.outcome.beliefCriterionMet, true);
  assert.equal(goal.outcome.externalVerification, "not_independently_verified");
});

test("criterion-linked rate exposes receipts over probes and directional subset", () => {
  const metrics = computeMetrics(completedState({
    interpretation: "supports",
    diagnosis: "none",
  }));
  assert.deepEqual(metrics, {
    sprintsStarted: 1,
    evidenceBearingReceipts: 1,
    directionalReceipts: 1,
    criterionLinkedEvidenceRate: 1,
    criterionLinkedEvidencePercent: 100,
  });
});

test("diagnosis drives recommendations instead of generic shrinking", () => {
  const cases = [
    ["blocked_access", "blocked", "seek_support"],
    ["weak_test", "inconclusive", "pivot"],
    ["rival_explanation", "weakens", "pivot"],
    ["absent_signal", "weakens", "replicate"],
    ["none", "supports", "conclude"],
  ];
  for (const [diagnosis, interpretation, expected] of cases) {
    const overrides = interpretation === "blocked"
      ? {
        actionKind: "could_not_start",
        status: "blocked",
        observation: "Required access was unavailable.",
      }
      : {};
    const state = interpretation === "blocked"
      ? recordOutcome(
        runningState(),
        "probe-1",
        evidenceInput({ ...overrides, interpretation, diagnosis }),
        "2026-07-12T04:04:00.000Z",
      )
      : completedState({ interpretation, diagnosis });
    assert.equal(recommendNextDecision(findGoal(state, "probe-1")), expected);
  }
});

test("recommended post-receipt decision is persisted with a reason", () => {
  const completed = completedState({
    interpretation: "supports",
    diagnosis: "none",
  });
  const decided = recordDecision(
    completed,
    "probe-1",
    "conclude",
    "",
    "2026-07-12T04:05:00.000Z",
  );
  const decision = findGoal(decided, "probe-1").decisions[0];
  assert.equal(decision.kind, "conclude");
  assert.equal(decision.override, false);
  assert.match(decision.reason, /Accepted/);
});

test("override is rejected without reason and stored with reason", () => {
  const completed = completedState({
    interpretation: "supports",
    diagnosis: "none",
  });
  assert.throws(
    () => recordDecision(completed, "probe-1", "pivot", "", "2026-07-12T04:05:00.000Z"),
    /Explain why/,
  );
  const decided = recordDecision(
    completed,
    "probe-1",
    "pivot",
    "A rival explanation was noticed after review.",
    "2026-07-12T04:05:00.000Z",
  );
  assert.equal(findGoal(decided, "probe-1").decisions[0].override, true);
});

test("successor requires a persisted decision", () => {
  assert.throws(
    () => createLinkedDraft(
      completedState(),
      "probe-1",
      "pivot",
      { id: "draft-2", now: "2026-07-12T04:05:00.000Z" },
    ),
    /Record this post-receipt decision/,
  );
});

test("reasoned pivot preserves belief ID and changes the proof", () => {
  let state = completedState();
  state = recordDecision(
    state,
    "probe-1",
    "pivot",
    "",
    "2026-07-12T04:05:00.000Z",
  );
  state = createLinkedDraft(
    state,
    "probe-1",
    "pivot",
    { id: "draft-2", now: "2026-07-12T04:05:01.000Z" },
  );
  assert.equal(state.draft.intake.assumption.id, "belief-stable-1");
  assert.equal(state.draft.intake.proofPattern, "ask");
  assert.equal(state.draft.predecessorDecision, "pivot");
});

test("blocked successor can change route, action, and criterion", () => {
  let state = recordOutcome(
    runningState(),
    "probe-1",
    evidenceInput({
      actionKind: "could_not_start",
      status: "blocked",
      interpretation: "blocked",
      diagnosis: "blocked_access",
      observation: "Manager approval was not available.",
    }),
    "2026-07-12T04:04:00.000Z",
  );
  state = recordDecision(state, "probe-1", "seek_support", "", "2026-07-12T04:05:00.000Z");
  state = createLinkedDraft(
    state,
    "probe-1",
    "seek_support",
    { id: "draft-2", now: "2026-07-12T04:05:01.000Z" },
  );
  state = changeDraftStrategy(
    state,
    { proofPattern: "make", route: "prepare_private" },
    "2026-07-12T04:05:02.000Z",
  );
  state.draft.plan.branches.supports = "Supports only if a trusted reviewer confirms the accommodation path.";
  assert.equal(state.draft.intake.proofPattern, "make");
  assert.equal(state.draft.intake.route, "prepare_private");
  assert.match(state.draft.plan.branches.supports, /trusted reviewer/);
});

function appendSuccessorReceipt(state, firstDecision, secondOverrides) {
  const first = findGoal(state, "probe-1");
  state = recordDecision(
    state,
    first.id,
    firstDecision,
    firstDecision === recommendNextDecision(first) ? "" : "A deliberate replication will test stability.",
    "2026-07-12T04:05:00.000Z",
  );
  state = createLinkedDraft(
    state,
    first.id,
    firstDecision,
    { id: "draft-2", now: "2026-07-12T04:05:01.000Z" },
  );
  state = startSprint(state, {
    id: "probe-2",
    now: "2026-07-12T04:06:00.000Z",
    nowMilliseconds: Date.parse("2026-07-12T04:06:00.000Z"),
  });
  state = beginAction(state, "probe-2", "2026-07-12T04:07:00.000Z");
  return recordOutcome(
    state,
    "probe-2",
    evidenceInput(secondOverrides),
    "2026-07-12T04:09:00.000Z",
  );
}

test("two directional receipts synthesize contradiction deterministically", () => {
  const first = completedState({
    interpretation: "supports",
    diagnosis: "none",
  });
  const state = appendSuccessorReceipt(first, "replicate", {
    interpretation: "weakens",
    diagnosis: "none",
  });
  const synthesis = synthesizeLineage(state, "probe-1");
  assert.equal(synthesis.receiptCount, 2);
  assert.equal(synthesis.contradiction, true);
  assert.equal(synthesis.currentSupportState, "mixed");
  assert.match(synthesis.summary, /not statistically certain/);
});

test("duplicate low-information proofs are flagged after two receipts", () => {
  const first = completedState({
    interpretation: "inconclusive",
    diagnosis: "weak_test",
  });
  const state = appendSuccessorReceipt(first, "replicate", {
    interpretation: "inconclusive",
    diagnosis: "weak_test",
  });
  const synthesis = synthesizeLineage(state, "probe-1");
  assert.equal(synthesis.duplicateLowInformation, true);
  assert.equal(synthesis.repetitionCount, 1);
  assert.deepEqual(synthesis.choiceSet, ["conclude", "replicate", "pivot"]);
});

test("workspace envelope round-trips version 3 decisions and nullable confidence", () => {
  const state = completedState();
  const serialized = serializeWorkspace(state, {
    revision: 7,
    writtenAt: "2026-07-12T04:10:00.000Z",
    writerId: "tab-a",
  });
  const parsed = deserializeWorkspace(serialized);
  assert.equal(parsed.schemaVersion, STATE_VERSION);
  assert.equal(parsed.revision, 7);
  assert.deepEqual(parsed.state, state);
});

test("corrupt primary recovers the validated journal", () => {
  const state = completedState();
  const journal = serializeWorkspace(state, {
    revision: 8,
    writtenAt: "2026-07-12T04:10:00.000Z",
    writerId: "tab-a",
  });
  const recovered = recoverWorkspace("{bad", journal, null);
  assert.equal(recovered.recovered, true);
  assert.deepEqual(recovered.state, state);
});

test("recovery selects newest semantically valid revision", () => {
  const older = serializeWorkspace(createEmptyState(), {
    revision: 1,
    writtenAt: "2026-07-12T04:00:00.000Z",
    writerId: "tab-a",
  });
  const newer = serializeWorkspace(completedState(), {
    revision: 2,
    writtenAt: "2026-07-12T04:10:00.000Z",
    writerId: "tab-b",
  });
  const recovered = recoverWorkspace(older, newer, null);
  assert.equal(recovered.revision, 2);
  assert.equal(recovered.recoveryReason, "newer_journal");
});

test("double corruption reports an empty reset without false recovery", () => {
  const recovered = recoverWorkspace("{bad", "{\"also\":", null);
  assert.deepEqual(recovered.state, createEmptyState());
  assert.equal(recovered.recovered, false);
  assert.equal(recovered.reset, true);
});

test("export round-trips and malformed import fails", () => {
  const state = completedState();
  const exported = createExport(state, "2026-07-12T04:11:00.000Z");
  assert.deepEqual(parseImport(exported), state);
  assert.throws(() => parseImport("{bad"), /JSON/);
});

test("import recomputes evidence and confidence derived fields", () => {
  const exported = JSON.parse(createExport(
    completedState({ postConfidence: 40 }),
    "2026-07-12T04:11:00.000Z",
  ));
  exported.state.goals[0].outcome.observation = "x";
  exported.state.goals[0].outcome.evidenceBearing = true;
  exported.state.goals[0].outcome.beliefCriterionMet = true;
  exported.state.goals[0].outcome.confidenceDelta = 999;
  const imported = parseImport(JSON.stringify(exported));
  assert.equal(imported.goals[0].outcome.evidenceBearing, false);
  assert.equal(imported.goals[0].outcome.beliefCriterionMet, false);
  assert.equal(imported.goals[0].outcome.confidenceDelta, null);
});

test("contradictory import is rejected before mutation", () => {
  const existing = completedState();
  const snapshot = JSON.stringify(existing);
  const exported = JSON.parse(createExport(existing, "2026-07-12T04:11:00.000Z"));
  exported.state.goals[0].outcome.actionKind = "could_not_start";
  exported.state.goals[0].sprint.action.kind = "could_not_start";
  assert.throws(() => parseImport(JSON.stringify(exported)), /semantically valid/);
  assert.equal(JSON.stringify(existing), snapshot);
});

test("multi-tab merge preserves receipt, action start, deadline, and decisions", () => {
  let completed = completedState();
  completed = recordDecision(
    completed,
    "probe-1",
    "pivot",
    "",
    "2026-07-12T04:05:00.000Z",
  );
  const stale = runningState();
  const merged = mergeStates(completed, stale);
  const goal = findGoal(merged, "probe-1");
  assert.equal(goal.outcome.interpretation, "inconclusive");
  assert.equal(goal.sprint.actionStartedAt, "2026-07-12T04:01:00.000Z");
  assert.equal(goal.sprint.endsAt, "2026-07-12T04:05:00.000Z");
  assert.equal(goal.decisions.length, 1);
});

test("Frame 2 workspace migrates without inventing action-start time", () => {
  const migrated = recoverWorkspace(null, null, null, frameTwoEnvelope(), null);
  const goal = findGoal(migrated.state, "frame2-goal");
  assert.equal(migrated.migrated, true);
  assert.equal(migrated.state.version, 3);
  assert.equal(goal.intake.assumption.id, "belief-frame2-goal");
  assert.equal(goal.sprint.actionStartedAt, null);
  assert.equal(goal.sprint.actionStartSource, "frame2_receipt_unknown");
  assert.equal(goal.outcome.interpretation, "supports");
  assert.equal(goal.outcome.postConfidence, 45);
});

test("Frame 2 linked draft preserves lineage ID and migrates predecessor decision", () => {
  const migrated = recoverWorkspace(
    null,
    null,
    null,
    frameTwoEnvelope(frameTwoState({ withDraft: true })),
    null,
  );
  const goal = findGoal(migrated.state, "frame2-goal");
  assert.equal(migrated.state.draft.intake.assumption.id, goal.intake.assumption.id);
  assert.equal(migrated.state.draft.predecessorDecision, "continue");
  assert.equal(goal.decisions[0].kind, "continue");
});

test("Frame 2 export imports through explicit migration", () => {
  const imported = parseImport(JSON.stringify({
    format: "proof-of-possible-export",
    schemaVersion: 2,
    exportedAt: "2026-07-12T02:06:00.000Z",
    state: frameTwoState(),
  }));
  assert.equal(imported.version, 3);
  assert.equal(imported.goals[0].intake.assumption.id, "belief-frame2-goal");
});

test("legacy v1 running sprint migrates without losing deadline", () => {
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
  assert.equal(goal.sprint.endsAt, "2026-07-12T02:05:00.000Z");
  assert.equal(migrated.state.activeGoalId, "legacy-1");
});

test("confidence formatting and interpretation vocabulary remain explicit", () => {
  assert.equal(formatConfidenceDelta(15), "+15");
  assert.equal(formatConfidenceDelta(0), "0");
  assert.equal(formatConfidenceDelta(-15), "-15");
  assert.equal(formatConfidenceDelta(null), "Not provided");
  assert.equal(CRITERION_VERDICTS.has("blocked"), true);
});
