export const STATE_VERSION = 2;
export const STORAGE_KEY = "proof-of-possible:workspace:v2";
export const JOURNAL_KEY = "proof-of-possible:journal:v2";
export const LEGACY_STORAGE_KEY = "proof-of-possible:state:v1";
export const WORKSPACE_FORMAT = "proof-of-possible-workspace";
export const EXPORT_FORMAT = "proof-of-possible-export";
export const MAX_TIMEBOX_MINUTES = 10;

export const OUTCOME_STATUSES = new Set(["completed", "attempted", "blocked"]);
export const CRITERION_VERDICTS = new Set([
  "observed",
  "not_observed",
  "blocked",
  "inconclusive",
]);
export const ACTION_KINDS = new Set(["taken", "could_not_start"]);

export const PROOF_PATTERNS = Object.freeze({
  ask: {
    label: "Ask a real person",
    description: "Ask one relevant person one focused question.",
    scope: {
      key: "questionWords",
      label: "Question length",
      value: 24,
      min: 8,
      unit: "words",
    },
  },
  make: {
    label: "Make a tiny artifact",
    description: "Make one rough thing another person could open or inspect.",
    scope: {
      key: "artifactParts",
      label: "Artifact parts",
      value: 3,
      min: 1,
      unit: "parts",
    },
  },
  check: {
    label: "Check a real constraint",
    description: "Check one authoritative source for an explicit requirement.",
    scope: {
      key: "requirements",
      label: "Requirements checked",
      value: 3,
      min: 1,
      unit: "requirements",
    },
  },
  send: {
    label: "Send a reversible probe",
    description: "Send one small, reversible message to one real target.",
    scope: {
      key: "probeWords",
      label: "Probe length",
      value: 60,
      min: 15,
      unit: "words",
    },
  },
});

const TEXT_LIMITS = {
  goal: { min: 8, max: 240, label: "Goal" },
  obstacle: { min: 4, max: 400, label: "Binding constraint" },
};

const PLAN_LIMITS = {
  mission: { min: 8, max: 600, label: "Mission" },
  successCriterion: { min: 8, max: 400, label: "Success criterion" },
  stopCondition: { min: 8, max: 400, label: "Stop condition" },
};

const MAX_SERIALIZED_BYTES = 5_000_000;

function cleanText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function parseNumber(value) {
  if (value === "" || value === null || value === undefined) {
    return Number.NaN;
  }
  return Number(value);
}

function isMeaningful(value, minimum) {
  const text = cleanText(value);
  return text.length >= minimum && /[\p{L}\p{N}]/u.test(text);
}

function validateTextFields(values, limits) {
  const errors = {};
  for (const [field, rules] of Object.entries(limits)) {
    const value = cleanText(values[field]);
    if (!isMeaningful(value, rules.min)) {
      errors[field] = `${rules.label} must be at least ${rules.min} meaningful characters.`;
    } else if (value.length > rules.max) {
      errors[field] = `${rules.label} must be ${rules.max} characters or fewer.`;
    }
  }
  return errors;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeIntake(input = {}) {
  const timebox = parseNumber(input.timeboxMinutes);
  const confidence = parseNumber(input.baselineConfidence);
  return {
    goal: cleanText(input.goal),
    obstacle: cleanText(input.obstacle),
    proofPattern: cleanText(input.proofPattern),
    why: cleanText(input.why),
    timeboxMinutes: Number.isInteger(timebox) ? timebox : 5,
    baselineConfidence: Number.isInteger(confidence) ? confidence : 30,
  };
}

function normalizePlan(input = {}, fallbackScope = null) {
  const sourceScope = input.scope ?? fallbackScope ?? {};
  return {
    mission: cleanText(input.mission),
    successCriterion: cleanText(input.successCriterion),
    stopCondition: cleanText(input.stopCondition),
    scope: {
      key: cleanText(sourceScope.key),
      label: cleanText(sourceScope.label),
      value: parseNumber(sourceScope.value),
      min: parseNumber(sourceScope.min),
      unit: cleanText(sourceScope.unit),
    },
  };
}

function replaceGoal(state, updatedGoal, activeGoalId = state.activeGoalId) {
  return {
    ...state,
    goals: state.goals.map((goal) => goal.id === updatedGoal.id ? updatedGoal : goal),
    activeGoalId,
  };
}

function replaceScopePhrase(text, scope, nextValue) {
  const escapedUnit = scope.unit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\b${scope.value}\\s+${escapedUnit}\\b`, "i");
  if (pattern.test(text)) {
    return text.replace(pattern, `${nextValue} ${scope.unit}`);
  }
  return `${text.replace(/[.\s]+$/u, "")}. Limit ${scope.label.toLowerCase()} to ${nextValue} ${scope.unit}.`;
}

function uniqueRevisions(first = [], second = []) {
  const seen = new Set();
  return [...first, ...second].filter((revision) => {
    const key = JSON.stringify(revision);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function laterValue(first, second, dateKey) {
  if (!first) {
    return second;
  }
  if (!second) {
    return first;
  }
  return Date.parse(first[dateKey] ?? 0) >= Date.parse(second[dateKey] ?? 0)
    ? first
    : second;
}

function hasSafeUrl(value) {
  if (!value) {
    return true;
  }
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function isScopeShape(scope) {
  return scope
    && typeof scope === "object"
    && isMeaningful(scope.key, 1)
    && isMeaningful(scope.label, 1)
    && Number.isInteger(scope.value)
    && Number.isInteger(scope.min)
    && scope.min >= 1
    && scope.value >= scope.min
    && isMeaningful(scope.unit, 1);
}

function isPlanShape(plan, requireMeaningful = true) {
  if (!plan || typeof plan !== "object" || !isScopeShape(plan.scope)) {
    return false;
  }
  if (!requireMeaningful) {
    return ["mission", "successCriterion", "stopCondition"].every(
      (field) => typeof plan[field] === "string",
    );
  }
  return validateTextFields(plan, PLAN_LIMITS)
    && Object.keys(validateTextFields(plan, PLAN_LIMITS)).length === 0;
}

function isIntakeShape(intake, requireValid = true) {
  if (!intake || typeof intake !== "object") {
    return false;
  }
  const structural = ["goal", "obstacle", "proofPattern", "why"].every(
    (field) => typeof intake[field] === "string",
  )
    && Number.isInteger(intake.timeboxMinutes)
    && Number.isInteger(intake.baselineConfidence);
  return structural && (!requireValid || validateIntake(intake).valid);
}

function isOutcomeShape(outcome) {
  return outcome === null || (
    outcome
    && typeof outcome === "object"
    && OUTCOME_STATUSES.has(outcome.status)
    && ACTION_KINDS.has(outcome.actionKind)
    && CRITERION_VERDICTS.has(outcome.criterionVerdict)
    && typeof outcome.observation === "string"
    && typeof outcome.url === "string"
    && hasSafeUrl(outcome.url)
    && typeof outcome.evidenceBearing === "boolean"
    && outcome.externalVerification === "not_independently_verified"
    && Number.isInteger(outcome.postConfidence)
    && Number.isInteger(outcome.confidenceDelta)
    && typeof outcome.recordedAt === "string"
  );
}

function isGoalShape(goal) {
  return goal
    && typeof goal === "object"
    && typeof goal.id === "string"
    && typeof goal.createdAt === "string"
    && typeof goal.updatedAt === "string"
    && ["running", ...OUTCOME_STATUSES].includes(goal.status)
    && isIntakeShape(goal.intake)
    && isPlanShape(goal.originalPlan)
    && isPlanShape(goal.preregisteredPlan)
    && Array.isArray(goal.revisions)
    && goal.sprint
    && Number.isInteger(goal.sprint.durationSeconds)
    && typeof goal.sprint.startedAt === "string"
    && typeof goal.sprint.endsAt === "string"
    && (goal.sprint.action === null || (
      ACTION_KINDS.has(goal.sprint.action.kind)
      && typeof goal.sprint.action.recordedAt === "string"
      && Number.isInteger(goal.sprint.action.elapsedSeconds)
    ))
    && isOutcomeShape(goal.outcome)
    && (goal.predecessorId === null || typeof goal.predecessorId === "string")
    && typeof goal.lineageRootId === "string"
    && (goal.decision === null || typeof goal.decision === "string");
}

function isDraftShape(draft) {
  return draft === null || (
    draft
    && typeof draft === "object"
    && typeof draft.id === "string"
    && ["intake", "review"].includes(draft.stage)
    && typeof draft.updatedAt === "string"
    && isIntakeShape(draft.intake, false)
    && (draft.plan === null || isPlanShape(draft.plan, false))
    && (draft.originalPlan === null || isPlanShape(draft.originalPlan))
    && Array.isArray(draft.revisions)
    && (draft.predecessorId === null || typeof draft.predecessorId === "string")
    && (draft.lineageRootId === null || typeof draft.lineageRootId === "string")
    && (draft.decision === null || typeof draft.decision === "string")
  );
}

function isStateShape(value) {
  return value
    && typeof value === "object"
    && value.version === STATE_VERSION
    && Array.isArray(value.goals)
    && value.goals.length <= 10_000
    && value.goals.every(isGoalShape)
    && (value.activeGoalId === null || typeof value.activeGoalId === "string")
    && isDraftShape(value.draft)
    && value.settings
    && typeof value.settings.timerHidden === "boolean"
    && typeof value.settings.updatedAt === "string";
}

function parseSerialized(serialized) {
  if (typeof serialized !== "string" || serialized.length > MAX_SERIALIZED_BYTES) {
    throw new Error("Workspace payload is missing or too large.");
  }
  return JSON.parse(serialized);
}

function parseWorkspaceStrict(serialized) {
  const parsed = parseSerialized(serialized);
  if (parsed?.format === WORKSPACE_FORMAT) {
    if (parsed.schemaVersion !== STATE_VERSION
        || !Number.isInteger(parsed.revision)
        || parsed.revision < 0
        || typeof parsed.writtenAt !== "string"
        || typeof parsed.writerId !== "string"
        || !isStateShape(parsed.state)) {
      throw new Error("Workspace envelope failed validation.");
    }
    return parsed;
  }
  if (parsed?.version === STATE_VERSION && isStateShape(parsed)) {
    return {
      format: WORKSPACE_FORMAT,
      schemaVersion: STATE_VERSION,
      revision: 0,
      writtenAt: new Date(0).toISOString(),
      writerId: "unversioned",
      state: parsed,
    };
  }
  if (parsed?.version === 1) {
    return migrateVersionOne(parsed);
  }
  throw new Error("Unsupported workspace schema.");
}

function legacyScope() {
  return {
    key: "scopeUnits",
    label: "Scope units",
    value: 2,
    min: 1,
    unit: "units",
  };
}

function migrateLegacyPlan(plan = {}) {
  return {
    mission: cleanText(plan.mission) || "Check one real constraint for one explicit answer.",
    successCriterion: cleanText(plan.successCriterion)
      || "Observed if one explicit answer is available.",
    stopCondition: cleanText(plan.stopCondition) || "Stop after one answer or 5 minutes.",
    scope: legacyScope(),
  };
}

function migrateLegacyIntake(intake = {}) {
  return {
    goal: cleanText(intake.goal) || "Review this migrated proof mission",
    obstacle: cleanText(intake.obstacle) || "The original constraint was not recorded",
    proofPattern: "check",
    why: cleanText(intake.why),
    timeboxMinutes: Number.isInteger(intake.timeboxMinutes)
      ? Math.min(MAX_TIMEBOX_MINUTES, Math.max(1, intake.timeboxMinutes))
      : 5,
    baselineConfidence: Number.isInteger(intake.baselineConfidence)
      ? Math.min(100, Math.max(0, intake.baselineConfidence))
      : 30,
  };
}

function migrateLegacyGoal(goal) {
  const intake = migrateLegacyIntake(goal.intake);
  const originalPlan = migrateLegacyPlan(goal.originalPlan);
  const preregisteredPlan = migrateLegacyPlan(goal.currentPlan ?? goal.originalPlan);
  const hasOutcome = Boolean(goal.outcome);
  const recordedAt = goal.outcome?.recordedAt ?? goal.sprint?.startedAt ?? goal.createdAt;
  const status = OUTCOME_STATUSES.has(goal.outcome?.status)
    ? goal.outcome.status
    : hasOutcome && OUTCOME_STATUSES.has(goal.status) ? goal.status : "running";
  const actionKind = status === "blocked" ? "could_not_start" : "taken";
  const criterionVerdict = status === "completed"
    ? "observed"
    : status === "blocked" ? "blocked" : "inconclusive";
  const observation = cleanText(goal.outcome?.note);
  const url = hasSafeUrl(goal.outcome?.url) ? cleanText(goal.outcome?.url) : "";
  const evidenceBearing = isEvidenceBearingObservation(observation);
  const postConfidence = Number.isInteger(goal.outcome?.postConfidence)
    ? goal.outcome.postConfidence
    : intake.baselineConfidence;
  const startedAt = goal.sprint?.startedAt ?? goal.createdAt;
  const endsAt = goal.sprint?.endsAt
    ?? new Date(Date.parse(startedAt) + intake.timeboxMinutes * 60_000).toISOString();
  const elapsedSeconds = Math.max(
    0,
    Math.round((Date.parse(recordedAt) - Date.parse(startedAt)) / 1000) || 0,
  );
  const action = hasOutcome
    ? { kind: actionKind, recordedAt, elapsedSeconds }
    : null;
  const outcome = hasOutcome
    ? {
      status,
      actionKind,
      criterionVerdict,
      observation,
      url,
      evidenceBearing,
      externalVerification: "not_independently_verified",
      postConfidence,
      confidenceDelta: postConfidence - intake.baselineConfidence,
      recordedAt,
    }
    : null;
  return {
    id: goal.id,
    createdAt: goal.createdAt,
    updatedAt: recordedAt,
    status,
    intake,
    originalPlan,
    preregisteredPlan,
    revisions: Array.isArray(goal.revisions) ? goal.revisions : [],
    sprint: {
      durationSeconds: intake.timeboxMinutes * 60,
      startedAt,
      endsAt,
      action,
    },
    outcome,
    predecessorId: null,
    lineageRootId: goal.id,
    decision: null,
  };
}

function migrateVersionOne(legacy) {
  const planned = legacy.goals?.find(
    (goal) => goal.id === legacy.activeGoalId && goal.status === "planned",
  );
  const goals = (legacy.goals ?? [])
    .filter((goal) => goal.sprint || goal.outcome)
    .map(migrateLegacyGoal);
  const draft = planned
    ? {
      id: planned.id,
      stage: "review",
      updatedAt: planned.createdAt,
      intake: migrateLegacyIntake(planned.intake),
      plan: migrateLegacyPlan(planned.currentPlan),
      originalPlan: migrateLegacyPlan(planned.originalPlan),
      revisions: Array.isArray(planned.revisions) ? planned.revisions : [],
      predecessorId: null,
      lineageRootId: null,
      decision: null,
    }
    : null;
  const running = goals.find((goal) => goal.id === legacy.activeGoalId && goal.outcome === null);
  const state = {
    version: STATE_VERSION,
    goals,
    activeGoalId: running?.id ?? null,
    draft,
    settings: { timerHidden: false, updatedAt: new Date(0).toISOString() },
  };
  return {
    format: WORKSPACE_FORMAT,
    schemaVersion: STATE_VERSION,
    revision: 0,
    writtenAt: new Date().toISOString(),
    writerId: "migration-v1",
    state,
    migrated: true,
  };
}

export function formatMinutes(minutes) {
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

export function createEmptyState() {
  return {
    version: STATE_VERSION,
    goals: [],
    activeGoalId: null,
    draft: null,
    settings: {
      timerHidden: false,
      updatedAt: new Date(0).toISOString(),
    },
  };
}

export function validateIntake(input) {
  const intake = normalizeIntake(input);
  const errors = validateTextFields(intake, TEXT_LIMITS);
  if (!Object.hasOwn(PROOF_PATTERNS, intake.proofPattern)) {
    errors.proofPattern = "Choose one proof pattern.";
  }
  if (intake.why.length > 400) {
    errors.why = "Why it matters must be 400 characters or fewer.";
  }
  if (!Number.isInteger(intake.timeboxMinutes)
      || intake.timeboxMinutes < 1
      || intake.timeboxMinutes > MAX_TIMEBOX_MINUTES) {
    errors.timeboxMinutes = `Choose a whole-number timebox from 1 to ${MAX_TIMEBOX_MINUTES} minutes.`;
  }
  if (!Number.isInteger(intake.baselineConfidence)
      || intake.baselineConfidence < 0
      || intake.baselineConfidence > 100) {
    errors.baselineConfidence = "Confidence must be a whole number from 0 to 100.";
  }
  return { valid: Object.keys(errors).length === 0, errors, value: intake };
}

export function generatePlan(input) {
  const validation = validateIntake(input);
  if (!validation.valid) {
    throw new Error("Cannot compile a mission from invalid intake.");
  }
  const intake = validation.value;
  const pattern = PROOF_PATTERNS[intake.proofPattern];
  const scope = clone(pattern.scope);
  const quotedGoal = `“${intake.goal}”`;
  const quotedConstraint = `“${intake.obstacle}”`;
  let mission;
  let successCriterion;

  if (intake.proofPattern === "ask") {
    mission = `Ask one relevant person one question of ${scope.value} ${scope.unit} or fewer about whether ${quotedGoal} can move within ${quotedConstraint}.`;
    successCriterion = "Observed if that person gives one specific answer; not observed if no answer arrives.";
  } else if (intake.proofPattern === "make") {
    mission = `Make one rough artifact with no more than ${scope.value} ${scope.unit} that demonstrates ${quotedGoal} while respecting ${quotedConstraint}.`;
    successCriterion = "Observed if one artifact can be opened or shown and contains at least one concrete part.";
  } else if (intake.proofPattern === "check") {
    mission = `Check one authoritative source for up to ${scope.value} explicit ${scope.unit} affecting ${quotedGoal} under ${quotedConstraint}.`;
    successCriterion = "Observed if the source gives an explicit yes, no, threshold, or requirement.";
  } else {
    mission = `Send one reversible probe of ${scope.value} ${scope.unit} or fewer about ${quotedGoal} to one real target while honoring ${quotedConstraint}.`;
    successCriterion = "Observed if the probe is sent and its delivery or response state is visible.";
  }

  return {
    mission,
    successCriterion,
    stopCondition: `Stop when the criterion can be judged or after ${formatMinutes(intake.timeboxMinutes)}, whichever comes first.`,
    scope,
  };
}

export function validatePlan(input) {
  const plan = normalizePlan(input, input?.scope);
  const errors = validateTextFields(plan, PLAN_LIMITS);
  if (!isScopeShape(plan.scope)) {
    errors.scope = "Scope must be a whole number at or above its stated minimum.";
  }
  return { valid: Object.keys(errors).length === 0, errors, value: plan };
}

export function saveDraft(state, input, metadata) {
  if (!metadata?.id || !metadata?.now) {
    throw new Error("Draft metadata requires an id and timestamp.");
  }
  const existing = state.draft;
  const draft = {
    id: existing?.id ?? metadata.id,
    stage: "intake",
    updatedAt: metadata.now,
    intake: normalizeIntake(input),
    plan: null,
    originalPlan: existing?.originalPlan ?? null,
    revisions: existing?.revisions ?? [],
    predecessorId: existing?.predecessorId ?? null,
    lineageRootId: existing?.lineageRootId ?? null,
    decision: existing?.decision ?? null,
  };
  return { ...state, draft };
}

export function compileDraft(state, input, metadata) {
  const validation = validateIntake(input);
  if (!validation.valid) {
    throw new Error("Cannot compile an invalid draft.");
  }
  if (!metadata?.id || !metadata?.now) {
    throw new Error("Draft metadata requires an id and timestamp.");
  }
  const plan = generatePlan(validation.value);
  const existing = state.draft;
  const draft = {
    id: existing?.id ?? metadata.id,
    stage: "review",
    updatedAt: metadata.now,
    intake: validation.value,
    plan,
    originalPlan: clone(plan),
    revisions: [],
    predecessorId: existing?.predecessorId ?? null,
    lineageRootId: existing?.lineageRootId ?? null,
    decision: existing?.decision ?? null,
  };
  return { ...state, draft };
}

export function updateDraftReview(state, input, now) {
  if (!state.draft || state.draft.stage !== "review" || !state.draft.plan) {
    throw new Error("There is no review draft to update.");
  }
  const plan = normalizePlan(input, state.draft.plan.scope);
  const intake = normalizeIntake({ ...state.draft.intake, ...input });
  return {
    ...state,
    draft: {
      ...state.draft,
      updatedAt: now,
      intake,
      plan,
    },
  };
}

export function suggestSimplerPlan(planInput) {
  const validation = validatePlan(planInput);
  if (!validation.valid) {
    throw new Error("Cannot simplify an invalid mission.");
  }
  const plan = validation.value;
  if (plan.scope.value <= plan.scope.min) {
    throw new Error(`${plan.scope.label} is already at its minimum.`);
  }
  const nextValue = Math.max(plan.scope.min, Math.floor(plan.scope.value / 2));
  return {
    ...plan,
    mission: replaceScopePhrase(plan.mission, plan.scope, nextValue),
    scope: { ...plan.scope, value: nextValue },
  };
}

export function shrinkDraft(state, now) {
  if (!state.draft?.plan) {
    throw new Error("There is no mission to shrink.");
  }
  const from = clone(state.draft.plan);
  const to = suggestSimplerPlan(from);
  const revision = {
    type: "scope_reduction",
    recordedAt: now,
    reason: `${from.scope.label} reduced from ${from.scope.value} to ${to.scope.value} ${to.scope.unit}.`,
    scopeKey: from.scope.key,
    fromValue: from.scope.value,
    toValue: to.scope.value,
    from,
    to: clone(to),
  };
  return {
    ...state,
    draft: {
      ...state.draft,
      plan: to,
      updatedAt: now,
      revisions: [...state.draft.revisions, revision],
    },
  };
}

export function discardDraft(state) {
  return { ...state, draft: null };
}

export function findGoal(state, goalId) {
  return state.goals.find((goal) => goal.id === goalId) ?? null;
}

export function startSprint(state, metadata) {
  const draft = state.draft;
  if (!draft?.plan || !draft.originalPlan || draft.stage !== "review") {
    throw new Error("A reviewed draft is required before starting.");
  }
  const intakeValidation = validateIntake(draft.intake);
  const planValidation = validatePlan(draft.plan);
  if (!intakeValidation.valid || !planValidation.valid) {
    throw new Error("Cannot start with an invalid intake or mission.");
  }
  if (!metadata?.id || !metadata?.now || !Number.isFinite(metadata.nowMilliseconds)) {
    throw new Error("Sprint metadata requires an id and valid timestamps.");
  }

  const finalPlan = planValidation.value;
  const revisions = [...draft.revisions];
  const lastPlan = revisions.at(-1)?.to ?? draft.originalPlan;
  if (JSON.stringify(lastPlan) !== JSON.stringify(finalPlan)) {
    revisions.push({
      type: "edited_before_start",
      recordedAt: metadata.now,
      reason: "Edited before preregistration.",
      from: clone(lastPlan),
      to: clone(finalPlan),
    });
  }

  const durationSeconds = intakeValidation.value.timeboxMinutes * 60;
  const goalId = metadata.id;
  const goal = {
    id: goalId,
    createdAt: metadata.now,
    updatedAt: metadata.now,
    status: "running",
    intake: intakeValidation.value,
    originalPlan: clone(draft.originalPlan),
    preregisteredPlan: clone(finalPlan),
    revisions,
    sprint: {
      durationSeconds,
      startedAt: metadata.now,
      endsAt: new Date(metadata.nowMilliseconds + durationSeconds * 1000).toISOString(),
      action: null,
    },
    outcome: null,
    predecessorId: draft.predecessorId,
    lineageRootId: draft.lineageRootId ?? goalId,
    decision: draft.decision,
  };
  return {
    ...state,
    goals: [...state.goals, goal],
    activeGoalId: goal.id,
    draft: null,
  };
}

export function getRemainingSeconds(endsAt, nowMilliseconds = Date.now()) {
  const endMilliseconds = Date.parse(endsAt);
  if (!Number.isFinite(endMilliseconds) || !Number.isFinite(nowMilliseconds)) {
    return 0;
  }
  return Math.max(0, Math.ceil((endMilliseconds - nowMilliseconds) / 1000));
}

export function isEvidenceBearingObservation(value) {
  const observation = cleanText(value);
  const tokens = observation.match(/[\p{L}\p{N}]+/gu) ?? [];
  return observation.length >= 8 && tokens.length >= 2;
}

export function validateOutcome(input) {
  const actionKind = cleanText(input.actionKind);
  const status = cleanText(input.status).toLowerCase();
  const criterionVerdict = cleanText(input.criterionVerdict).toLowerCase();
  const observation = cleanText(input.observation);
  const url = cleanText(input.url);
  const postConfidence = parseNumber(input.postConfidence);
  const errors = {};

  if (!ACTION_KINDS.has(actionKind)) {
    errors.actionKind = "Choose whether you took the action or could not start.";
  }
  if (!OUTCOME_STATUSES.has(status)) {
    errors.status = "Choose completed, attempted, or blocked.";
  }
  if (!CRITERION_VERDICTS.has(criterionVerdict)) {
    errors.criterionVerdict = "Judge the preregistered criterion.";
  }
  if (!isEvidenceBearingObservation(observation)) {
    errors.observation = "Record at least two meaningful words (8 or more characters). A URL alone is not evidence-bearing.";
  }
  if (observation.length > 2000) {
    errors.observation = "Observation must be 2,000 characters or fewer.";
  }
  if (!hasSafeUrl(url)) {
    errors.url = "Enter a complete HTTP(S) URL.";
  }
  if (!Number.isInteger(postConfidence)
      || postConfidence < 0
      || postConfidence > 100) {
    errors.postConfidence = "Confidence must be a whole number from 0 to 100.";
  }
  if (actionKind === "could_not_start" && status !== "blocked") {
    errors.status = "Could not start must be recorded compassionately as blocked.";
  }
  if (actionKind === "could_not_start" && criterionVerdict !== "blocked") {
    errors.criterionVerdict = "Could not start means the criterion was blocked.";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    value: {
      actionKind,
      status,
      criterionVerdict,
      observation,
      url,
      postConfidence,
    },
  };
}

export function recordOutcome(state, goalId, input, now) {
  const goal = findGoal(state, goalId);
  if (!goal || goal.status !== "running" || goal.outcome) {
    throw new Error("Only a running mission can record evidence.");
  }
  const validation = validateOutcome(input);
  if (!validation.valid) {
    throw new Error("Cannot record invalid criterion-linked evidence.");
  }
  const recordedMilliseconds = Date.parse(now);
  const startedMilliseconds = Date.parse(goal.sprint.startedAt);
  const elapsedSeconds = Math.max(
    0,
    Math.round((recordedMilliseconds - startedMilliseconds) / 1000),
  );
  const outcome = {
    ...validation.value,
    evidenceBearing: isEvidenceBearingObservation(validation.value.observation),
    externalVerification: "not_independently_verified",
    confidenceDelta: validation.value.postConfidence - goal.intake.baselineConfidence,
    recordedAt: now,
  };
  const updatedGoal = {
    ...goal,
    status: outcome.status,
    updatedAt: now,
    sprint: {
      ...goal.sprint,
      action: {
        kind: outcome.actionKind,
        recordedAt: now,
        elapsedSeconds,
      },
    },
    outcome,
  };
  return replaceGoal(state, updatedGoal, null);
}

export function computeMetrics(state) {
  const sprintsStarted = state.goals.length;
  const evidenceBearingReceipts = state.goals.filter(
    (goal) => goal.outcome?.evidenceBearing
      && CRITERION_VERDICTS.has(goal.outcome.criterionVerdict),
  ).length;
  const criterionLinkedEvidenceRate = sprintsStarted === 0
    ? 0
    : evidenceBearingReceipts / sprintsStarted;
  return {
    sprintsStarted,
    evidenceBearingReceipts,
    criterionLinkedEvidenceRate,
    criterionLinkedEvidencePercent: Math.round(criterionLinkedEvidenceRate * 100),
  };
}

export function recommendNextDecision(goal) {
  if (!goal?.outcome) {
    throw new Error("A receipt is required before choosing a next decision.");
  }
  if (goal.outcome.actionKind === "could_not_start"
      || goal.outcome.criterionVerdict === "blocked") {
    return "seek_access";
  }
  if (goal.outcome.criterionVerdict === "observed") {
    return goal.outcome.status === "completed" ? "stop" : "continue";
  }
  return "revise_shrink";
}

export function createLinkedDraft(state, goalId, decision, metadata) {
  const goal = findGoal(state, goalId);
  if (!goal?.outcome) {
    throw new Error("A completed receipt is required to create a successor.");
  }
  if (!["continue", "revise_shrink", "seek_access"].includes(decision)) {
    throw new Error("Unknown successor decision.");
  }
  const intake = {
    ...goal.intake,
    proofPattern: decision === "seek_access" ? "check" : goal.intake.proofPattern,
    obstacle: decision === "seek_access"
      ? `Access needed before this constraint can be tested: ${goal.intake.obstacle}`
      : goal.intake.obstacle,
  };
  const originalPlan = generatePlan(intake);
  let plan = clone(originalPlan);
  const revisions = [];
  if (decision === "revise_shrink") {
    const reduced = suggestSimplerPlan(plan);
    revisions.push({
      type: "linked_scope_reduction",
      recordedAt: metadata.now,
      reason: `Successor reduced ${plan.scope.label.toLowerCase()} after an ${goal.outcome.criterionVerdict} verdict.`,
      scopeKey: plan.scope.key,
      fromValue: plan.scope.value,
      toValue: reduced.scope.value,
      from: clone(plan),
      to: clone(reduced),
    });
    plan = reduced;
  }
  return {
    ...state,
    draft: {
      id: metadata.id,
      stage: "review",
      updatedAt: metadata.now,
      intake,
      plan,
      originalPlan,
      revisions,
      predecessorId: goal.id,
      lineageRootId: goal.lineageRootId,
      decision,
    },
  };
}

export function setTimerHidden(state, hidden, now) {
  return {
    ...state,
    settings: {
      timerHidden: Boolean(hidden),
      updatedAt: now,
    },
  };
}

export function formatConfidenceDelta(delta) {
  return delta > 0 ? `+${delta}` : String(delta);
}

function mergeGoal(first, second) {
  const preferred = laterValue(first, second, "updatedAt");
  const other = preferred === first ? second : first;
  const outcome = laterValue(first.outcome, second.outcome, "recordedAt");
  const action = laterValue(first.sprint?.action, second.sprint?.action, "recordedAt");
  return {
    ...other,
    ...preferred,
    originalPlan: preferred.originalPlan ?? other.originalPlan,
    preregisteredPlan: preferred.preregisteredPlan ?? other.preregisteredPlan,
    revisions: uniqueRevisions(first.revisions, second.revisions),
    sprint: {
      ...(other.sprint ?? {}),
      ...(preferred.sprint ?? {}),
      action: action ?? null,
    },
    outcome: outcome ?? null,
    status: outcome?.status ?? "running",
    updatedAt: outcome?.recordedAt ?? preferred.updatedAt,
  };
}

export function mergeStates(first, second) {
  if (!isStateShape(first) || !isStateShape(second)) {
    throw new Error("Cannot merge invalid workspace state.");
  }
  const goalsById = new Map(first.goals.map((goal) => [goal.id, clone(goal)]));
  for (const goal of second.goals) {
    const existing = goalsById.get(goal.id);
    goalsById.set(goal.id, existing ? mergeGoal(existing, goal) : clone(goal));
  }
  const goals = [...goalsById.values()].sort(
    (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt),
  );
  const running = goals
    .filter((goal) => goal.status === "running" && !goal.outcome)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
  const draft = laterValue(first.draft, second.draft, "updatedAt") ?? null;
  const settings = laterValue(first.settings, second.settings, "updatedAt");
  return {
    version: STATE_VERSION,
    goals,
    activeGoalId: running?.id ?? null,
    draft: draft ? clone(draft) : null,
    settings: clone(settings),
  };
}

export function serializeState(state) {
  if (!isStateShape(state)) {
    throw new Error("Refusing to serialize invalid application state.");
  }
  return JSON.stringify(state);
}

export function serializeWorkspace(state, metadata) {
  if (!isStateShape(state)) {
    throw new Error("Refusing to serialize invalid workspace state.");
  }
  if (!Number.isInteger(metadata?.revision)
      || metadata.revision < 0
      || !metadata?.writtenAt
      || !metadata?.writerId) {
    throw new Error("Workspace metadata is incomplete.");
  }
  return JSON.stringify({
    format: WORKSPACE_FORMAT,
    schemaVersion: STATE_VERSION,
    revision: metadata.revision,
    writtenAt: metadata.writtenAt,
    writerId: metadata.writerId,
    state,
  });
}

export function deserializeWorkspace(serialized) {
  return parseWorkspaceStrict(serialized);
}

export function recoverWorkspace(primary, journal, legacy) {
  const attempts = [
    ["primary", primary],
    ["journal", journal],
    ["legacy", legacy],
  ];
  let sawPayload = false;
  for (const [source, payload] of attempts) {
    if (!payload) {
      continue;
    }
    sawPayload = true;
    try {
      const workspace = parseWorkspaceStrict(payload);
      return {
        state: workspace.state,
        revision: workspace.revision,
        writerId: workspace.writerId,
        source,
        recovered: source !== "primary",
        migrated: Boolean(workspace.migrated),
      };
    } catch {
      // Try the next independent copy.
    }
  }
  return {
    state: createEmptyState(),
    revision: 0,
    writerId: "empty",
    source: "empty",
    recovered: sawPayload,
    migrated: false,
  };
}

export function deserializeState(serialized) {
  const result = recoverWorkspace(serialized, null, null);
  return { state: result.state, recovered: result.recovered };
}

export function createExport(state, exportedAt) {
  if (!isStateShape(state) || !exportedAt) {
    throw new Error("Cannot export invalid workspace data.");
  }
  return JSON.stringify({
    format: EXPORT_FORMAT,
    schemaVersion: STATE_VERSION,
    exportedAt,
    privacyNotice: "Contains private self-recorded data in plain JSON.",
    state,
  }, null, 2);
}

export function parseImport(serialized) {
  const parsed = parseSerialized(serialized);
  if (parsed?.format !== EXPORT_FORMAT
      || parsed.schemaVersion !== STATE_VERSION
      || typeof parsed.exportedAt !== "string"
      || !isStateShape(parsed.state)) {
    throw new Error("This file is not a valid Proof of Possible v2 export.");
  }
  return clone(parsed.state);
}
