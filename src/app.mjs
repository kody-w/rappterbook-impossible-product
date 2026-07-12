import {
  FRAME2_JOURNAL_KEY,
  FRAME2_STORAGE_KEY,
  JOURNAL_KEY,
  LEGACY_STORAGE_KEY,
  PACING_MODES,
  PROOF_PATTERNS,
  ROUTES,
  STORAGE_KEY,
  beginAction,
  changeDraftStrategy,
  compileDraft,
  computeMetrics,
  createEmptyState,
  createExport,
  createLinkedDraft,
  deserializeWorkspace,
  discardDraft,
  findGoal,
  formatConfidenceDelta,
  formatMinutes,
  formatScopeValue,
  getActiveEffortSeconds,
  getLineage,
  getRemainingEffortSeconds,
  getRemainingSeconds,
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
  setTimerHidden,
  shrinkDraft,
  startSprint,
  synthesizeLineage,
  updateDraftReview,
  validateIntake,
  validateOutcome,
  validatePlan,
} from "./core.mjs";

const panelNames = ["intake", "review", "sprint", "outcome", "receipt"];
const stepIndexes = { intake: 0, review: 1, sprint: 2, outcome: 3, receipt: 3 };
const fieldTargets = {
  proofPattern: "proof-pattern-ask",
  route: "route-act-now",
  scope: "scopeValue",
  actionKind: "action-taken",
  status: "status-completed",
  interpretation: "interpretation-supports",
  branchSupports: "supportsBranch",
  branchWeakens: "weakensBranch",
  branchInconclusive: "inconclusiveBranch",
};
const decisionLabels = {
  conclude: "Conclude / stop",
  replicate: "Replicate deliberately",
  pivot: "Revise / pivot",
  seek_support: "Seek access / support",
  continue: "Continue",
};

const element = (id) => document.getElementById(id);
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const writerId = globalThis.crypto?.randomUUID?.() ?? `tab-${Date.now()}`;

let state = createEmptyState();
let storageRevision = 0;
let storageAvailable = true;
let timerInterval = null;
let activePanel = "intake";
let receiptGoalId = null;

function makeElement(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix = "item") {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadState() {
  try {
    const probeKey = `${STORAGE_KEY}:probe`;
    localStorage.setItem(probeKey, "1");
    localStorage.removeItem(probeKey);
    const loaded = recoverWorkspace(
      localStorage.getItem(STORAGE_KEY),
      localStorage.getItem(JOURNAL_KEY),
      localStorage.getItem(LEGACY_STORAGE_KEY),
      localStorage.getItem(FRAME2_STORAGE_KEY),
      localStorage.getItem(FRAME2_JOURNAL_KEY),
    );
    state = loaded.state;
    storageRevision = loaded.revision;
    const recoveryWarning = element("recovery-warning");
    recoveryWarning.hidden = !loaded.recovered;
    if (loaded.recoveryReason === "newer_journal") {
      recoveryWarning.textContent = `A newer validated journal revision (${loaded.revision}) was loaded instead of the older primary copy.`;
    } else if (loaded.recoveryReason === "invalid_primary") {
      recoveryWarning.textContent = "The primary workspace was invalid. A semantically validated journal copy was recovered.";
    } else if (loaded.recoveryReason === "journal_only") {
      recoveryWarning.textContent = "The journal was the only saved workspace copy and was recovered successfully.";
    }
    const resetWarning = element("reset-warning");
    resetWarning.hidden = !loaded.reset;
    if (loaded.reset) {
      resetWarning.textContent = "Saved workspace copies were present, but none passed semantic validation. The app opened an empty workspace without claiming recovery; corrupt copies remain until you save or delete.";
    }
    element("migration-notice").hidden = !loaded.migrated;
    if (loaded.migrated || loaded.repaired) {
      persistState();
    }
  } catch {
    storageAvailable = false;
    element("storage-warning").hidden = false;
    state = createEmptyState();
  }
}

function persistState() {
  if (!storageAvailable) {
    return;
  }
  try {
    const currentRaw = localStorage.getItem(STORAGE_KEY);
    if (currentRaw) {
      try {
        const current = deserializeWorkspace(currentRaw);
        if (current.writerId !== writerId && current.revision >= storageRevision) {
          state = mergeStates(state, current.state);
          storageRevision = current.revision;
        }
      } catch {
        // Never replace valid in-memory state with a corrupt primary copy.
      }
    }
    storageRevision += 1;
    const serialized = serializeWorkspace(state, {
      revision: storageRevision,
      writtenAt: nowIso(),
      writerId,
    });
    localStorage.setItem(JOURNAL_KEY, serialized);
    localStorage.setItem(STORAGE_KEY, serialized);
    localStorage.removeItem(FRAME2_STORAGE_KEY);
    localStorage.removeItem(FRAME2_JOURNAL_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    storageAvailable = false;
    element("storage-warning").hidden = false;
  }
}

function announce(message) {
  const status = element("app-status");
  status.textContent = "";
  requestAnimationFrame(() => {
    status.textContent = message;
  });
}

function formatDate(value) {
  if (!value) {
    return "Not recorded";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatTimer(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function currentGoal() {
  return state.activeGoalId ? findGoal(state, state.activeGoalId) : null;
}

function showPanel(name, shouldFocus = true) {
  activePanel = name;
  for (const panelName of panelNames) {
    element(`${panelName}-panel`).hidden = panelName !== name;
  }
  const activeIndex = stepIndexes[name];
  document.querySelectorAll(".stepper li").forEach((step, index) => {
    step.classList.toggle("is-active", index === activeIndex);
    step.classList.toggle("is-complete", index < activeIndex || name === "receipt");
    if (index === activeIndex) {
      step.setAttribute("aria-current", "step");
    } else {
      step.removeAttribute("aria-current");
    }
  });
  if (shouldFocus) {
    const heading = element(`${name}-title`);
    heading.focus({ preventScroll: true });
    heading.scrollIntoView({
      behavior: prefersReducedMotion.matches ? "auto" : "smooth",
      block: "start",
    });
  }
}

function clearErrors(form, summaryId) {
  form.querySelectorAll("[aria-invalid='true']").forEach((control) => {
    control.removeAttribute("aria-invalid");
  });
  form.querySelectorAll(".field-error").forEach((message) => {
    message.textContent = "";
  });
  const summary = element(summaryId);
  summary.hidden = true;
  summary.querySelector("ul").replaceChildren();
}

function showErrors(form, summaryId, errors, targetOverrides = {}) {
  clearErrors(form, summaryId);
  const summary = element(summaryId);
  const list = summary.querySelector("ul");
  for (const [field, message] of Object.entries(errors)) {
    const targetId = targetOverrides[field] ?? fieldTargets[field] ?? field;
    const target = element(targetId) ?? form.querySelector(`[name="${field}"]`);
    target?.setAttribute("aria-invalid", "true");
    const messageElement = element(`${targetId}-error`) ?? element(`${field}-error`);
    if (messageElement) {
      messageElement.textContent = message;
    }
    const item = makeElement("li");
    const link = makeElement("a", "", message);
    link.href = target ? `#${target.id}` : `#${summaryId}`;
    item.append(link);
    list.append(item);
  }
  summary.hidden = false;
  summary.focus();
}

function formObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function renderMetrics() {
  const metrics = computeMetrics(state);
  element("metric-rate").textContent = `${metrics.criterionLinkedEvidencePercent}%`;
  const receiptWord = metrics.evidenceBearingReceipts === 1 ? "receipt" : "receipts";
  const sprintWord = metrics.sprintsStarted === 1 ? "sprint" : "sprints";
  element("metric-ratio").textContent = `${metrics.evidenceBearingReceipts} evidence-bearing ${receiptWord} / ${metrics.sprintsStarted} ${sprintWord} started`;
  element("metric-sprints").textContent = String(metrics.sprintsStarted);
  element("metric-evidence").textContent = String(metrics.evidenceBearingReceipts);
  element("metric-directional").textContent = String(metrics.directionalReceipts);
}

function readIntakeForm() {
  return formObject(element("intake-form"));
}

function setRadioValue(name, value) {
  document.querySelectorAll(`[name="${name}"]`).forEach((control) => {
    control.checked = control.value === value;
  });
}

function populateIntake(draft = state.draft) {
  const intake = draft?.intake;
  element("goal").value = intake?.goal ?? "";
  element("assumptionTarget").value = intake?.assumption.target ?? "";
  element("assumptionClaim").value = intake?.assumption.claim ?? "";
  element("assumptionSignal").value = intake?.assumption.signal ?? "";
  element("obstacle").value = intake?.obstacle ?? "";
  setRadioValue("proofPattern", intake?.proofPattern ?? "");
  setRadioValue("route", intake?.route ?? "act_now");
  element("safetySensitive").checked = Boolean(intake?.safetySensitive);
  element("outboundOptIn").checked = Boolean(intake?.outboundOptIn);
  element("draft-status").textContent = draft
    ? `Draft saved ${formatDate(draft.updatedAt)}.`
    : "Draft not saved yet.";
}

function autosaveIntake() {
  const now = nowIso();
  state = saveDraft(state, readIntakeForm(), {
    id: state.draft?.id ?? createId("draft"),
    assumptionId: state.draft?.intake.assumption.id ?? createId("belief"),
    now,
  });
  persistState();
  element("draft-status").textContent = `Draft saved ${formatDate(now)}.`;
}

function reviewInput() {
  const draft = state.draft;
  const parsedScope = Number(element("scopeValue").value);
  const scopeValue = Number.isInteger(parsedScope) ? parsedScope : draft.plan.scope.value;
  return {
    mission: element("mission").value,
    successCriterion: element("supportsBranch").value,
    stopCondition: element("stopCondition").value,
    artifactPayload: element("artifactPayload").value,
    branches: {
      supports: element("supportsBranch").value,
      weakens: element("weakensBranch").value,
      inconclusive: element("inconclusiveBranch").value,
    },
    route: element("reviewRoute").value,
    outboundAllowed: draft.plan.outboundAllowed,
    artifactKind: draft.plan.artifactKind,
    scope: { ...draft.plan.scope, value: scopeValue },
    goal: draft.intake.goal,
    obstacle: draft.intake.obstacle,
    proofPattern: element("reviewProofPattern").value,
    pacingMode: element("pacingMode").value,
    safetySensitive: draft.intake.safetySensitive,
    outboundOptIn: draft.intake.outboundOptIn,
    why: element("why").value,
    timeboxMinutes: element("timeboxMinutes").value,
    baselineConfidence: element("baselineConfidence").value,
  };
}

function renderReviewContext(draft) {
  const context = element("review-context");
  context.replaceChildren();
  const belief = makeElement("p");
  belief.append(makeElement("strong", "", "Assumption: "));
  belief.append(document.createTextNode(draft.intake.assumption.claim));
  const target = makeElement("p");
  target.append(makeElement("strong", "", "Target / unit: "));
  target.append(document.createTextNode(draft.intake.assumption.target));
  const signal = makeElement("p");
  signal.append(makeElement("strong", "", "Observable signal: "));
  signal.append(document.createTextNode(draft.intake.assumption.signal));
  const identifier = makeElement(
    "p",
    "lineage-note",
    `Belief ID ${draft.intake.assumption.id} · preserved across proof and successor changes`,
  );
  context.append(belief, target, signal, identifier);
  if (draft.predecessorId) {
    context.append(makeElement(
      "p",
      "lineage-note",
      `Linked successor to ${draft.predecessorId} · decision: ${draft.predecessorDecision.replaceAll("_", " ")}`,
    ));
  }
}

function updateStartButton() {
  const mode = element("pacingMode").value;
  const minutes = Number(element("timeboxMinutes").value) || 5;
  element("start-sprint").textContent = mode === "untimed"
    ? "Freeze untimed probe"
    : `Freeze ${formatMinutes(minutes)} ${mode === "active_effort" ? "active-effort" : "countdown"} probe`;
}

function setPacingVisibility() {
  const untimed = element("pacingMode").value === "untimed";
  element("timebox-field").hidden = untimed;
  element("timeboxMinutes").disabled = untimed;
  updateStartButton();
}

function setReviewValues(draft) {
  renderReviewContext(draft);
  element("reviewProofPattern").value = draft.intake.proofPattern;
  element("reviewRoute").value = draft.intake.route;
  element("mission").value = draft.plan.mission;
  element("artifactPayload").value = draft.plan.artifactPayload;
  element("supportsBranch").value = draft.plan.branches.supports;
  element("weakensBranch").value = draft.plan.branches.weakens;
  element("inconclusiveBranch").value = draft.plan.branches.inconclusive;
  element("successCriterion").value = draft.plan.branches.supports;
  element("stopCondition").value = draft.plan.stopCondition;
  element("scopeValue").value = String(draft.plan.scope.value);
  element("scopeValue").min = String(draft.plan.scope.min);
  element("scope-label").textContent = draft.plan.scope.label;
  element("scope-hint").textContent = `Minimum ${formatScopeValue(draft.plan.scope, draft.plan.scope.min)}; currently ${formatScopeValue(draft.plan.scope)}. “Reduce” must lower this number.`;
  element("pacingMode").value = draft.intake.pacingMode;
  element("timeboxMinutes").disabled = false;
  element("timeboxMinutes").value = String(draft.intake.timeboxMinutes ?? 5);
  element("why").value = draft.intake.why;
  element("baselineConfidence").value = draft.intake.baselineConfidence ?? "";
  setPacingVisibility();
}

function autosaveReview() {
  if (!state.draft?.plan) {
    return;
  }
  state = updateDraftReview(state, reviewInput(), nowIso());
  persistState();
}

function renderProvenance(goal) {
  const section = element("provenance-section");
  const list = element("provenance-list");
  list.replaceChildren();
  section.hidden = goal.revisions.length === 0;
  goal.revisions.forEach((revision, index) => {
    const item = makeElement("li");
    item.append(
      makeElement("strong", "", `Change ${index + 1} · ${formatDate(revision.recordedAt)}`),
      makeElement("div", "", revision.reason),
    );
    list.append(item);
  });
}

function renderTimer() {
  const goal = currentGoal();
  if (!goal || goal.status !== "running") {
    return;
  }
  const timerBlock = element("timer-block");
  const toggle = element("toggle-timer");
  const hidden = state.settings.timerHidden;
  timerBlock.hidden = hidden;
  toggle.textContent = hidden ? "Show pacing" : "Hide pacing";
  if (hidden) {
    return;
  }
  timerBlock.classList.remove("is-expired");
  if (goal.sprint.pacingMode === "untimed") {
    element("timer-label").textContent = "Untimed mode";
    element("sprint-timer").textContent = "—";
    element("sprint-timer").setAttribute("aria-label", "Untimed probe");
    element("timer-note").textContent = "No deadline or effort cap is running. Stop safely whenever needed.";
    return;
  }
  if (goal.sprint.pacingMode === "active_effort") {
    const remaining = getRemainingEffortSeconds(goal, nowIso());
    element("timer-label").textContent = "Active effort remaining";
    element("sprint-timer").textContent = formatTimer(remaining);
    element("sprint-timer").setAttribute("aria-label", `${remaining} active-effort seconds remaining`);
    timerBlock.classList.toggle("is-expired", remaining === 0 && goal.sprint.actionStartedAt);
    element("timer-note").textContent = !goal.sprint.actionStartedAt
      ? "The effort cap starts only when the action begins."
      : goal.sprint.effort.waitingSince
        ? "Paused while waiting for a response; waiting time does not count."
        : "Only active effort counts. You may record after the cap without invalidating evidence.";
    return;
  }
  const remaining = getRemainingSeconds(goal.sprint.endsAt);
  element("timer-label").textContent = "Optional countdown remaining";
  element("sprint-timer").textContent = formatTimer(remaining);
  element("sprint-timer").setAttribute("aria-label", `${remaining} seconds remaining`);
  timerBlock.classList.toggle("is-expired", remaining === 0);
  element("timer-note").textContent = remaining === 0
    ? "The reference countdown ended. Record completed, attempted, blocked, or safe stopped whenever ready."
    : "The countdown continues across reloads. A late result is still valid evidence.";
}

function startTimerUpdates() {
  stopTimerUpdates();
  renderTimer();
  timerInterval = window.setInterval(renderTimer, 1000);
}

function stopTimerUpdates() {
  if (timerInterval !== null) {
    window.clearInterval(timerInterval);
    timerInterval = null;
  }
}

function renderSprint(goal) {
  const plan = goal.preregisteredPlan;
  const begun = Boolean(goal.sprint.actionStartedAt);
  element("active-mission").textContent = plan.mission;
  element("active-assumption-id").textContent = goal.intake.assumption.id;
  element("active-assumption").textContent = `${goal.intake.assumption.target} — ${goal.intake.assumption.claim}`;
  element("active-success").textContent = plan.branches.supports;
  element("active-weakens").textContent = plan.branches.weakens;
  element("active-inconclusive").textContent = plan.branches.inconclusive;
  element("active-stop").textContent = plan.stopCondition;
  element("active-scope").textContent = `${plan.scope.label}: ${formatScopeValue(plan.scope)}`;
  element("frozen-at").textContent = formatDate(goal.sprint.startedAt);
  element("action-started-at").textContent = begun
    ? formatDate(goal.sprint.actionStartedAt)
    : "Not begun";
  element("active-payload").textContent = plan.artifactPayload;
  element("outbound-badge").textContent = plan.outboundAllowed
    ? "Outbound explicitly allowed"
    : "Private / no outbound";
  element("copy-begin").disabled = begun;
  element("begin-only").disabled = begun;
  element("open-outcome").disabled = !begun;
  element("copy-begin").textContent = goal.intake.route === "safe_stop"
    ? "Copy safe-stop note & begin"
    : "Copy & begin";
  const showEffort = goal.sprint.pacingMode === "active_effort"
    && ["ask", "send"].includes(goal.intake.proofPattern)
    && begun;
  element("effort-controls").hidden = !showEffort;
  if (showEffort) {
    const waiting = Boolean(goal.sprint.effort.waitingSince);
    element("pause-response").hidden = waiting;
    element("resume-effort").hidden = !waiting;
    element("effort-note").textContent = waiting
      ? `Waiting is paused. ${getActiveEffortSeconds(goal, nowIso())} active-effort seconds recorded.`
      : "Only active effort counts. Pause when the probe is waiting for a response.";
  }
  renderProvenance(goal);
  renderTimer();
}

function appendDefinition(list, term, value) {
  const wrapper = makeElement("div");
  wrapper.append(makeElement("dt", "", term), makeElement("dd", "", value));
  list.append(wrapper);
}

function confidenceValue(value) {
  return value === null ? "Not provided" : `${value}%`;
}

function latestDecision(goal) {
  return goal.decisions.at(-1) ?? null;
}

function renderReceipt(goal) {
  receiptGoalId = goal.id;
  const receipt = element("receipt");
  receipt.replaceChildren();
  const header = makeElement("div", "receipt-header");
  header.append(
    makeElement("span", "status-badge", goal.outcome.status.replaceAll("_", " ")),
    makeElement("span", "history-meta", formatDate(goal.outcome.recordedAt)),
  );
  const title = makeElement("h3", "", goal.intake.goal);
  const mission = makeElement("p", "mission-text", goal.preregisteredPlan.mission);
  const confidence = makeElement("div", "confidence-row");
  [
    [confidenceValue(goal.intake.baselineConfidence), "Before"],
    [confidenceValue(goal.outcome.postConfidence), "After"],
    [formatConfidenceDelta(goal.outcome.confidenceDelta), "Confidence effect"],
  ].forEach(([value, label]) => {
    const item = makeElement("div");
    item.append(makeElement("strong", "", value), makeElement("span", "", label));
    confidence.append(item);
  });
  const details = makeElement("dl");
  appendDefinition(details, "Assumption ID", goal.intake.assumption.id);
  appendDefinition(details, "Target / unit", goal.intake.assumption.target);
  appendDefinition(details, "Claim", goal.intake.assumption.claim);
  appendDefinition(details, "Observable signal", goal.intake.assumption.signal);
  appendDefinition(details, "Supports branch", goal.preregisteredPlan.branches.supports);
  appendDefinition(details, "Weakens branch", goal.preregisteredPlan.branches.weakens);
  appendDefinition(details, "Inconclusive branch", goal.preregisteredPlan.branches.inconclusive);
  appendDefinition(details, "Interpretation", goal.outcome.interpretation);
  appendDefinition(details, "Diagnosis", goal.outcome.diagnosis.replaceAll("_", " "));
  appendDefinition(details, "Self-recorded observation", goal.outcome.observation);
  appendDefinition(
    details,
    "Belief criterion",
    goal.outcome.beliefCriterionMet
      ? "Directional signal recorded after explicit action start"
      : "Not satisfied; activity or blocked/inconclusive evidence is not directional",
  );
  appendDefinition(details, "Verification boundary", "Not independently verified");
  appendDefinition(details, "Sprint frozen", formatDate(goal.sprint.startedAt));
  appendDefinition(
    details,
    "Action began",
    goal.sprint.actionStartedAt
      ? `${formatDate(goal.sprint.actionStartedAt)} · ${goal.sprint.actionStartSource.replaceAll("_", " ")}`
      : goal.sprint.actionStartSource === "frame2_receipt_unknown"
        ? "Unknown in migrated Frame 2 data; receipt timestamp was not relabeled as action start"
        : "Did not begin",
  );
  appendDefinition(details, "Receipt saved", formatDate(goal.outcome.recordedAt));
  appendDefinition(
    details,
    "Active effort",
    `${goal.sprint.action.activeEffortSeconds} seconds; response waiting excluded when paused`,
  );
  if (goal.outcome.url) {
    const wrapper = makeElement("div");
    wrapper.append(makeElement("dt", "", "Supporting URL (not verified)"));
    const description = makeElement("dd");
    const link = makeElement("a", "", goal.outcome.url);
    link.href = goal.outcome.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    description.append(link);
    wrapper.append(description);
    details.append(wrapper);
  }
  const decision = latestDecision(goal);
  if (decision) {
    appendDefinition(
      details,
      "Latest persisted decision",
      `${decision.kind.replaceAll("_", " ")} — ${decision.reason}${decision.override ? " (override)" : ""}`,
    );
  }
  receipt.append(header, title, mission, confidence, details);
  renderLineage(goal);
  renderDecision(goal);
}

function renderLineage(goal) {
  const lineage = getLineage(state, goal.lineageRootId);
  const synthesis = synthesizeLineage(state, goal.lineageRootId);
  element("lineage-state").textContent = synthesis.currentSupportState.replaceAll("_", " ");
  element("lineage-synthesis").textContent = synthesis.summary;
  const list = element("lineage-list");
  list.replaceChildren();
  lineage.forEach((item, index) => {
    const successor = lineage.find((candidate) => candidate.predecessorId === item.id);
    const entry = makeElement("li", synthesis.duplicateGoalIds.includes(item.id) ? "duplicate-proof" : "");
    entry.append(makeElement("h4", "", `Probe ${index + 1} · ${item.intake.proofPattern} · ${ROUTES[item.intake.route]}`));
    const definitions = makeElement("dl");
    appendDefinition(definitions, "Assumption", `${item.intake.assumption.id}: ${item.intake.assumption.claim}`);
    appendDefinition(
      definitions,
      "Frozen branches",
      `Supports: ${item.preregisteredPlan.branches.supports} Weakens: ${item.preregisteredPlan.branches.weakens} Inconclusive: ${item.preregisteredPlan.branches.inconclusive}`,
    );
    appendDefinition(
      definitions,
      "Action / observation",
      item.outcome
        ? `${item.sprint.actionStartedAt ? `Began ${formatDate(item.sprint.actionStartedAt)}` : "Did not begin"}. ${item.outcome.observation}`
        : "No receipt yet.",
    );
    appendDefinition(
      definitions,
      "Interpretation / confidence",
      item.outcome
        ? `${item.outcome.interpretation}; confidence effect ${formatConfidenceDelta(item.outcome.confidenceDelta)}`
        : "Pending",
    );
    appendDefinition(
      definitions,
      "Decision",
      item.decisions.length
        ? item.decisions.map((decision) => `${decision.kind}: ${decision.reason}`).join(" | ")
        : "Not yet recorded",
    );
    appendDefinition(
      definitions,
      "Successor",
      successor
        ? `${successor.id} via ${successor.predecessorDecision.replaceAll("_", " ")}`
        : "None",
    );
    entry.append(definitions);
    list.append(entry);
  });
  const recommended = recommendNextDecision(goal, synthesis);
  const brief = element("decision-brief-copy");
  brief.replaceChildren();
  brief.append(
    makeElement("p", "", `Assumption: ${goal.intake.assumption.claim}`),
    makeElement("p", "", `Current support state: ${synthesis.currentSupportState.replaceAll("_", " ")} across ${synthesis.receiptCount} receipt${synthesis.receiptCount === 1 ? "" : "s"}.`),
    makeElement("p", "", synthesis.contradiction
      ? "Contradiction detected; a discriminating replication may be more useful than repetition."
      : synthesis.duplicateLowInformation
        ? "Duplicate low-information proof detected. Change the action, route, criterion, or rival explanation before repeating."
        : `Deterministic next recommendation: ${decisionLabels[recommended]}.`),
    makeElement("p", "inline-note", "This brief is generated locally from self-recorded directional evidence. It does not imply statistical certainty."),
  );
}

function setDecisionButton(button, action, text) {
  button.dataset.action = action;
  button.textContent = text;
}

function decisionCopy(decision, goal) {
  if (decision === "seek_support") {
    return "Blocked access is a diagnosis, not an effort failure. A successor can change route, action, criterion, or accommodation.";
  }
  if (decision === "pivot") {
    return `Diagnosis: ${goal.outcome.diagnosis.replaceAll("_", " ")}. Change the discriminating proof rather than blindly shrinking it.`;
  }
  if (decision === "replicate") {
    return "Replicate only with a reason and a discriminating change or deliberate same-test check.";
  }
  if (decision === "continue") {
    return "Continue while preserving this receipt and belief ID; the next proof remains editable before freezing.";
  }
  return "Conclude at the current directional support state. This is a reasoned stop, not a claim of statistical certainty.";
}

function renderDecision(goal) {
  const synthesis = synthesizeLineage(state, goal.lineageRootId);
  const recommended = recommendNextDecision(goal, synthesis);
  element("decision-title").textContent = `Recommended: ${decisionLabels[recommended]}`;
  element("decision-copy").textContent = decisionCopy(recommended, goal);
  setDecisionButton(
    element("decision-primary"),
    recommended,
    decisionLabels[recommended],
  );
  const secondary = recommended === "conclude" ? "replicate" : "conclude";
  setDecisionButton(element("decision-secondary"), secondary, decisionLabels[secondary]);
  const saved = latestDecision(goal);
  element("decision-reason").value = "";
  element("decision-reason").placeholder = saved
    ? `Latest: ${saved.reason}`
    : "What makes this the right next decision?";
  element("decision-error").textContent = "";
}

function renderHistory() {
  const list = element("history-list");
  const empty = element("history-empty");
  list.replaceChildren();
  empty.hidden = state.goals.length !== 0;
  [...state.goals].reverse().forEach((goal, reverseIndex) => {
    const item = makeElement("li", "history-card");
    const index = makeElement("span", "history-index", String(state.goals.length - reverseIndex));
    const content = makeElement("div");
    content.append(makeElement("h3", "", goal.intake.assumption.claim));
    const statusText = goal.outcome
      ? `${goal.outcome.status.replaceAll("_", " ")} · ${goal.outcome.interpretation} · ${goal.decisions.length} decision${goal.decisions.length === 1 ? "" : "s"}`
      : "Probe frozen · action and receipt pending";
    content.append(makeElement("p", "", statusText));
    content.append(makeElement("p", "", `${goal.intake.assumption.id} · ${goal.preregisteredPlan.mission}`));
    const side = makeElement("div", "history-meta");
    side.append(makeElement("span", "", formatDate(goal.createdAt)));
    const viewButton = makeElement(
      "button",
      "button button-secondary",
      goal.outcome ? "View lineage" : "Resume probe",
    );
    viewButton.type = "button";
    if (goal.outcome) {
      viewButton.dataset.receiptId = goal.id;
    } else {
      viewButton.dataset.resumeId = goal.id;
    }
    side.append(viewButton);
    item.append(index, content, side);
    list.append(item);
  });
}

function renderAll() {
  renderMetrics();
  renderHistory();
}

function restoreFlow(shouldFocus = false) {
  const goal = currentGoal();
  if (goal?.status === "running") {
    renderSprint(goal);
    startTimerUpdates();
    showPanel("sprint", shouldFocus);
    return;
  }
  stopTimerUpdates();
  if (state.draft?.stage === "review" && state.draft.plan) {
    setReviewValues(state.draft);
    showPanel("review", shouldFocus);
    return;
  }
  populateIntake(state.draft);
  showPanel("intake", shouldFocus);
}

function handleIntakeSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const input = readIntakeForm();
  const result = validateIntake(input);
  clearErrors(form, "intake-errors");
  if (!result.valid) {
    showErrors(form, "intake-errors", result.errors);
    return;
  }
  state = compileDraft(state, input, {
    id: state.draft?.id ?? createId("draft"),
    assumptionId: state.draft?.intake.assumption.id ?? createId("belief"),
    now: nowIso(),
  });
  persistState();
  setReviewValues(state.draft);
  showPanel("review");
  announce("Decision-grade probe compiled. Review its handoff and directional branches.");
}

function syncPacingText() {
  const mode = element("pacingMode").value;
  const minutes = Number(element("timeboxMinutes").value) || 5;
  const stop = element("stopCondition");
  if (mode === "untimed") {
    stop.value = "Stop when the frozen branches can be judged, or stop safely at any time.";
  } else if (mode === "active_effort") {
    stop.value = `Stop when the frozen branches can be judged or after ${formatMinutes(minutes)} of active effort; waiting does not count.`;
  } else {
    stop.value = `Stop when the frozen branches can be judged or after ${formatMinutes(minutes)}, whichever comes first.`;
  }
  setPacingVisibility();
  autosaveReview();
}

function handleStrategyChange() {
  autosaveReview();
  try {
    state = changeDraftStrategy(state, {
      proofPattern: element("reviewProofPattern").value,
      route: element("reviewRoute").value,
      pacingMode: element("pacingMode").value,
      timeboxMinutes: element("timeboxMinutes").value,
    }, nowIso());
    persistState();
    setReviewValues(state.draft);
    announce("Proof action and route recompiled; the belief ID stayed the same.");
  } catch (error) {
    showErrors(element("review-form"), "review-errors", { route: error.message });
  }
}

function handleShrinkDraft() {
  autosaveReview();
  const result = validatePlan(state.draft.plan);
  if (!result.valid) {
    showErrors(element("review-form"), "review-errors", result.errors);
    return;
  }
  try {
    state = shrinkDraft(state, nowIso());
    persistState();
    setReviewValues(state.draft);
    announce(`Declared ${state.draft.plan.scope.label.toLowerCase()} reduced to ${state.draft.plan.scope.value}.`);
  } catch (error) {
    showErrors(element("review-form"), "review-errors", { scope: error.message });
  }
}

function handleReviewSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  autosaveReview();
  const intakeResult = validateIntake(state.draft.intake);
  const planResult = validatePlan(state.draft.plan);
  const errors = { ...intakeResult.errors, ...planResult.errors };
  clearErrors(form, "review-errors");
  if (Object.keys(errors).length > 0) {
    showErrors(form, "review-errors", errors);
    return;
  }
  const startedAt = nowIso();
  state = startSprint(state, {
    id: createId("probe"),
    now: startedAt,
    nowMilliseconds: Date.parse(startedAt),
  });
  persistState();
  renderAll();
  renderSprint(currentGoal());
  startTimerUpdates();
  showPanel("sprint");
  announce("Probe frozen. The action has not begun; use the explicit begin control.");
}

function backToIntake() {
  autosaveReview();
  state = {
    ...state,
    draft: { ...state.draft, stage: "intake", updatedAt: nowIso() },
  };
  persistState();
  populateIntake(state.draft);
  showPanel("intake");
  announce("Back at the assumption draft. Nothing entered history.");
}

async function handleBeginAction(copyPayload) {
  const goal = currentGoal();
  let copied = false;
  if (copyPayload) {
    try {
      await navigator.clipboard.writeText(goal.preregisteredPlan.artifactPayload);
      copied = true;
    } catch {
      copied = false;
    }
  }
  const beganAt = nowIso();
  state = beginAction(state, goal.id, beganAt, copyPayload ? "copy_begin" : "begin_only");
  persistState();
  renderSprint(currentGoal());
  element("copy-status").textContent = copyPayload
    ? copied
      ? `Copied. Action began ${formatDate(beganAt)}.`
      : `Clipboard unavailable. Action still began ${formatDate(beganAt)}; select the handoff text manually if needed.`
    : `Action began ${formatDate(beganAt)} without copying.`;
  announce("Action start recorded separately from probe freeze and receipt time.");
}

function handlePauseResponse() {
  const goal = currentGoal();
  state = pauseForResponse(state, goal.id, nowIso());
  persistState();
  renderSprint(currentGoal());
  announce("Active effort paused while waiting for a response.");
}

function handleResumeEffort() {
  const goal = currentGoal();
  state = resumeActiveEffort(state, goal.id, nowIso());
  persistState();
  renderSprint(currentGoal());
  announce("Active effort resumed.");
}

function setOutcomeBranches(goal) {
  element("outcome-criterion").textContent = [
    `Supports — ${goal.preregisteredPlan.branches.supports}`,
    `Weakens — ${goal.preregisteredPlan.branches.weakens}`,
    `Inconclusive — ${goal.preregisteredPlan.branches.inconclusive}`,
  ].join(" ");
}

function openOutcomePanel(mode = "action") {
  const goal = currentGoal();
  stopTimerUpdates();
  element("outcome-form").reset();
  setOutcomeBranches(goal);
  element("postConfidence").value = "";
  if (mode === "barrier") {
    if (goal.intake.route === "safe_stop") {
      setRadioValue("actionKind", "safe_stop");
      setRadioValue("status", "safe_stopped");
      setRadioValue("interpretation", "blocked");
    } else {
      setRadioValue("actionKind", "could_not_start");
      setRadioValue("status", "blocked");
      setRadioValue("interpretation", "blocked");
    }
    element("diagnosis").value = "blocked_access";
  } else {
    setRadioValue("actionKind", "taken");
  }
  showPanel("outcome");
  announce("Receipt opened. Pacing updates are frozen while you record.");
}

function handleOutcomeSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const result = validateOutcome(formObject(form));
  clearErrors(form, "outcome-errors");
  if (!result.valid) {
    showErrors(form, "outcome-errors", result.errors);
    return;
  }
  const goalId = currentGoal().id;
  try {
    state = recordOutcome(state, goalId, result.value, nowIso());
  } catch (error) {
    showErrors(form, "outcome-errors", { actionKind: error.message });
    return;
  }
  persistState();
  stopTimerUpdates();
  renderAll();
  const goal = findGoal(state, goalId);
  renderReceipt(goal);
  showPanel("receipt");
  announce(`${goal.outcome.status.replaceAll("_", " ")} recorded; interpretation ${goal.outcome.interpretation}.`);
  form.reset();
}

function backToSprint() {
  renderSprint(currentGoal());
  startTimerUpdates();
  showPanel("sprint");
  announce("Returned to the frozen probe. No receipt was saved.");
}

function startFresh() {
  receiptGoalId = null;
  element("intake-form").reset();
  populateIntake(null);
  showPanel("intake");
  announce("Decision saved. Ready for another assumption.");
}

function createSuccessor(decision) {
  const source = findGoal(state, receiptGoalId);
  state = createLinkedDraft(state, source.id, decision, {
    id: createId("draft"),
    now: nowIso(),
  });
  persistState();
  setReviewValues(state.draft);
  showPanel("review");
  announce("Reasoned successor created. Change its route, proof, or criterion before freezing.");
}

function handleDecision(event) {
  const action = event.currentTarget.dataset.action
    ?? event.currentTarget.dataset.decision;
  const source = findGoal(state, receiptGoalId);
  const reason = element("decision-reason").value;
  try {
    state = recordDecision(
      state,
      source.id,
      action,
      reason,
      nowIso(),
      createId("decision"),
    );
  } catch (error) {
    element("decision-error").textContent = error.message;
    element("decision-reason").focus();
    return;
  }
  persistState();
  renderAll();
  if (action === "conclude") {
    startFresh();
  } else {
    createSuccessor(action);
  }
}

function openReceiptFromHistory(goalId) {
  const goal = findGoal(state, goalId);
  if (!goal?.outcome) {
    return;
  }
  renderReceipt(goal);
  showPanel("receipt");
}

function resumeSprint(goalId) {
  const goal = findGoal(state, goalId);
  if (!goal || goal.status !== "running") {
    return;
  }
  state = { ...state, activeGoalId: goal.id };
  persistState();
  renderSprint(goal);
  startTimerUpdates();
  showPanel("sprint");
}

function openDialog(id) {
  const dialog = element(id);
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  }
}

function confirmDiscardDraft() {
  state = discardDraft(state);
  persistState();
  element("discard-dialog").close();
  element("intake-form").reset();
  populateIntake(null);
  showPanel("intake");
  announce("Uncommitted draft discarded. Probe history was preserved.");
}

function exportData() {
  try {
    const serialized = createExport(state, nowIso());
    const blob = new Blob([serialized], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `proof-of-possible-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    element("import-status").textContent = "Export created. It contains readable private data.";
    announce("Workspace exported as JSON.");
  } catch {
    element("import-status").textContent = "Export failed; no local data changed.";
  }
}

async function importData(event) {
  const input = event.currentTarget;
  const [file] = input.files;
  if (!file) {
    return;
  }
  try {
    const imported = parseImport(await file.text());
    state = mergeStates(state, imported);
    persistState();
    renderAll();
    restoreFlow(false);
    element("import-status").textContent = "Validated import merged successfully. Existing receipts and decisions were preserved.";
    announce("Validated workspace imported.");
  } catch (error) {
    element("import-status").textContent = `Import rejected: ${error.message} No local data changed.`;
    announce("Import rejected without changing local data.");
  } finally {
    input.value = "";
  }
}

function focusMainContent() {
  requestAnimationFrame(() => {
    element("main-content").focus({ preventScroll: true });
  });
}

function clearLocalData() {
  stopTimerUpdates();
  state = createEmptyState();
  storageRevision = 0;
  if (storageAvailable) {
    [
      STORAGE_KEY,
      JOURNAL_KEY,
      FRAME2_STORAGE_KEY,
      FRAME2_JOURNAL_KEY,
      LEGACY_STORAGE_KEY,
    ].forEach((key) => localStorage.removeItem(key));
  }
  element("clear-dialog").close();
  element("intake-form").reset();
  renderAll();
  populateIntake(null);
  showPanel("intake");
  element("import-status").textContent = "Local workspace and recovery journals deleted.";
  announce("All Proof of Possible data was deleted from this browser profile.");
}

function toggleTimer() {
  state = setTimerHidden(state, !state.settings.timerHidden, nowIso());
  persistState();
  renderTimer();
  announce(state.settings.timerHidden ? "Pacing display hidden." : "Pacing display shown.");
}

function renderTimeline(data) {
  const timeline = element("evolution-timeline");
  timeline.replaceChildren();
  for (const frame of data.frames) {
    const item = makeElement("li", frame.status === "shipped" ? "frame-shipped" : "frame-pending");
    item.append(makeElement("span", "frame-number", `Frame ${frame.frame} · ${frame.status}`));
    item.append(makeElement("h3", "", frame.title));
    item.append(makeElement("p", "", frame.summary));
    if (Array.isArray(frame.mutations) && frame.mutations.length > 0) {
      const list = makeElement("ul");
      frame.mutations.forEach((mutation) => list.append(makeElement("li", "", mutation)));
      item.append(list);
    }
    timeline.append(item);
  }
}

async function loadTimeline() {
  try {
    const response = await fetch("./evolution/timeline.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Timeline returned ${response.status}`);
    }
    renderTimeline(await response.json());
  } catch {
    element("evolution-timeline").replaceChildren(makeElement(
      "li",
      "timeline-loading",
      "Evolution data is unavailable. Frame evidence remains available from the footer.",
    ));
  }
}

async function loadProvenance() {
  const target = element("release-provenance");
  try {
    const response = await fetch("./provenance.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Provenance returned ${response.status}`);
    }
    const provenance = await response.json();
    if (typeof provenance.GITHUB_SHA !== "string"
        || typeof provenance.contentDigest?.value !== "string") {
      throw new Error("Provenance shape is invalid");
    }
    const source = provenance.GITHUB_SHA.slice(0, 12);
    const content = provenance.contentDigest.value.slice(0, 12);
    target.textContent = `Release ${source} · content ${content}`;
  } catch {
    target.textContent = "Deployed release provenance unavailable.";
  }
}

function handleStorageEvent(event) {
  if (event.key !== STORAGE_KEY) {
    return;
  }
  if (!event.newValue) {
    stopTimerUpdates();
    state = createEmptyState();
    storageRevision = 0;
    renderAll();
    restoreFlow(false);
    announce("Workspace deletion from another tab was applied here.");
    return;
  }
  try {
    const incoming = deserializeWorkspace(event.newValue);
    if (incoming.writerId === writerId || incoming.revision < storageRevision) {
      return;
    }
    state = mergeStates(state, incoming.state);
    storageRevision = incoming.revision;
    renderAll();
    if (["intake", "review", "sprint"].includes(activePanel)) {
      restoreFlow(false);
    } else if (activePanel === "receipt" && receiptGoalId) {
      renderReceipt(findGoal(state, receiptGoalId));
    }
    announce("Workspace merged with a newer revision from another tab.");
  } catch {
    announce("Ignored an invalid workspace update from another tab.");
  }
}

function bindEvents() {
  document.querySelector(".skip-link").addEventListener("click", focusMainContent);
  const intakeForm = element("intake-form");
  intakeForm.addEventListener("submit", handleIntakeSubmit);
  intakeForm.addEventListener("input", autosaveIntake);
  intakeForm.addEventListener("change", autosaveIntake);

  const reviewForm = element("review-form");
  reviewForm.addEventListener("submit", handleReviewSubmit);
  reviewForm.addEventListener("input", autosaveReview);
  element("pacingMode").addEventListener("change", syncPacingText);
  element("timeboxMinutes").addEventListener("change", syncPacingText);
  element("reviewProofPattern").addEventListener("change", handleStrategyChange);
  element("reviewRoute").addEventListener("change", handleStrategyChange);
  element("shrink-draft").addEventListener("click", handleShrinkDraft);
  element("back-to-intake").addEventListener("click", backToIntake);
  element("discard-draft").addEventListener("click", () => openDialog("discard-dialog"));
  element("cancel-discard").addEventListener("click", () => element("discard-dialog").close());
  element("confirm-discard").addEventListener("click", confirmDiscardDraft);

  element("toggle-timer").addEventListener("click", toggleTimer);
  element("copy-begin").addEventListener("click", () => handleBeginAction(true));
  element("begin-only").addEventListener("click", () => handleBeginAction(false));
  element("pause-response").addEventListener("click", handlePauseResponse);
  element("resume-effort").addEventListener("click", handleResumeEffort);
  element("open-outcome").addEventListener("click", () => openOutcomePanel("action"));
  element("record-barrier").addEventListener("click", () => openOutcomePanel("barrier"));
  element("back-to-sprint").addEventListener("click", backToSprint);
  element("outcome-form").addEventListener("submit", handleOutcomeSubmit);
  element("action-could-not-start").addEventListener("change", () => {
    setRadioValue("status", "blocked");
    setRadioValue("interpretation", "blocked");
    element("diagnosis").value = "blocked_access";
  });
  element("action-safe-stop").addEventListener("change", () => {
    setRadioValue("status", "safe_stopped");
    setRadioValue("interpretation", "blocked");
    element("diagnosis").value = "blocked_access";
  });
  element("decision-primary").addEventListener("click", handleDecision);
  element("decision-secondary").addEventListener("click", handleDecision);
  document.querySelector(".decision-options").addEventListener("click", (event) => {
    const button = event.target.closest("[data-decision]");
    if (button) {
      handleDecision({ currentTarget: button });
    }
  });

  element("history-list").addEventListener("click", (event) => {
    const receiptButton = event.target.closest("[data-receipt-id]");
    const resumeButton = event.target.closest("[data-resume-id]");
    if (receiptButton) {
      openReceiptFromHistory(receiptButton.dataset.receiptId);
    } else if (resumeButton) {
      resumeSprint(resumeButton.dataset.resumeId);
    }
  });

  element("export-data").addEventListener("click", exportData);
  element("import-data").addEventListener("click", () => element("import-file").click());
  element("import-file").addEventListener("change", importData);
  element("clear-data").addEventListener("click", () => openDialog("clear-dialog"));
  element("cancel-clear").addEventListener("click", () => element("clear-dialog").close());
  element("confirm-clear").addEventListener("click", clearLocalData);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && activePanel === "sprint") {
      renderTimer();
    }
  });
  window.addEventListener("storage", handleStorageEvent);
}

loadState();
bindEvents();
renderAll();
restoreFlow(false);
loadTimeline();
loadProvenance();
