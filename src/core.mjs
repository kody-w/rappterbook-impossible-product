export const STATE_VERSION = 3;
export const STORAGE_KEY = "proof-of-possible:workspace:v3";
export const JOURNAL_KEY = "proof-of-possible:journal:v3";
export const FRAME2_STORAGE_KEY = "proof-of-possible:workspace:v2";
export const FRAME2_JOURNAL_KEY = "proof-of-possible:journal:v2";
export const LEGACY_STORAGE_KEY = "proof-of-possible:state:v1";
export const WORKSPACE_FORMAT = "proof-of-possible-workspace";
export const EXPORT_FORMAT = "proof-of-possible-export";
export const MAX_TIMEBOX_MINUTES = 10;

export const OUTCOME_STATUSES = new Set([
  "completed",
  "attempted",
  "blocked",
  "safe_stopped",
]);
export const INTERPRETATIONS = new Set([
  "supports",
  "weakens",
  "inconclusive",
  "blocked",
]);
export const CRITERION_VERDICTS = INTERPRETATIONS;
export const ACTION_KINDS = new Set(["taken", "could_not_start", "safe_stop"]);
export const DECISION_KINDS = new Set([
  "conclude",
  "replicate",
  "pivot",
  "seek_support",
  "continue",
]);
export const ROUTES = Object.freeze({
  act_now: "Act safely now",
  prepare_private: "Prepare privately",
  seek_support: "Seek trusted support or accommodation",
  safe_stop: "Stop safely",
});
export const PACING_MODES = Object.freeze({
  countdown: "Countdown",
  active_effort: "Active-effort cap",
  untimed: "Untimed",
});

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

const DIAGNOSES = new Set([
  "none",
  "weak_test",
  "absent_signal",
  "rival_explanation",
  "blocked_access",
]);
const TEXT_LIMITS = {
  goal: { min: 8, max: 240, label: "Decision" },
  obstacle: { min: 4, max: 400, label: "Binding constraint" },
};
const ASSUMPTION_LIMITS = {
  target: { min: 2, max: 160, label: "Target or unit" },
  claim: { min: 8, max: 400, label: "Assumption claim" },
  signal: { min: 8, max: 400, label: "Observable signal" },
  decision: { min: 8, max: 240, label: "Decision" },
};
const PLAN_LIMITS = {
  mission: { min: 8, max: 600, label: "Mission" },
  successCriterion: { min: 8, max: 600, label: "Support branch" },
  stopCondition: { min: 8, max: 400, label: "Stop condition" },
  artifactPayload: { min: 16, max: 4000, label: "Executable handoff" },
};
const BRANCH_LIMITS = {
  supports: { min: 8, max: 600, label: "Supports branch" },
  weakens: { min: 8, max: 600, label: "Weakens branch" },
  inconclusive: { min: 8, max: 600, label: "Inconclusive branch" },
};
const MAX_SERIALIZED_BYTES = 5_000_000;
const MAX_WORKSPACE_REVISION = Number.MAX_SAFE_INTEGER - 1;
const SINGULAR_UNITS = Object.freeze({
  parts: "part",
  requirements: "requirement",
  units: "unit",
  words: "word",
});
const LEGACY_DECISIONS = Object.freeze({
  continue: "continue",
  revise_shrink: "pivot",
  seek_access: "seek_support",
});

function cleanText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function cleanMultiline(value) {
  return typeof value === "string"
    ? value.trim().replace(/\r\n?/g, "\n")
    : "";
}

function parseNumber(value) {
  if (value === "" || value === null || value === undefined) {
    return Number.NaN;
  }
  return Number(value);
}

function parseOptionalInteger(value) {
  if (value === "" || value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

function isMeaningful(value, minimum) {
  const text = cleanText(value);
  return text.length >= minimum && /[\p{L}\p{N}]/u.test(text);
}

function validateTextFields(values, limits, prefix = "") {
  const errors = {};
  for (const [field, rules] of Object.entries(limits)) {
    const value = cleanText(values[field]);
    const errorKey = prefix ? `${prefix}${field[0].toUpperCase()}${field.slice(1)}` : field;
    if (!isMeaningful(value, rules.min)) {
      errors[errorKey] = `${rules.label} must be at least ${rules.min} meaningful characters.`;
    } else if (value.length > rules.max) {
      errors[errorKey] = `${rules.label} must be ${rules.max} characters or fewer.`;
    }
  }
  return errors;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeAssumption(input = {}, fallbackId = "") {
  const nested = input.assumption ?? {};
  return {
    id: cleanText(nested.id ?? input.assumptionId ?? fallbackId),
    target: cleanText(nested.target ?? input.assumptionTarget),
    claim: cleanText(nested.claim ?? input.assumptionClaim),
    signal: cleanText(nested.signal ?? input.assumptionSignal),
    decision: cleanText(nested.decision ?? input.goal),
  };
}

function isContactPattern(proofPattern) {
  return proofPattern === "ask" || proofPattern === "send";
}

function safeRoute(input) {
  const requested = Object.hasOwn(ROUTES, input.route) ? input.route : "act_now";
  if (isContactPattern(input.proofPattern)
      && input.safetySensitive
      && !input.outboundOptIn
      && requested === "act_now") {
    return "prepare_private";
  }
  return requested;
}

function normalizeIntake(input = {}, fallbackAssumptionId = "") {
  const proofPattern = cleanText(input.proofPattern);
  const pacingMode = Object.hasOwn(PACING_MODES, input.pacingMode)
    ? input.pacingMode
    : "countdown";
  const timebox = parseNumber(input.timeboxMinutes);
  const confidence = parseOptionalInteger(input.baselineConfidence);
  const normalized = {
    goal: cleanText(input.goal),
    obstacle: cleanText(input.obstacle),
    proofPattern,
    route: cleanText(input.route) || "act_now",
    safetySensitive: input.safetySensitive === true
      || input.safetySensitive === "on"
      || input.safetySensitive === "true",
    outboundOptIn: input.outboundOptIn === true
      || input.outboundOptIn === "on"
      || input.outboundOptIn === "true",
    pacingMode,
    why: cleanText(input.why),
    timeboxMinutes: pacingMode === "untimed"
      ? null
      : Number.isInteger(timebox) ? timebox : 5,
    baselineConfidence: confidence,
    assumption: normalizeAssumption(input, fallbackAssumptionId),
  };
  normalized.route = safeRoute(normalized);
  normalized.assumption.decision ||= normalized.goal;
  return normalized;
}

function normalizeBranches(input = {}, fallback = {}) {
  const source = input.branches ?? {};
  return {
    supports: cleanText(source.supports ?? input.supportsBranch ?? fallback.supports),
    weakens: cleanText(source.weakens ?? input.weakensBranch ?? fallback.weakens),
    inconclusive: cleanText(
      source.inconclusive ?? input.inconclusiveBranch ?? fallback.inconclusive,
    ),
  };
}

function normalizePlan(input = {}, fallbackPlan = null) {
  const sourceScope = input.scope ?? fallbackPlan?.scope ?? {};
  const branches = normalizeBranches(input, fallbackPlan?.branches);
  return {
    mission: cleanText(input.mission),
    successCriterion: cleanText(input.successCriterion) || branches.supports,
    stopCondition: cleanText(input.stopCondition),
    artifactPayload: cleanMultiline(input.artifactPayload),
    branches,
    route: Object.hasOwn(ROUTES, input.route)
      ? input.route
      : fallbackPlan?.route ?? "act_now",
    outboundAllowed: Boolean(input.outboundAllowed ?? fallbackPlan?.outboundAllowed),
    artifactKind: cleanText(input.artifactKind ?? fallbackPlan?.artifactKind) || "checklist",
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

function uniqueObjects(first = [], second = []) {
  const seen = new Set();
  return [...first, ...second].filter((item) => {
    const key = item.id ?? JSON.stringify(item);
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

function isNullableTimestamp(value) {
  return value === null || isTimestamp(value);
}

function isNullableConfidence(value) {
  return value === null
    || (Number.isInteger(value) && value >= 0 && value <= 100);
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

function isAssumptionShape(assumption, requireMeaningful = true) {
  const structural = assumption
    && typeof assumption === "object"
    && isMeaningful(assumption.id, 1)
    && ["target", "claim", "signal", "decision"].every(
      (field) => typeof assumption[field] === "string",
    );
  return structural
    && (!requireMeaningful
      || Object.keys(validateTextFields(assumption, ASSUMPTION_LIMITS)).length === 0);
}

function isPlanShape(plan, requireMeaningful = true) {
  if (!plan || typeof plan !== "object" || !isScopeShape(plan.scope)) {
    return false;
  }
  const structural = plan.branches
    && typeof plan.outboundAllowed === "boolean"
    && Object.hasOwn(ROUTES, plan.route)
    && typeof plan.artifactKind === "string";
  if (!structural) {
    return false;
  }
  if (!requireMeaningful) {
    return ["mission", "successCriterion", "stopCondition", "artifactPayload"].every(
      (field) => typeof plan[field] === "string",
    ) && ["supports", "weakens", "inconclusive"].every(
      (field) => typeof plan.branches[field] === "string",
    );
  }
  return Object.keys(validateTextFields(plan, PLAN_LIMITS)).length === 0
    && Object.keys(validateTextFields(plan.branches, BRANCH_LIMITS)).length === 0;
}

function isIntakeShape(intake, requireValid = true) {
  if (!intake || typeof intake !== "object") {
    return false;
  }
  const structural = ["goal", "obstacle", "proofPattern", "route", "pacingMode", "why"].every(
    (field) => typeof intake[field] === "string",
  )
    && typeof intake.safetySensitive === "boolean"
    && typeof intake.outboundOptIn === "boolean"
    && (intake.timeboxMinutes === null || Number.isInteger(intake.timeboxMinutes))
    && isNullableConfidence(intake.baselineConfidence)
    && isAssumptionShape(intake.assumption, requireValid);
  return structural && (!requireValid || validateIntake(intake).valid);
}

function isDecisionShape(decision) {
  return decision
    && typeof decision === "object"
    && isMeaningful(decision.id, 1)
    && DECISION_KINDS.has(decision.kind)
    && DECISION_KINDS.has(decision.recommended)
    && typeof decision.reason === "string"
    && typeof decision.override === "boolean"
    && isTimestamp(decision.recordedAt)
    && (!decision.override || isMeaningful(decision.reason, 8));
}

function isOutcomeStructure(outcome) {
  return outcome === null || (
    outcome
    && typeof outcome === "object"
    && OUTCOME_STATUSES.has(outcome.status)
    && ACTION_KINDS.has(outcome.actionKind)
    && INTERPRETATIONS.has(outcome.interpretation)
    && DIAGNOSES.has(outcome.diagnosis)
    && typeof outcome.observation === "string"
    && outcome.observation.length <= 2000
    && typeof outcome.url === "string"
    && hasSafeUrl(outcome.url)
    && outcome.externalVerification === "not_independently_verified"
    && isNullableConfidence(outcome.postConfidence)
    && (outcome.confidenceDelta === null || Number.isInteger(outcome.confidenceDelta))
    && typeof outcome.evidenceBearing === "boolean"
    && typeof outcome.beliefCriterionMet === "boolean"
    && isTimestamp(outcome.recordedAt)
  );
}

function isEffortShape(effort, pacingMode) {
  if (pacingMode !== "active_effort") {
    return effort === null;
  }
  return effort
    && Number.isInteger(effort.limitSeconds)
    && effort.limitSeconds > 0
    && Number.isInteger(effort.accumulatedSeconds)
    && effort.accumulatedSeconds >= 0
    && isNullableTimestamp(effort.activeSince)
    && isNullableTimestamp(effort.waitingSince);
}

function isSprintShape(sprint) {
  if (!sprint || !Object.hasOwn(PACING_MODES, sprint.pacingMode)) {
    return false;
  }
  const durationValid = sprint.pacingMode === "untimed"
    ? sprint.durationSeconds === null && sprint.endsAt === null
    : Number.isInteger(sprint.durationSeconds) && sprint.durationSeconds > 0;
  const deadlineValid = sprint.pacingMode === "countdown"
    ? isTimestamp(sprint.endsAt)
    : sprint.endsAt === null;
  const actionValid = sprint.action === null || (
    ACTION_KINDS.has(sprint.action.kind)
    && isTimestamp(sprint.action.recordedAt)
    && Number.isInteger(sprint.action.elapsedSeconds)
    && sprint.action.elapsedSeconds >= 0
    && Number.isInteger(sprint.action.activeEffortSeconds)
    && sprint.action.activeEffortSeconds >= 0
  );
  return durationValid
    && deadlineValid
    && isTimestamp(sprint.startedAt)
    && isNullableTimestamp(sprint.actionStartedAt)
    && [null, "copy_begin", "begin_only", "frame2_receipt_unknown"].includes(
      sprint.actionStartSource,
    )
    && isEffortShape(sprint.effort, sprint.pacingMode)
    && actionValid;
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
    && isSprintShape(goal.sprint)
    && isOutcomeStructure(goal.outcome)
    && (goal.predecessorId === null || typeof goal.predecessorId === "string")
    && (goal.predecessorDecision === null || DECISION_KINDS.has(goal.predecessorDecision))
    && isMeaningful(goal.lineageRootId, 1)
    && Array.isArray(goal.decisions)
    && goal.decisions.every(isDecisionShape);
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
    && (draft.predecessorDecision === null
      || DECISION_KINDS.has(draft.predecessorDecision))
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

function confidenceDelta(before, after) {
  return before === null || after === null ? null : after - before;
}

function isDirectionalEvidence(goal, outcome = goal.outcome) {
  return Boolean(
    outcome
    && isEvidenceBearingObservation(outcome.observation)
    && ["supports", "weakens"].includes(outcome.interpretation)
    && goal.sprint.actionStartedAt,
  );
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
    || (outcome.status === "blocked" && outcome.interpretation === "blocked");
  const safeStopMatches = outcome.actionKind !== "safe_stop"
    || (outcome.status === "safe_stopped"
      && ["blocked", "inconclusive"].includes(outcome.interpretation));
  const startedMatches = outcome.actionKind !== "taken"
    || goal.sprint.actionStartedAt !== null
    || goal.sprint.actionStartSource === "frame2_receipt_unknown";
  const derivedMatches = !requireDerived || (
    outcome.evidenceBearing === isEvidenceBearingObservation(outcome.observation)
    && outcome.confidenceDelta === confidenceDelta(
      goal.intake.baselineConfidence,
      outcome.postConfidence,
    )
    && outcome.beliefCriterionMet === isDirectionalEvidence(goal, outcome)
  );
  return goal.status === outcome.status
    && goal.status !== "running"
    && actionMatches
    && blockedMatches
    && safeStopMatches
    && startedMatches
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
      (goal.predecessorId === null && goal.predecessorDecision === null)
      || (ids.has(goal.predecessorId) && DECISION_KINDS.has(goal.predecessorDecision))
    )
  ));
  const beliefLineageIsStable = value.goals.every((goal) => {
    const root = value.goals.find((candidate) => candidate.id === goal.lineageRootId);
    return root && root.intake.assumption.id === goal.intake.assumption.id;
  });
  const draftIsValid = value.draft === null || (
    (value.draft.stage !== "review" || (value.draft.plan && value.draft.originalPlan))
    && (
      (value.draft.predecessorId === null && value.draft.predecessorDecision === null)
      || (ids.has(value.draft.predecessorId)
        && DECISION_KINDS.has(value.draft.predecessorDecision))
    )
  );
  if (!lineageIsValid || !beliefLineageIsStable || !draftIsValid) {
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
    goal.outcome.confidenceDelta = confidenceDelta(
      goal.intake.baselineConfidence,
      goal.outcome.postConfidence,
    );
    goal.outcome.beliefCriterionMet = isDirectionalEvidence(goal);
  }
  if (!isStateShape(state)) {
    throw new Error("Workspace state could not be normalized safely.");
  }
  return {
    state,
    repaired: JSON.stringify(state) !== JSON.stringify(value),
  };
}

function pacingStop(intake) {
  if (intake.pacingMode === "untimed") {
    return "Stop when the frozen branches can be judged, or stop safely at any time.";
  }
  if (intake.pacingMode === "active_effort") {
    return `Stop when the frozen branches can be judged or after ${formatMinutes(intake.timeboxMinutes)} of active effort; waiting does not count.`;
  }
  return `Stop when the frozen branches can be judged or after ${formatMinutes(intake.timeboxMinutes)}, whichever comes first.`;
}

function directionalBranches(assumption) {
  return {
    supports: `Supports “${assumption.claim}” only if ${assumption.signal} is observed and recorded; sending, opening, or completing alone does not count.`,
    weakens: `Weakens “${assumption.claim}” if the explicit opposite or a declared threshold miss is observed and recorded.`,
    inconclusive: "Inconclusive if the signal is absent, ambiguous, blocked, or explainable either way; activity alone does not decide the assumption.",
  };
}

function privatePreparationPayload(intake) {
  return [
    "PRIVATE PREPARATION — DO NOT SEND",
    `Target/unit: ${intake.assumption.target}`,
    `Assumption: ${intake.assumption.claim}`,
    `Signal to observe: ${intake.assumption.signal}`,
    `Decision informed: ${intake.assumption.decision}`,
    "Next safe step: review privately or with one trusted supporter before any contact.",
  ].join("\n");
}

function artifactPayload(intake, outboundAllowed) {
  const { assumption } = intake;
  if (intake.route === "safe_stop") {
    return [
      "SAFE-STOP EVIDENCE NOTE",
      `Target/unit: ${assumption.target}`,
      `Assumption paused: ${assumption.claim}`,
      "Barrier or risk observed: [write only what is safe to retain]",
      `Decision protected: ${assumption.decision}`,
      "No outbound action is required.",
    ].join("\n");
  }
  if (isContactPattern(intake.proofPattern) && !outboundAllowed) {
    return privatePreparationPayload(intake);
  }
  if (intake.proofPattern === "ask") {
    return [
      `To: [one relevant person connected to ${assumption.target}]`,
      `Question: I am deciding whether ${assumption.decision}.`,
      `Would you share one concrete example that could reveal whether ${assumption.claim}?`,
      `Signal I will record: ${assumption.signal}`,
      "A sent or opened message alone will not count as an answer.",
    ].join("\n");
  }
  if (intake.proofPattern === "send") {
    return [
      `To: [one reversible target connected to ${assumption.target}]`,
      `Subject: Small check before I decide ${assumption.decision}`,
      `Message: I am testing the assumption that ${assumption.claim}.`,
      `Please respond with the smallest observable sign of: ${assumption.signal}`,
      "Sending or delivery alone will not count as support.",
    ].join("\n");
  }
  if (intake.proofPattern === "make") {
    return [
      "TINY ARTIFACT SKELETON",
      `For: ${assumption.target}`,
      `Claim to discriminate: ${assumption.claim}`,
      "1. [smallest inspectable part]",
      "2. [signal capture point]",
      `Record only: ${assumption.signal}`,
      "Finishing the artifact alone will not decide the assumption.",
    ].join("\n");
  }
  return [
    "CONSTRAINT CHECK LOG",
    `Target/unit: ${assumption.target}`,
    `Claim to check: ${assumption.claim}`,
    "Source: [authoritative source]",
    "Exact requirement or threshold: [quote or value]",
    `Observable signal: ${assumption.signal}`,
    `Decision informed: ${assumption.decision}`,
  ].join("\n");
}

function missionFor(intake, scope) {
  const quotedClaim = `“${intake.assumption.claim}”`;
  const target = `“${intake.assumption.target}”`;
  const quantity = formatScopeValue(scope);
  if (intake.route === "safe_stop") {
    return `Record one private safe-stop note for ${target}; make no outbound contact.`;
  }
  const privatePrefix = intake.route === "prepare_private"
    ? "Prepare privately; do not send. "
    : intake.route === "seek_support"
      ? "Prepare a minimum-disclosure support or accommodation request. "
      : "";
  if (intake.proofPattern === "ask") {
    return `${privatePrefix}Ask one relevant person one question of ${quantity} or fewer that discriminates ${quotedClaim} for ${target}.`;
  }
  if (intake.proofPattern === "make") {
    return `${privatePrefix}Make one rough artifact with no more than ${quantity} that can expose the declared signal for ${target}.`;
  }
  if (intake.proofPattern === "check") {
    const unit = scope.value === 1 ? SINGULAR_UNITS[scope.unit] : scope.unit;
    return `${privatePrefix}Check one authoritative source for up to ${scope.value} explicit ${unit} that could support or weaken ${quotedClaim}.`;
  }
  return `${privatePrefix}Send one reversible probe of ${quantity} or fewer to one real target only when outbound contact is explicitly allowed.`;
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
  const intake = normalizeIntake(input, input?.assumption?.id ?? input?.assumptionId);
  const errors = {
    ...validateTextFields(intake, TEXT_LIMITS),
    ...validateTextFields(intake.assumption, ASSUMPTION_LIMITS, "assumption"),
  };
  if (!Object.hasOwn(PROOF_PATTERNS, intake.proofPattern)) {
    errors.proofPattern = "Choose one proof pattern.";
  }
  if (!Object.hasOwn(ROUTES, intake.route)) {
    errors.route = "Choose a safe route before freezing.";
  }
  if (!Object.hasOwn(PACING_MODES, intake.pacingMode)) {
    errors.pacingMode = "Choose countdown, active-effort cap, or untimed.";
  }
  if (intake.why.length > 400) {
    errors.why = "Why it matters must be 400 characters or fewer.";
  }
  if (intake.pacingMode !== "untimed"
      && (!Number.isInteger(intake.timeboxMinutes)
        || intake.timeboxMinutes < 1
        || intake.timeboxMinutes > MAX_TIMEBOX_MINUTES)) {
    errors.timeboxMinutes = `Choose a whole-number cap from 1 to ${MAX_TIMEBOX_MINUTES} minutes.`;
  }
  if (Number.isNaN(intake.baselineConfidence)
      || (intake.baselineConfidence !== null
        && (intake.baselineConfidence < 0 || intake.baselineConfidence > 100))) {
    errors.baselineConfidence = "Confidence must be blank or a whole number from 0 to 100.";
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
  const outboundAllowed = intake.route === "act_now"
    && (!isContactPattern(intake.proofPattern)
      || !intake.safetySensitive
      || intake.outboundOptIn);
  const branches = directionalBranches(intake.assumption);
  return {
    mission: missionFor(intake, scope),
    successCriterion: branches.supports,
    stopCondition: pacingStop(intake),
    artifactPayload: artifactPayload(intake, outboundAllowed),
    branches,
    route: intake.route,
    outboundAllowed,
    artifactKind: intake.proofPattern === "make"
      ? "artifact_skeleton"
      : intake.proofPattern === "check" ? "check_log" : "copy_ready_payload",
    scope,
  };
}

export function validatePlan(input) {
  const plan = normalizePlan(input, input);
  const errors = {
    ...validateTextFields(plan, PLAN_LIMITS),
    ...validateTextFields(plan.branches, BRANCH_LIMITS, "branch"),
  };
  if (!isScopeShape(plan.scope)) {
    errors.scope = "Scope must be a whole number at or above its stated minimum.";
  }
  if (!Object.hasOwn(ROUTES, plan.route)) {
    errors.route = "The plan must preserve a valid route.";
  }
  return { valid: Object.keys(errors).length === 0, errors, value: plan };
}

export function saveDraft(state, input, metadata) {
  if (!metadata?.id || !metadata?.now) {
    throw new Error("Draft metadata requires an id and timestamp.");
  }
  const existing = state.draft;
  const assumptionId = existing?.intake.assumption.id
    ?? metadata.assumptionId
    ?? `${metadata.id}-belief`;
  const draft = {
    id: existing?.id ?? metadata.id,
    stage: "intake",
    updatedAt: metadata.now,
    intake: normalizeIntake(input, assumptionId),
    plan: null,
    originalPlan: existing?.originalPlan ?? null,
    revisions: existing?.revisions ?? [],
    predecessorId: existing?.predecessorId ?? null,
    lineageRootId: existing?.lineageRootId ?? null,
    predecessorDecision: existing?.predecessorDecision ?? null,
  };
  return { ...state, draft };
}

export function compileDraft(state, input, metadata) {
  if (!metadata?.id || !metadata?.now) {
    throw new Error("Draft metadata requires an id and timestamp.");
  }
  const assumptionId = state.draft?.intake.assumption.id
    ?? metadata.assumptionId
    ?? `${metadata.id}-belief`;
  const candidate = normalizeIntake(input, assumptionId);
  const validation = validateIntake(candidate);
  if (!validation.valid) {
    throw new Error("Cannot compile an invalid draft.");
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
    predecessorDecision: existing?.predecessorDecision ?? null,
  };
  return { ...state, draft };
}

export function updateDraftReview(state, input, now) {
  if (!state.draft || state.draft.stage !== "review" || !state.draft.plan) {
    throw new Error("There is no review draft to update.");
  }
  const plan = normalizePlan(input, state.draft.plan);
  const intake = normalizeIntake(
    { ...state.draft.intake, ...input, assumption: state.draft.intake.assumption },
    state.draft.intake.assumption.id,
  );
  return {
    ...state,
    draft: {
      ...state.draft,
      updatedAt: now,
      intake,
      plan: { ...plan, route: intake.route },
    },
  };
}

export function changeDraftStrategy(state, changes, now) {
  if (!state.draft?.plan || state.draft.stage !== "review") {
    throw new Error("There is no review draft to recompile.");
  }
  const previous = clone(state.draft.plan);
  const intake = normalizeIntake({
    ...state.draft.intake,
    ...changes,
    assumption: state.draft.intake.assumption,
  }, state.draft.intake.assumption.id);
  const validation = validateIntake(intake);
  if (!validation.valid) {
    throw new Error("The selected route or proof pattern is invalid.");
  }
  const plan = generatePlan(validation.value);
  return {
    ...state,
    draft: {
      ...state.draft,
      intake: validation.value,
      plan,
      originalPlan: clone(plan),
      updatedAt: now,
      revisions: [
        ...state.draft.revisions,
        {
          type: "strategy_change",
          recordedAt: now,
          reason: `Changed proof to ${validation.value.proofPattern} and route to ${validation.value.route}.`,
          from: previous,
          to: clone(plan),
        },
      ],
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
  const intake = intakeValidation.value;
  const durationSeconds = intake.pacingMode === "untimed"
    ? null
    : intake.timeboxMinutes * 60;
  const endsAt = intake.pacingMode === "countdown"
    ? new Date(metadata.nowMilliseconds + durationSeconds * 1000).toISOString()
    : null;
  const goalId = metadata.id;
  const goal = {
    id: goalId,
    createdAt: metadata.now,
    updatedAt: metadata.now,
    status: "running",
    intake,
    originalPlan: clone(draft.originalPlan),
    preregisteredPlan: clone(finalPlan),
    revisions,
    sprint: {
      pacingMode: intake.pacingMode,
      durationSeconds,
      startedAt: metadata.now,
      endsAt,
      actionStartedAt: null,
      actionStartSource: null,
      effort: intake.pacingMode === "active_effort"
        ? {
          limitSeconds: durationSeconds,
          accumulatedSeconds: 0,
          activeSince: null,
          waitingSince: null,
        }
        : null,
      action: null,
    },
    outcome: null,
    predecessorId: draft.predecessorId,
    predecessorDecision: draft.predecessorDecision,
    lineageRootId: draft.lineageRootId ?? goalId,
    decisions: [],
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

function elapsedSeconds(start, end) {
  if (!isTimestamp(start) || !isTimestamp(end)) {
    return 0;
  }
  return Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 1000));
}

export function getActiveEffortSeconds(goal, now = new Date().toISOString()) {
  const effort = goal?.sprint?.effort;
  if (!effort) {
    return goal?.sprint?.actionStartedAt
      ? elapsedSeconds(goal.sprint.actionStartedAt, now)
      : 0;
  }
  const current = effort.activeSince ? elapsedSeconds(effort.activeSince, now) : 0;
  return effort.accumulatedSeconds + current;
}

export function getRemainingEffortSeconds(goal, now = new Date().toISOString()) {
  if (!goal?.sprint?.effort) {
    return 0;
  }
  return Math.max(0, goal.sprint.effort.limitSeconds - getActiveEffortSeconds(goal, now));
}

export function beginAction(state, goalId, now, source = "copy_begin") {
  const goal = findGoal(state, goalId);
  if (!goal || goal.status !== "running" || goal.outcome) {
    throw new Error("Only a running mission can begin an action.");
  }
  if (!["copy_begin", "begin_only"].includes(source)) {
    throw new Error("Unknown begin-action source.");
  }
  if (goal.sprint.actionStartedAt) {
    return state;
  }
  const sprint = {
    ...goal.sprint,
    actionStartedAt: now,
    actionStartSource: source,
    effort: goal.sprint.effort
      ? { ...goal.sprint.effort, activeSince: now, waitingSince: null }
      : null,
  };
  return replaceGoal(state, { ...goal, updatedAt: now, sprint });
}

export function pauseForResponse(state, goalId, now) {
  const goal = findGoal(state, goalId);
  if (!goal?.sprint.effort || !goal.sprint.effort.activeSince) {
    throw new Error("Active effort must be running before it can pause.");
  }
  if (!isContactPattern(goal.intake.proofPattern)) {
    throw new Error("Response waiting applies only to ask or send probes.");
  }
  const effort = {
    ...goal.sprint.effort,
    accumulatedSeconds: getActiveEffortSeconds(goal, now),
    activeSince: null,
    waitingSince: now,
  };
  return replaceGoal(state, {
    ...goal,
    updatedAt: now,
    sprint: { ...goal.sprint, effort },
  });
}

export function resumeActiveEffort(state, goalId, now) {
  const goal = findGoal(state, goalId);
  if (!goal?.sprint.effort || !goal.sprint.effort.waitingSince) {
    throw new Error("A waiting active-effort probe is required.");
  }
  return replaceGoal(state, {
    ...goal,
    updatedAt: now,
    sprint: {
      ...goal.sprint,
      effort: {
        ...goal.sprint.effort,
        activeSince: now,
        waitingSince: null,
      },
    },
  });
}

export function isEvidenceBearingObservation(value) {
  const observation = cleanText(value);
  const tokens = observation.match(/[\p{L}\p{N}]+/gu) ?? [];
  return observation.length >= 8 && tokens.length >= 2;
}

function normalizeInterpretation(input) {
  const direct = cleanText(input.interpretation).toLowerCase();
  if (direct) {
    return direct;
  }
  return {
    observed: "supports",
    not_observed: "weakens",
    blocked: "blocked",
    inconclusive: "inconclusive",
  }[cleanText(input.criterionVerdict).toLowerCase()] ?? "";
}

export function validateOutcome(input) {
  const actionKind = cleanText(input.actionKind);
  const status = cleanText(input.status).toLowerCase();
  const interpretation = normalizeInterpretation(input);
  const observation = cleanText(input.observation);
  const url = cleanText(input.url);
  const postConfidence = parseOptionalInteger(input.postConfidence);
  let diagnosis = cleanText(input.diagnosis).toLowerCase() || "none";
  if (actionKind === "could_not_start" || interpretation === "blocked") {
    diagnosis = "blocked_access";
  }
  const errors = {};
  if (!ACTION_KINDS.has(actionKind)) {
    errors.actionKind = "Choose action taken, could not start, or safe stop.";
  }
  if (!OUTCOME_STATUSES.has(status)) {
    errors.status = "Choose completed, attempted, blocked, or safe stop.";
  }
  if (!INTERPRETATIONS.has(interpretation)) {
    errors.interpretation = "Choose supports, weakens, inconclusive, or blocked.";
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
  if (Number.isNaN(postConfidence)
      || (postConfidence !== null && (postConfidence < 0 || postConfidence > 100))) {
    errors.postConfidence = "Confidence must be blank or a whole number from 0 to 100.";
  }
  if (!DIAGNOSES.has(diagnosis)) {
    errors.diagnosis = "Choose the diagnosis that best explains this signal.";
  }
  if (interpretation === "inconclusive" && diagnosis === "none") {
    errors.diagnosis = "Diagnose an inconclusive result before choosing the next proof.";
  }
  if (actionKind === "could_not_start"
      && (status !== "blocked" || interpretation !== "blocked")) {
    errors.status = "Could not start must preserve blocked status and interpretation.";
  }
  if (actionKind === "safe_stop"
      && (status !== "safe_stopped"
        || !["blocked", "inconclusive"].includes(interpretation))) {
    errors.status = "Safe stop must preserve safe-stopped status and a blocked or inconclusive interpretation.";
  }
  return {
    valid: Object.keys(errors).length === 0,
    errors,
    value: {
      actionKind,
      status,
      interpretation,
      criterionVerdict: interpretation,
      diagnosis,
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
  if (validation.value.actionKind === "taken" && !goal.sprint.actionStartedAt) {
    throw new Error("Use Copy & begin or Begin action before recording a taken action.");
  }
  const activeSeconds = getActiveEffortSeconds(goal, now);
  const actionElapsed = goal.sprint.actionStartedAt
    ? elapsedSeconds(goal.sprint.actionStartedAt, now)
    : 0;
  const outcome = {
    ...validation.value,
    evidenceBearing: isEvidenceBearingObservation(validation.value.observation),
    externalVerification: "not_independently_verified",
    confidenceDelta: confidenceDelta(
      goal.intake.baselineConfidence,
      validation.value.postConfidence,
    ),
    beliefCriterionMet: false,
    recordedAt: now,
  };
  const completedGoal = {
    ...goal,
    status: outcome.status,
    updatedAt: now,
    sprint: {
      ...goal.sprint,
      effort: goal.sprint.effort
        ? {
          ...goal.sprint.effort,
          accumulatedSeconds: activeSeconds,
          activeSince: null,
        }
        : null,
      action: {
        kind: outcome.actionKind,
        recordedAt: now,
        elapsedSeconds: actionElapsed,
        activeEffortSeconds: activeSeconds,
      },
    },
    outcome,
  };
  completedGoal.outcome.beliefCriterionMet = isDirectionalEvidence(completedGoal);
  return replaceGoal(state, completedGoal, null);
}

export function computeMetrics(state) {
  const sprintsStarted = state.goals.length;
  const evidenceBearingReceipts = state.goals.filter(
    (goal) => goal.outcome
      && isEvidenceBearingObservation(goal.outcome.observation)
      && INTERPRETATIONS.has(goal.outcome.interpretation),
  ).length;
  const directionalReceipts = state.goals.filter(
    (goal) => goal.outcome?.beliefCriterionMet,
  ).length;
  const criterionLinkedEvidenceRate = sprintsStarted === 0
    ? 0
    : evidenceBearingReceipts / sprintsStarted;
  return {
    sprintsStarted,
    evidenceBearingReceipts,
    directionalReceipts,
    criterionLinkedEvidenceRate,
    criterionLinkedEvidencePercent: Math.round(criterionLinkedEvidenceRate * 100),
  };
}

function fingerprint(goal) {
  const normalized = [
    goal.intake.assumption.id,
    goal.intake.proofPattern,
    goal.preregisteredPlan.route,
    goal.preregisteredPlan.scope.key,
    goal.preregisteredPlan.scope.value,
    goal.preregisteredPlan.branches.supports,
  ].map((value) => cleanText(String(value)).toLowerCase());
  return normalized.join("|");
}

export function getLineage(state, lineageRootId) {
  return state.goals
    .filter((goal) => goal.lineageRootId === lineageRootId)
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
}

export function synthesizeLineage(state, lineageRootId) {
  const goals = getLineage(state, lineageRootId);
  const receipts = goals.filter((goal) => goal.outcome);
  const supports = receipts.filter((goal) => goal.outcome.interpretation === "supports").length;
  const weakens = receipts.filter((goal) => goal.outcome.interpretation === "weakens").length;
  const inconclusive = receipts.filter(
    (goal) => ["inconclusive", "blocked"].includes(goal.outcome.interpretation),
  ).length;
  const groups = new Map();
  for (const goal of receipts) {
    const key = fingerprint(goal);
    groups.set(key, [...(groups.get(key) ?? []), goal]);
  }
  const duplicateGoalIds = [...groups.values()]
    .filter((group) => group.length > 1)
    .flatMap((group) => group.slice(1).map((goal) => goal.id));
  const contradiction = supports > 0 && weakens > 0;
  const currentSupportState = contradiction
    ? "mixed"
    : supports > 0 ? "currently_supports"
      : weakens > 0 ? "currently_weakens" : "undetermined";
  return {
    receiptCount: receipts.length,
    supports,
    weakens,
    inconclusive,
    contradiction,
    repetitionCount: duplicateGoalIds.length,
    duplicateLowInformation: duplicateGoalIds.length > 0,
    duplicateGoalIds,
    currentSupportState,
    choiceSet: receipts.length >= 2 ? ["conclude", "replicate", "pivot"] : [],
    summary: contradiction
      ? "Directional observations conflict; the current state is mixed, not statistically certain."
      : duplicateGoalIds.length > 0
        ? "A proof configuration repeated without a discriminating change; consider conclude, replicate deliberately, or pivot."
        : `${supports} support, ${weakens} weaken, ${inconclusive} unresolved; this is directional self-recorded evidence, not statistical certainty.`,
  };
}

export function recommendNextDecision(goal, synthesis = null) {
  if (!goal?.outcome) {
    throw new Error("A receipt is required before choosing a next decision.");
  }
  if (goal.outcome.actionKind === "could_not_start"
      || goal.outcome.interpretation === "blocked"
      || goal.outcome.diagnosis === "blocked_access") {
    return "seek_support";
  }
  if (goal.outcome.diagnosis === "weak_test"
      || goal.outcome.diagnosis === "rival_explanation") {
    return "pivot";
  }
  if (synthesis?.duplicateLowInformation) {
    return "pivot";
  }
  if (goal.outcome.diagnosis === "absent_signal") {
    return "replicate";
  }
  if (["supports", "weakens"].includes(goal.outcome.interpretation)) {
    return synthesis?.contradiction ? "replicate" : "conclude";
  }
  return "pivot";
}

export function recordDecision(state, goalId, kind, reason, now, decisionId = null) {
  const goal = findGoal(state, goalId);
  if (!goal?.outcome || !DECISION_KINDS.has(kind) || !isTimestamp(now)) {
    throw new Error("A valid receipt, decision, and timestamp are required.");
  }
  const synthesis = synthesizeLineage(state, goal.lineageRootId);
  const recommended = recommendNextDecision(goal, synthesis);
  const override = kind !== recommended;
  const cleanReason = cleanText(reason);
  if (override && !isMeaningful(cleanReason, 8)) {
    throw new Error("Explain why you are overriding the recommended decision.");
  }
  const decision = {
    id: decisionId ?? `${goal.id}-decision-${goal.decisions.length + 1}`,
    kind,
    recommended,
    reason: cleanReason || `Accepted the ${recommended.replaceAll("_", " ")} recommendation.`,
    override,
    recordedAt: now,
  };
  return replaceGoal(state, {
    ...goal,
    updatedAt: now,
    decisions: [...goal.decisions, decision],
  });
}

function nextProofPattern(goal, decision) {
  if (decision !== "pivot") {
    return decision === "seek_support" ? "check" : goal.intake.proofPattern;
  }
  return {
    ask: "check",
    make: "ask",
    check: "make",
    send: "check",
  }[goal.intake.proofPattern];
}

export function createLinkedDraft(state, goalId, decision, metadata) {
  const goal = findGoal(state, goalId);
  if (!goal?.outcome || !DECISION_KINDS.has(decision) || decision === "conclude") {
    throw new Error("A non-concluding recorded decision is required for a successor.");
  }
  const latestDecision = goal.decisions.at(-1);
  if (!latestDecision || latestDecision.kind !== decision) {
    throw new Error("Record this post-receipt decision before creating its successor.");
  }
  const proofPattern = nextProofPattern(goal, decision);
  const route = decision === "seek_support" ? "seek_support" : goal.intake.route;
  const intake = normalizeIntake({
    ...goal.intake,
    proofPattern,
    route,
    baselineConfidence: goal.outcome.postConfidence ?? goal.intake.baselineConfidence,
    assumption: clone(goal.intake.assumption),
  }, goal.intake.assumption.id);
  const plan = generatePlan(intake);
  const revision = {
    type: "reasoned_successor",
    recordedAt: metadata.now,
    reason: `${decision.replaceAll("_", " ")} after diagnosis: ${goal.outcome.diagnosis.replaceAll("_", " ")}.`,
    from: clone(goal.preregisteredPlan),
    to: clone(plan),
  };
  return {
    ...state,
    draft: {
      id: metadata.id,
      stage: "review",
      updatedAt: metadata.now,
      intake,
      plan,
      originalPlan: clone(plan),
      revisions: [revision],
      predecessorId: goal.id,
      lineageRootId: goal.lineageRootId,
      predecessorDecision: decision,
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
  if (delta === null || delta === undefined) {
    return "Not provided";
  }
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
  const actionStartedAt = first.sprint.actionStartedAt && second.sprint.actionStartedAt
    ? (Date.parse(first.sprint.actionStartedAt) <= Date.parse(second.sprint.actionStartedAt)
      ? first.sprint.actionStartedAt
      : second.sprint.actionStartedAt)
    : first.sprint.actionStartedAt ?? second.sprint.actionStartedAt;
  const outcome = outcomeSource?.outcome ?? null;
  const action = outcomeSource?.sprint.action ?? null;
  return {
    ...other,
    ...preferred,
    originalPlan: preferred.originalPlan ?? other.originalPlan,
    preregisteredPlan: preferred.preregisteredPlan ?? other.preregisteredPlan,
    revisions: uniqueObjects(first.revisions, second.revisions),
    decisions: uniqueObjects(first.decisions, second.decisions)
      .sort((left, right) => Date.parse(left.recordedAt) - Date.parse(right.recordedAt)),
    sprint: {
      ...(other.sprint ?? {}),
      ...(preferred.sprint ?? {}),
      actionStartedAt,
      actionStartSource: actionStartedAt
        ? first.sprint.actionStartSource ?? second.sprint.actionStartSource
        : null,
      action,
    },
    outcome,
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

function parseSerialized(serialized) {
  if (typeof serialized !== "string" || serialized.length > MAX_SERIALIZED_BYTES) {
    throw new Error("Workspace payload is missing or too large.");
  }
  return JSON.parse(serialized);
}

function frameTwoAssumption(oldIntake, criterion, id) {
  return {
    id,
    target: "the intended real-world target",
    claim: cleanText(oldIntake?.goal) || "This migrated goal can produce a useful signal",
    signal: cleanText(criterion) || "One explicit signal is observed",
    decision: cleanText(oldIntake?.goal) || "Decide whether to continue this migrated goal",
  };
}

function frameTwoIntake(oldIntake, assumption) {
  return normalizeIntake({
    goal: cleanText(oldIntake?.goal) || "Review this migrated proof mission",
    obstacle: cleanText(oldIntake?.obstacle) || "The original constraint was not recorded",
    proofPattern: Object.hasOwn(PROOF_PATTERNS, oldIntake?.proofPattern)
      ? oldIntake.proofPattern
      : "check",
    route: "act_now",
    pacingMode: "countdown",
    why: cleanText(oldIntake?.why),
    timeboxMinutes: Number.isInteger(oldIntake?.timeboxMinutes)
      ? Math.min(MAX_TIMEBOX_MINUTES, Math.max(1, oldIntake.timeboxMinutes))
      : 5,
    baselineConfidence: Number.isInteger(oldIntake?.baselineConfidence)
      ? Math.min(100, Math.max(0, oldIntake.baselineConfidence))
      : null,
    assumption,
  }, assumption.id);
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

function frameTwoPlan(oldPlan, intake) {
  const generated = generatePlan(intake);
  const legacyCriterion = cleanText(oldPlan?.successCriterion)
    || generated.branches.supports;
  return {
    ...generated,
    mission: cleanText(oldPlan?.mission) || generated.mission,
    successCriterion: legacyCriterion,
    stopCondition: cleanText(oldPlan?.stopCondition) || generated.stopCondition,
    scope: isScopeShape(oldPlan?.scope) ? clone(oldPlan.scope) : legacyScope(),
    branches: {
      supports: `Supports the migrated assumption only if: ${legacyCriterion} Activity alone does not count.`,
      weakens: `Weakens the migrated assumption if the explicit opposite of “${legacyCriterion}” is observed.`,
      inconclusive: "Inconclusive if the migrated criterion cannot be judged, is ambiguous, or access is blocked.",
    },
  };
}

function assertFrameTwoState(value) {
  if (!value || value.version !== 2 || !Array.isArray(value.goals)
      || value.goals.length > 10_000) {
    throw new Error("Frame 2 workspace failed structural validation.");
  }
  for (const goal of value.goals) {
    if (!goal?.id || !isTimestamp(goal.createdAt) || !goal.sprint
        || !isTimestamp(goal.sprint.startedAt) || !goal.intake
        || !goal.originalPlan || !goal.preregisteredPlan) {
      throw new Error("Frame 2 goal failed structural validation.");
    }
    if (goal.outcome) {
      const action = goal.sprint.action;
      if (!action
          || action.kind !== goal.outcome.actionKind
          || action.recordedAt !== goal.outcome.recordedAt
          || goal.status !== goal.outcome.status
          || (goal.outcome.actionKind === "could_not_start"
            && (goal.outcome.status !== "blocked"
              || goal.outcome.criterionVerdict !== "blocked"))) {
        throw new Error("Frame 2 goal failed semantic validation.");
      }
    }
  }
}

function mapFrameTwoInterpretation(verdict) {
  return {
    observed: "supports",
    not_observed: "weakens",
    blocked: "blocked",
    inconclusive: "inconclusive",
  }[verdict] ?? "inconclusive";
}

function mapFrameTwoGoal(oldGoal) {
  const rootId = oldGoal.lineageRootId || oldGoal.id;
  const criterion = oldGoal.preregisteredPlan?.successCriterion;
  const assumption = frameTwoAssumption(oldGoal.intake, criterion, `belief-${rootId}`);
  const intake = frameTwoIntake(oldGoal.intake, assumption);
  const outcome = oldGoal.outcome
    ? {
      status: oldGoal.outcome.status,
      actionKind: oldGoal.outcome.actionKind,
      interpretation: mapFrameTwoInterpretation(oldGoal.outcome.criterionVerdict),
      criterionVerdict: mapFrameTwoInterpretation(oldGoal.outcome.criterionVerdict),
      diagnosis: oldGoal.outcome.criterionVerdict === "blocked"
        ? "blocked_access"
        : oldGoal.outcome.criterionVerdict === "inconclusive" ? "weak_test" : "none",
      observation: cleanText(oldGoal.outcome.observation),
      url: hasSafeUrl(oldGoal.outcome.url) ? cleanText(oldGoal.outcome.url) : "",
      evidenceBearing: isEvidenceBearingObservation(oldGoal.outcome.observation),
      externalVerification: "not_independently_verified",
      postConfidence: isNullableConfidence(oldGoal.outcome.postConfidence)
        ? oldGoal.outcome.postConfidence
        : null,
      confidenceDelta: null,
      beliefCriterionMet: false,
      recordedAt: oldGoal.outcome.recordedAt,
    }
    : null;
  if (outcome) {
    outcome.confidenceDelta = confidenceDelta(intake.baselineConfidence, outcome.postConfidence);
  }
  const durationSeconds = Number.isInteger(oldGoal.sprint.durationSeconds)
    ? oldGoal.sprint.durationSeconds
    : intake.timeboxMinutes * 60;
  return {
    id: oldGoal.id,
    createdAt: oldGoal.createdAt,
    updatedAt: oldGoal.updatedAt ?? outcome?.recordedAt ?? oldGoal.createdAt,
    status: outcome?.status ?? "running",
    intake,
    originalPlan: frameTwoPlan(oldGoal.originalPlan, intake),
    preregisteredPlan: frameTwoPlan(oldGoal.preregisteredPlan, intake),
    revisions: Array.isArray(oldGoal.revisions) ? clone(oldGoal.revisions) : [],
    sprint: {
      pacingMode: "countdown",
      durationSeconds,
      startedAt: oldGoal.sprint.startedAt,
      endsAt: oldGoal.sprint.endsAt
        ?? new Date(Date.parse(oldGoal.sprint.startedAt) + durationSeconds * 1000).toISOString(),
      actionStartedAt: null,
      actionStartSource: outcome ? "frame2_receipt_unknown" : null,
      effort: null,
      action: outcome
        ? {
          kind: outcome.actionKind,
          recordedAt: outcome.recordedAt,
          elapsedSeconds: Number.isInteger(oldGoal.sprint.action?.elapsedSeconds)
            ? oldGoal.sprint.action.elapsedSeconds
            : elapsedSeconds(oldGoal.sprint.startedAt, outcome.recordedAt),
          activeEffortSeconds: Number.isInteger(oldGoal.sprint.action?.elapsedSeconds)
            ? oldGoal.sprint.action.elapsedSeconds
            : elapsedSeconds(oldGoal.sprint.startedAt, outcome.recordedAt),
        }
        : null,
    },
    outcome,
    predecessorId: oldGoal.predecessorId ?? null,
    predecessorDecision: oldGoal.predecessorId
      ? LEGACY_DECISIONS[oldGoal.decision] ?? "continue"
      : null,
    lineageRootId: rootId,
    decisions: [],
  };
}

function migratedDecision(kind, recordedAt, sourceId, index) {
  return {
    id: `${sourceId}-migrated-decision-${index}`,
    kind,
    recommended: kind,
    reason: "Migrated from a Frame 2 linked-successor decision.",
    override: false,
    recordedAt,
  };
}

function mapFrameTwoDraft(oldDraft, goals) {
  if (!oldDraft) {
    return null;
  }
  const predecessor = goals.find((goal) => goal.id === oldDraft.predecessorId);
  const rootId = oldDraft.lineageRootId ?? predecessor?.lineageRootId ?? null;
  const assumptionId = predecessor?.intake.assumption.id ?? `belief-${oldDraft.id}`;
  const assumption = frameTwoAssumption(
    oldDraft.intake,
    oldDraft.plan?.successCriterion,
    assumptionId,
  );
  const intake = frameTwoIntake(oldDraft.intake, assumption);
  return {
    id: oldDraft.id,
    stage: oldDraft.stage === "review" ? "review" : "intake",
    updatedAt: oldDraft.updatedAt,
    intake,
    plan: oldDraft.plan ? frameTwoPlan(oldDraft.plan, intake) : null,
    originalPlan: oldDraft.originalPlan
      ? frameTwoPlan(oldDraft.originalPlan, intake)
      : null,
    revisions: Array.isArray(oldDraft.revisions) ? clone(oldDraft.revisions) : [],
    predecessorId: oldDraft.predecessorId ?? null,
    lineageRootId: rootId,
    predecessorDecision: oldDraft.predecessorId
      ? LEGACY_DECISIONS[oldDraft.decision] ?? "continue"
      : null,
  };
}

function migrateVersionTwoState(frameTwo) {
  assertFrameTwoState(frameTwo);
  const goals = frameTwo.goals.map(mapFrameTwoGoal);
  for (const oldGoal of frameTwo.goals) {
    if (!oldGoal.predecessorId || !oldGoal.decision) {
      continue;
    }
    const predecessor = goals.find((goal) => goal.id === oldGoal.predecessorId);
    const kind = LEGACY_DECISIONS[oldGoal.decision];
    if (predecessor?.outcome && kind) {
      predecessor.decisions.push(
        migratedDecision(kind, oldGoal.createdAt, predecessor.id, predecessor.decisions.length + 1),
      );
    }
  }
  const draft = mapFrameTwoDraft(frameTwo.draft, goals);
  if (draft?.predecessorId && draft.predecessorDecision) {
    const predecessor = goals.find((goal) => goal.id === draft.predecessorId);
    if (predecessor?.outcome) {
      predecessor.decisions.push(migratedDecision(
        draft.predecessorDecision,
        draft.updatedAt,
        predecessor.id,
        predecessor.decisions.length + 1,
      ));
    }
  }
  const state = {
    version: STATE_VERSION,
    goals,
    activeGoalId: frameTwo.activeGoalId,
    draft,
    settings: {
      timerHidden: Boolean(frameTwo.settings?.timerHidden),
      updatedAt: isTimestamp(frameTwo.settings?.updatedAt)
        ? frameTwo.settings.updatedAt
        : new Date(0).toISOString(),
    },
  };
  const normalized = normalizeExternalState(state);
  return normalized.state;
}

function migrateVersionOne(legacy) {
  const goals = (legacy.goals ?? []).filter((goal) => goal.sprint || goal.outcome).map((goal) => {
    const hasOutcome = Boolean(goal.outcome);
    const status = hasOutcome && OUTCOME_STATUSES.has(goal.outcome?.status)
      ? goal.outcome.status
      : hasOutcome && ["completed", "attempted", "blocked"].includes(goal.status)
        ? goal.status : "running";
    const recordedAt = goal.outcome?.recordedAt ?? goal.sprint?.startedAt ?? goal.createdAt;
    const actionKind = status === "blocked" ? "could_not_start" : "taken";
    const criterionVerdict = status === "completed"
      ? "observed" : status === "blocked" ? "blocked" : "inconclusive";
    const intake = {
      goal: cleanText(goal.intake?.goal) || "Review this migrated proof mission",
      obstacle: cleanText(goal.intake?.obstacle) || "Original constraint unavailable",
      proofPattern: "check",
      why: cleanText(goal.intake?.why),
      timeboxMinutes: goal.intake?.timeboxMinutes ?? 5,
      baselineConfidence: goal.intake?.baselineConfidence ?? null,
    };
    const originalPlan = goal.originalPlan ?? {};
    const preregisteredPlan = goal.currentPlan ?? goal.originalPlan ?? {};
    return {
      id: goal.id,
      createdAt: goal.createdAt,
      updatedAt: recordedAt,
      status,
      intake,
      originalPlan: { ...originalPlan, scope: legacyScope() },
      preregisteredPlan: { ...preregisteredPlan, scope: legacyScope() },
      revisions: goal.revisions ?? [],
      sprint: {
        durationSeconds: goal.sprint?.durationSeconds ?? intake.timeboxMinutes * 60,
        startedAt: goal.sprint?.startedAt ?? goal.createdAt,
        endsAt: goal.sprint?.endsAt,
        action: hasOutcome
          ? {
            kind: actionKind,
            recordedAt,
            elapsedSeconds: elapsedSeconds(goal.sprint?.startedAt ?? goal.createdAt, recordedAt),
          }
          : null,
      },
      outcome: hasOutcome
        ? {
          status,
          actionKind,
          criterionVerdict,
          observation: cleanText(goal.outcome?.note),
          url: hasSafeUrl(goal.outcome?.url) ? cleanText(goal.outcome?.url) : "",
          postConfidence: goal.outcome?.postConfidence ?? intake.baselineConfidence,
          recordedAt,
        }
        : null,
      predecessorId: null,
      lineageRootId: goal.id,
      decision: null,
    };
  });
  const planned = legacy.goals?.find(
    (goal) => goal.id === legacy.activeGoalId && goal.status === "planned",
  );
  const frameTwo = {
    version: 2,
    goals,
    activeGoalId: goals.find(
      (goal) => goal.id === legacy.activeGoalId && !goal.outcome,
    )?.id ?? null,
    draft: planned
      ? {
        id: planned.id,
        stage: "review",
        updatedAt: planned.createdAt,
        intake: planned.intake,
        plan: { ...(planned.currentPlan ?? planned.originalPlan), scope: legacyScope() },
        originalPlan: { ...planned.originalPlan, scope: legacyScope() },
        revisions: planned.revisions ?? [],
        predecessorId: null,
        lineageRootId: null,
        decision: null,
      }
      : null,
    settings: { timerHidden: false, updatedAt: new Date(0).toISOString() },
  };
  return migrateVersionTwoState(frameTwo);
}

function validateEnvelope(parsed, expectedVersion) {
  return parsed?.format === WORKSPACE_FORMAT
    && parsed.schemaVersion === expectedVersion
    && Number.isSafeInteger(parsed.revision)
    && parsed.revision >= 0
    && parsed.revision <= MAX_WORKSPACE_REVISION
    && isTimestamp(parsed.writtenAt)
    && isMeaningful(parsed.writerId, 1);
}

function parseWorkspaceStrict(serialized) {
  const parsed = parseSerialized(serialized);
  if (validateEnvelope(parsed, STATE_VERSION)) {
    const normalized = normalizeExternalState(parsed.state);
    return { ...parsed, ...normalized };
  }
  if (validateEnvelope(parsed, 2)) {
    return {
      ...parsed,
      schemaVersion: STATE_VERSION,
      state: migrateVersionTwoState(parsed.state),
      migrated: true,
      repaired: false,
    };
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
  if (parsed?.version === 2) {
    return {
      format: WORKSPACE_FORMAT,
      schemaVersion: STATE_VERSION,
      revision: 0,
      writtenAt: new Date(0).toISOString(),
      writerId: "migration-v2",
      state: migrateVersionTwoState(parsed),
      migrated: true,
      repaired: false,
    };
  }
  if (parsed?.version === 1) {
    return {
      format: WORKSPACE_FORMAT,
      schemaVersion: STATE_VERSION,
      revision: 0,
      writtenAt: new Date().toISOString(),
      writerId: "migration-v1",
      state: migrateVersionOne(parsed),
      migrated: true,
      repaired: false,
    };
  }
  throw new Error("Unsupported workspace schema.");
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
  return left.source.includes("primary") ? -1 : 1;
}

function recoveryResult(candidate, primaryCandidate, invalidSources) {
  const recovered = candidate.source.includes("journal");
  let recoveryReason = "none";
  if (recovered && primaryCandidate) {
    recoveryReason = "newer_journal";
  } else if (recovered && invalidSources.some((source) => source.includes("primary"))) {
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

function collectCandidates(copies, invalidSources) {
  const candidates = [];
  for (const [source, payload] of copies) {
    if (!payload) {
      continue;
    }
    try {
      candidates.push({ source, workspace: parseWorkspaceStrict(payload) });
    } catch {
      invalidSources.push(source);
    }
  }
  return candidates;
}

export function recoverWorkspace(
  primary,
  journal,
  legacy,
  frameTwoPrimary = null,
  frameTwoJournal = null,
) {
  const invalidSources = [];
  const currentPayloads = [["primary", primary], ["journal", journal]];
  const sawCurrent = currentPayloads.some(([, payload]) => Boolean(payload));
  const current = collectCandidates(currentPayloads, invalidSources);
  if (current.length > 0) {
    current.sort(compareWorkspaceCandidates);
    const primaryCandidate = current.find((candidate) => candidate.source === "primary");
    return recoveryResult(current[0], primaryCandidate, invalidSources);
  }
  const frameTwoPayloads = [
    ["frame2_primary", frameTwoPrimary],
    ["frame2_journal", frameTwoJournal],
  ];
  const sawFrameTwo = frameTwoPayloads.some(([, payload]) => Boolean(payload));
  const frameTwo = collectCandidates(frameTwoPayloads, invalidSources);
  if (frameTwo.length > 0) {
    frameTwo.sort(compareWorkspaceCandidates);
    const primaryCandidate = frameTwo.find(
      (candidate) => candidate.source === "frame2_primary",
    );
    return recoveryResult(frameTwo[0], primaryCandidate, invalidSources);
  }
  if (legacy) {
    try {
      return recoveryResult(
        { source: "legacy", workspace: parseWorkspaceStrict(legacy) },
        null,
        invalidSources,
      );
    } catch {
      invalidSources.push("legacy");
    }
  }
  const sawPayload = sawCurrent || sawFrameTwo || Boolean(legacy);
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
  if (parsed?.format !== EXPORT_FORMAT || !isTimestamp(parsed.exportedAt)) {
    throw new Error("This file is not a valid Proof of Possible export.");
  }
  try {
    if (parsed.schemaVersion === STATE_VERSION) {
      return normalizeExternalState(parsed.state).state;
    }
    if (parsed.schemaVersion === 2) {
      return migrateVersionTwoState(parsed.state);
    }
  } catch {
    throw new Error("This file is not a semantically valid Proof of Possible export.");
  }
  throw new Error("This file uses an unsupported Proof of Possible export version.");
}
