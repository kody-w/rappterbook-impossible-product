export const STATE_VERSION = 1;
export const STORAGE_KEY = "proof-of-possible:state:v1";
export const MAX_TIMEBOX_MINUTES = 10;
export const OUTCOME_STATUSES = new Set(["completed", "attempted", "blocked"]);

const FIELD_LIMITS = {
  goal: { min: 8, max: 240, label: "Goal" },
  why: { min: 4, max: 400, label: "Why it matters" },
  obstacle: { min: 4, max: 400, label: "Binding obstacle" },
  proof: { min: 6, max: 300, label: "Observable proof" },
};

const PLAN_LIMITS = {
  mission: { min: 8, max: 600, label: "Mission" },
  successCriterion: { min: 6, max: 400, label: "Observable success" },
  stopCondition: { min: 6, max: 400, label: "Stop condition" },
};

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

function normalizeIntake(input) {
  return {
    goal: cleanText(input.goal),
    why: cleanText(input.why),
    obstacle: cleanText(input.obstacle),
    proof: cleanText(input.proof),
    timeboxMinutes: parseNumber(input.timeboxMinutes),
    baselineConfidence: parseNumber(input.baselineConfidence),
  };
}

function normalizePlan(input) {
  return {
    mission: cleanText(input.mission),
    successCriterion: cleanText(input.successCriterion),
    stopCondition: cleanText(input.stopCondition),
  };
}

function clonePlan(plan) {
  return {
    mission: plan.mission,
    successCriterion: plan.successCriterion,
    stopCondition: plan.stopCondition,
  };
}

export function createEmptyState() {
  return {
    version: STATE_VERSION,
    goals: [],
    activeGoalId: null,
  };
}

export function validateIntake(input) {
  const intake = normalizeIntake(input);
  const errors = validateTextFields(intake, FIELD_LIMITS);

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
    throw new Error("Cannot generate a mission from invalid intake.");
  }

  const intake = validation.value;
  return {
    mission: `Within the constraint “${intake.obstacle}”, spend up to ${intake.timeboxMinutes} minutes making the smallest honest attempt toward “${intake.goal}” that could produce: ${intake.proof}`,
    successCriterion: `You can point to this observable result: ${intake.proof}`,
    stopCondition: `Stop when the result is observable or after ${intake.timeboxMinutes} minutes, whichever comes first.`,
  };
}

export function validatePlan(input) {
  const plan = normalizePlan(input);
  const errors = validateTextFields(plan, PLAN_LIMITS);
  return { valid: Object.keys(errors).length === 0, errors, value: plan };
}

export function createGoal(state, input, metadata) {
  const validation = validateIntake(input);
  if (!validation.valid) {
    throw new Error("Cannot create a goal from invalid intake.");
  }
  if (!metadata?.id || !metadata?.now) {
    throw new Error("Goal metadata requires an id and timestamp.");
  }

  const plan = generatePlan(validation.value);
  const goal = {
    id: metadata.id,
    createdAt: metadata.now,
    status: "planned",
    intake: validation.value,
    originalPlan: clonePlan(plan),
    currentPlan: clonePlan(plan),
    revisions: [],
    sprint: null,
    outcome: null,
  };

  return {
    ...state,
    goals: [...state.goals, goal],
    activeGoalId: goal.id,
  };
}

export function findGoal(state, goalId) {
  return state.goals.find((goal) => goal.id === goalId) ?? null;
}

function replaceGoal(state, updatedGoal, activeGoalId = state.activeGoalId) {
  return {
    ...state,
    goals: state.goals.map((goal) => goal.id === updatedGoal.id ? updatedGoal : goal),
    activeGoalId,
  };
}

export function startSprint(state, goalId, planInput, nowMilliseconds) {
  const goal = findGoal(state, goalId);
  if (!goal || goal.status !== "planned") {
    throw new Error("Only a planned goal can start a sprint.");
  }
  const validation = validatePlan(planInput);
  if (!validation.valid) {
    throw new Error("Cannot start a sprint with an invalid mission.");
  }
  if (!Number.isFinite(nowMilliseconds)) {
    throw new Error("A valid start time is required.");
  }

  const durationSeconds = goal.intake.timeboxMinutes * 60;
  const updatedGoal = {
    ...goal,
    status: "running",
    currentPlan: validation.value,
    sprint: {
      durationSeconds,
      startedAt: new Date(nowMilliseconds).toISOString(),
      endsAt: new Date(nowMilliseconds + durationSeconds * 1000).toISOString(),
    },
  };
  return replaceGoal(state, updatedGoal, goalId);
}

export function getRemainingSeconds(endsAt, nowMilliseconds = Date.now()) {
  const endMilliseconds = Date.parse(endsAt);
  if (!Number.isFinite(endMilliseconds) || !Number.isFinite(nowMilliseconds)) {
    return 0;
  }
  return Math.max(0, Math.ceil((endMilliseconds - nowMilliseconds) / 1000));
}

export function suggestSimplerPlan(planInput) {
  const validation = validatePlan(planInput);
  if (!validation.valid) {
    throw new Error("Cannot simplify an invalid mission.");
  }
  return {
    ...validation.value,
    mission: `Do only the first observable slice of this mission: ${validation.value.mission}`,
    successCriterion: `A smaller but real signal exists: ${validation.value.successCriterion}`,
  };
}

export function simplifyMission(state, goalId, planInput, reason, now) {
  const goal = findGoal(state, goalId);
  if (!goal || goal.status !== "running") {
    throw new Error("Only a running mission can be simplified.");
  }
  const validation = validatePlan(planInput);
  if (!validation.valid) {
    throw new Error("The simplified mission is invalid.");
  }
  const cleanReason = cleanText(reason);
  if (!isMeaningful(cleanReason, 3)) {
    throw new Error("Say briefly why the mission needed to get smaller.");
  }

  const previous = JSON.stringify(goal.currentPlan);
  const next = JSON.stringify(validation.value);
  if (previous === next) {
    throw new Error("Change at least one mission field before saving a simplification.");
  }

  const revision = {
    type: "simplified",
    recordedAt: now,
    reason: cleanReason,
    from: clonePlan(goal.currentPlan),
    to: clonePlan(validation.value),
  };
  const updatedGoal = {
    ...goal,
    currentPlan: validation.value,
    revisions: [...goal.revisions, revision],
  };
  return replaceGoal(state, updatedGoal);
}

export function validateOutcome(input) {
  const status = cleanText(input.status).toLowerCase();
  const note = typeof input.note === "string" ? input.note.trim() : "";
  const url = cleanText(input.url);
  const postConfidence = parseNumber(input.postConfidence);
  const errors = {};

  if (!OUTCOME_STATUSES.has(status)) {
    errors.status = "Choose completed, attempted, or blocked.";
  }
  if (!isMeaningful(note, 2) && !url) {
    errors.evidence = "Add an evidence note or an evidence URL.";
  }
  if (note.length > 2000) {
    errors.note = "Evidence note must be 2,000 characters or fewer.";
  }
  if (url) {
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        errors.url = "Evidence URL must start with http:// or https://.";
      }
    } catch {
      errors.url = "Enter a complete evidence URL, including https://.";
    }
  }
  if (!Number.isInteger(postConfidence)
      || postConfidence < 0
      || postConfidence > 100) {
    errors.postConfidence = "Confidence must be a whole number from 0 to 100.";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    value: { status, note, url, postConfidence },
  };
}

export function recordOutcome(state, goalId, input, now) {
  const goal = findGoal(state, goalId);
  if (!goal || goal.status !== "running") {
    throw new Error("Only a running mission can record an outcome.");
  }
  const validation = validateOutcome(input);
  if (!validation.valid) {
    throw new Error("Cannot record invalid evidence.");
  }

  const updatedGoal = {
    ...goal,
    status: validation.value.status,
    outcome: {
      ...validation.value,
      recordedAt: now,
      confidenceDelta: validation.value.postConfidence - goal.intake.baselineConfidence,
    },
  };
  return replaceGoal(state, updatedGoal, null);
}

export function computeMetrics(state) {
  const goalsCreated = state.goals.length;
  const outcomesRecorded = state.goals.filter((goal) => goal.outcome !== null).length;
  const firstEvidenceRate = goalsCreated === 0 ? 0 : outcomesRecorded / goalsCreated;
  return {
    goalsCreated,
    outcomesRecorded,
    firstEvidenceRate,
    firstEvidencePercent: Math.round(firstEvidenceRate * 100),
  };
}

export function formatConfidenceDelta(delta) {
  if (delta > 0) {
    return `+${delta}`;
  }
  return String(delta);
}

function isStateShape(value) {
  return value
    && typeof value === "object"
    && value.version === STATE_VERSION
    && Array.isArray(value.goals)
    && (value.activeGoalId === null || typeof value.activeGoalId === "string");
}

export function serializeState(state) {
  if (!isStateShape(state)) {
    throw new Error("Refusing to serialize invalid application state.");
  }
  return JSON.stringify(state);
}

export function deserializeState(serialized) {
  if (!serialized) {
    return { state: createEmptyState(), recovered: false };
  }
  try {
    const parsed = JSON.parse(serialized);
    if (!isStateShape(parsed)) {
      throw new Error("Unsupported state shape.");
    }
    return { state: parsed, recovered: false };
  } catch {
    return { state: createEmptyState(), recovered: true };
  }
}
