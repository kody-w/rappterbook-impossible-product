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
const SUCCESSOR_DECISIONS = new Set(["continue", "revise_shrink", "seek_access"]);

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
const MAX_WORKSPACE_REVISION = Number.MAX_SAFE_INTEGER - 1;
const SINGULAR_UNITS = Object.freeze({
  parts: "part",
  requirements: "requirement",
  units: "unit",
  words: "word",
});

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

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scopePhrasePattern(scope) {
  const singular = escapeRegularExpression(SINGULAR_UNITS[scope.unit] ?? scope.unit);
  const plural = escapeRegularExpression(scope.unit);
  if (scope.key === "requirements") {
    return new RegExp(`\\bup to\\s+\\d+\\s+explicit\\s+(?:${singular}|${plural})\\b`, "i");
  }
  return new RegExp(`\\b\\d+\\s+(?:${singular}|${plural})\\b`, "i");
}

function replaceScopePhrase(text, scope, nextValue) {
  const pattern = scopePhrasePattern(scope);
  const quantity = formatScopeValue(scope, nextValue);
  const replacement = scope.key === "requirements"
    ? `up to ${nextValue} explicit ${nextValue === 1 ? SINGULAR_UNITS[scope.unit] : scope.unit}`
    : quantity;
  if (pattern.test(text)) {
    return text.replace(pattern, replacement);
  }
  return `${text.replace(/[.\s]+$/u, "")}. Limit ${scope.label.toLowerCase()} to ${quantity}.`;
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

function isTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
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

function isOutcomeStructure(outcome) {
  return outcome === null || (
    outcome
    && typeof outcome === "object"
    && OUTCOME_STATUSES.has(outcome.status)
    && ACTION_KINDS.has(outcome.actionKind)
    && CRITERION_VERDICTS.has(outcome.criterionVerdict)
    && typeof outcome.observation === "string"
    && outcome.observation.length <= 2000
    && typeof outcome.url === "string"
    && hasSafeUrl(outcome.url)
    && outcome.externalVerification === "not_independently_verified"
    && Number.isInteger(outcome.postConfidence)
    && outcome.postConfidence >= 0
    && outcome.postConfidence <= 100
    && isTimestamp(outcome.recordedAt)
  );
}

function isGoalStructure(goal) {
  return goal
    && typeof goal === "object"
    && isMeaningful(goal.id, 1)
    && isTimestamp(goal.createdAt)
    && isTimestamp(goal.updatedAt)
    && ["running", ...OUTCOME_STATUSES].includes(goal.status)
    && isIntakeShape(goal.intake)
    && isPlanShape(goal.originalPlan)
    && isPlanShape(goal.preregisteredPlan)
    && Array.isArray(goal.revisions)
    && goal.sprint
    && Number.isInteger(goal.sprint.durationSeconds)
    && goal.sprint.durationSeconds > 0
    && isTimestamp(goal.sprint.startedAt)
    && isTimestamp(goal.sprint.endsAt)
    && (goal.sprint.action === null || (
      ACTION_KINDS.has(goal.sprint.action.kind)
      && isTimestamp(goal.sprint.action.recordedAt)
      && Number.isInteger(goal.sprint.action.elapsedSeconds)
      && goal.sprint.action.elapsedSeconds >= 0
    ))
    && isOutcomeStructure(goal.outcome)
    && (goal.predecessorId === null || typeof goal.predecessorId === "string")
    && isMeaningful(goal.lineageRootId, 1)
    && (goal.decision === null || typeof goal.decision === "string");
}

function isDraftShape(draft) {
  return draft === null || (
    draft
    && typeof draft === "object"
    && isMeaningful(draft.id, 1)
    && ["intake", "review"].includes(draft.stage)
    && isTimestamp(draft.updatedAt)
    && isIntakeShape(draft.intake, false)
    && (draft.plan === null || isPlanShape(draft.plan, false))
    && (draft.originalPlan === null || isPlanShape(draft.originalPlan))
    && Array.isArray(draft.revisions)
    && (draft.predecessorId === null || typeof draft.predecessorId === "string")
    && (draft.lineageRootId === null || typeof draft.lineageRootId === "string")
    && (draft.decision === null || typeof draft.decision === "string")
  );
}

function isStateStructure(value) {
  return value
    && typeof value === "object"
    && value.version === STATE_VERSION
    && Array.isArray(value.goals)
    && value.goals.length <= 10_000
    && value.goals.every(isGoalStructure)
    && (value.activeGoalId === null || typeof value.activeGoalId === "string")
    && isDraftShape(value.draft)
    && value.settings
    && typeof value.settings.timerHidden === "boolean"
    && isTimestamp(value.settings.updatedAt);
}

function hasGoalSemantics(goal, requireDerived = true) {
  if (goal.outcome === null) {
    return goal.status === "running" && goal.sprint.action === null;
  }
  const { outcome } = goal;
  const action = goal.sprint.action;
  const actionMatches = action
    && action.kind === outcome.actionKind
    && action.recordedAt === outcome.recordedAt;
  const blockedMatches = outcome.actionKind !== "could_not_start"
    || (outcome.status === "blocked" && outcome.criterionVerdict === "blocked");
  const derivedMatches = !requireDerived || (
    outcome.evidenceBearing === isEvidenceBearingObservation(outcome.observation)
    && outcome.confidenceDelta === outcome.postConfidence - goal.intake.baselineConfidence
  );
  return goal.status === outcome.status
    && goal.status !== "running"
    && actionMatches
    && blockedMatches
    && derivedMatches;
}

function hasStateSemantics(value, requireDerived = true) {
  const ids = new Set(value.goals.map((goal) => goal.id));
  if (ids.size !== value.goals.length
      || !value.goals.every((goal) => hasGoalSemantics(goal, requireDerived))) {
    return false;
  }
  const lineageIsValid = value.goals.every((goal) => (
    ids.has(goal.lineageRootId)
    && (
      (goal.predecessorId === null && goal.decision === null)
      || (ids.has(goal.predecessorId) && SUCCESSOR_DECISIONS.has(goal.decision))
    )
  ));
  const draftIsValid = value.draft === null || (
    (value.draft.stage !== "review" || (value.draft.plan && value.draft.originalPlan))
    && (
      (value.draft.predecessorId === null && value.draft.decision === null)
      || (ids.has(value.draft.predecessorId)
        && SUCCESSOR_DECISIONS.has(value.draft.decision))
    )
  );
  if (!lineageIsValid || !draftIsValid) {
    return false;
  }
  if (value.activeGoalId === null) {
    return true;
  }
  const active = value.goals.find((goal) => goal.id === value.activeGoalId);
  return Boolean(active && active.status === "running" && active.outcome === null);
}

function isStateShape(value) {
  return isStateStructure(value) && hasStateSemantics(value, true);
}

function normalizeExternalState(value) {
  if (!isStateStructure(value) || !hasStateSemantics(value, false)) {
    throw new Error("Workspace state failed semantic validation.");
  }
  const state = clone(value);
  for (const goal of state.goals) {
    if (!goal.outcome) {
      continue;
    }
    goal.outcome.evidenceBearing = isEvidenceBearingObservation(goal.outcome.observation);
    goal.outcome.confidenceDelta = goal.outcome.postConfidence - goal.intake.baselineConfidence;
  }
  if (!isStateShape(state)) {
    throw new Error("Workspace state could not be normalized safely.");
  }
  return {
    state,
    repaired: JSON.stringify(state) !== JSON.stringify(value),
  };
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
        || !Number.isSafeInteger(parsed.revision)
        || parsed.revision < 0
        || parsed.revision > MAX_WORKSPACE_REVISION
        || !isTimestamp(parsed.writtenAt)
        || !isMeaningful(parsed.writerId, 1)) {
      throw new Error("Workspace envelope failed validation.");
    }
    const normalized = normalizeExternalState(parsed.state);
    return { ...parsed, ...normalized };
  }
  if (parsed?.version === STATE_VERSION) {
    const normalized = normalizeExternalState(parsed);
    return {
      format: WORKSPACE_FORMAT,
      schemaVersion: STATE_VERSION,
      revision: 0,
      writtenAt: new Date(0).toISOString(),
      writerId: "unversioned",
      ...normalized,
    };
  }
  if (parsed?.version === 1) {
    const migrated = migrateVersionOne(parsed);
    const normalized = normalizeExternalState(migrated.state);
    return { ...migrated, ...normalized, migrated: true };
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

export function formatScopeValue(scope, value = scope.value) {
  const unit = value === 1 ? SINGULAR_UNITS[scope.unit] ?? scope.unit : scope.unit;
  return `${value} ${unit}`;
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
  const scopeQuantity = formatScopeValue(scope);
  let mission;
  let successCriterion;

  if (intake.proofPattern === "ask") {
    mission = `Ask one relevant person one question of ${scopeQuantity} or fewer about whether ${quotedGoal} can move within ${quotedConstraint}.`;
    successCriterion = "Observed if that person gives one specific answer; not observed if no answer arrives.";
  } else if (intake.proofPattern === "make") {
    mission = `Make one rough artifact with no more than ${scopeQuantity} that demonstrates ${quotedGoal} while respecting ${quotedConstraint}.`;
    successCriterion = "Observed if one artifact can be opened or shown and contains at least one concrete part.";
  } else if (intake.proofPattern === "check") {
    const requirementUnit = scope.value === 1 ? SINGULAR_UNITS[scope.unit] : scope.unit;
    mission = `Check one authoritative source for up to ${scope.value} explicit ${requirementUnit} affecting ${quotedGoal} under ${quotedConstraint}.`;
    successCriterion = "Observed if the source gives an explicit yes, no, threshold, or requirement.";
  } else {
    mission = `Send one reversible probe of ${scopeQuantity} or fewer about ${quotedGoal} to one real target while honoring ${quotedConstraint}.`;
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
    reason: `${from.scope.label} reduced from ${formatScopeValue(from.scope)} to ${formatScopeValue(to.scope)}.`,
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
    (goal) => goal.outcome
      && isEvidenceBearingObservation(goal.outcome.observation)
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
  if (!SUCCESSOR_DECISIONS.has(decision)) {
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
  const outcomeSource = laterValue(
    first.outcome ? first : null,
    second.outcome ? second : null,
    "updatedAt",
  );
  const outcome = outcomeSource?.outcome ?? null;
  const action = outcomeSource?.sprint.action ?? null;
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
  const merged = {
    version: STATE_VERSION,
    goals,
    activeGoalId: running?.id ?? null,
    draft: draft ? clone(draft) : null,
    settings: clone(settings),
  };
  if (!isStateShape(merged)) {
    throw new Error("Merged workspace state failed semantic validation.");
  }
  return merged;
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
  if (!Number.isSafeInteger(metadata?.revision)
      || metadata.revision < 0
      || metadata.revision > MAX_WORKSPACE_REVISION
      || !isTimestamp(metadata?.writtenAt)
      || !isMeaningful(metadata?.writerId, 1)) {
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

function compareWorkspaceCandidates(left, right) {
  if (left.workspace.revision !== right.workspace.revision) {
    return right.workspace.revision - left.workspace.revision;
  }
  const timestampDifference = Date.parse(right.workspace.writtenAt)
    - Date.parse(left.workspace.writtenAt);
  if (timestampDifference !== 0) {
    return timestampDifference;
  }
  return left.source === "primary" ? -1 : 1;
}

function recoveryResult(candidate, primaryCandidate, invalidSources) {
  const recovered = candidate.source === "journal";
  let recoveryReason = "none";
  if (recovered && primaryCandidate) {
    recoveryReason = "newer_journal";
  } else if (recovered && invalidSources.includes("primary")) {
    recoveryReason = "invalid_primary";
  } else if (recovered) {
    recoveryReason = "journal_only";
  }
  return {
    state: candidate.workspace.state,
    revision: candidate.workspace.revision,
    writerId: candidate.workspace.writerId,
    source: candidate.source,
    recovered,
    recoveryReason,
    reset: false,
    invalidSources,
    migrated: Boolean(candidate.workspace.migrated),
    repaired: Boolean(candidate.workspace.repaired),
  };
}

export function recoverWorkspace(primary, journal, legacy) {
  const currentCopies = [["primary", primary], ["journal", journal]];
  const candidates = [];
  const invalidSources = [];
  let sawPayload = false;
  for (const [source, payload] of currentCopies) {
    if (!payload) {
      continue;
    }
    sawPayload = true;
    try {
      candidates.push({ source, workspace: parseWorkspaceStrict(payload) });
    } catch {
      invalidSources.push(source);
    }
  }
  if (candidates.length > 0) {
    candidates.sort(compareWorkspaceCandidates);
    const primaryCandidate = candidates.find((candidate) => candidate.source === "primary");
    return recoveryResult(candidates[0], primaryCandidate, invalidSources);
  }
  if (legacy) {
    sawPayload = true;
    try {
      const candidate = { source: "legacy", workspace: parseWorkspaceStrict(legacy) };
      return recoveryResult(candidate, null, invalidSources);
    } catch {
      invalidSources.push("legacy");
    }
  }
  return {
    state: createEmptyState(),
    revision: 0,
    writerId: "empty",
    source: "empty",
    recovered: false,
    recoveryReason: sawPayload ? "no_valid_copy" : "none",
    reset: sawPayload,
    invalidSources,
    migrated: false,
    repaired: false,
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
      || !isTimestamp(parsed.exportedAt)) {
    throw new Error("This file is not a valid Proof of Possible v2 export.");
  }
  try {
    return normalizeExternalState(parsed.state).state;
  } catch {
    throw new Error("This file is not a semantically valid Proof of Possible v2 export.");
  }
}
