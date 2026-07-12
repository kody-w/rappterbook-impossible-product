import {
  JOURNAL_KEY,
  LEGACY_STORAGE_KEY,
  PROOF_PATTERNS,
  STORAGE_KEY,
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
  getRemainingSeconds,
  mergeStates,
  parseImport,
  recommendNextDecision,
  recordOutcome,
  recoverWorkspace,
  saveDraft,
  serializeWorkspace,
  setTimerHidden,
  shrinkDraft,
  startSprint,
  updateDraftReview,
  validateIntake,
  validateOutcome,
  validatePlan,
} from "./core.mjs";

const panelNames = ["intake", "review", "sprint", "outcome", "receipt"];
const stepIndexes = { intake: 0, review: 1, sprint: 2, outcome: 3, receipt: 3 };
const fieldTargets = {
  proofPattern: "proof-pattern-ask",
  scope: "scopeValue",
  actionKind: "action-taken",
  status: "status-completed",
  criterionVerdict: "verdict-observed",
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
        if (current.writerId !== writerId
            && current.revision >= storageRevision) {
          state = mergeStates(state, current.state);
          storageRevision = current.revision;
        }
      } catch {
        // A valid in-memory or journal state must not be replaced by corrupt primary data.
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
}

function readIntakeForm() {
  return formObject(element("intake-form"));
}

function populateIntake(draft = state.draft) {
  const intake = draft?.intake;
  element("goal").value = intake?.goal ?? "";
  element("obstacle").value = intake?.obstacle ?? "";
  document.querySelectorAll("[name='proofPattern']").forEach((control) => {
    control.checked = control.value === intake?.proofPattern;
  });
  element("draft-status").textContent = draft
    ? `Draft saved ${formatDate(draft.updatedAt)}.`
    : "Draft not saved yet.";
}

function autosaveIntake() {
  const now = nowIso();
  state = saveDraft(state, readIntakeForm(), {
    id: state.draft?.id ?? createId("draft"),
    now,
  });
  persistState();
  element("draft-status").textContent = `Draft saved ${formatDate(now)}.`;
}

function reviewInput() {
  const draft = state.draft;
  const parsedScope = Number(element("scopeValue").value);
  const scopeValue = Number.isInteger(parsedScope)
    ? parsedScope
    : draft.plan.scope.value;
  return {
    mission: element("mission").value,
    successCriterion: element("successCriterion").value,
    stopCondition: element("stopCondition").value,
    scope: { ...draft.plan.scope, value: scopeValue },
    goal: draft.intake.goal,
    obstacle: draft.intake.obstacle,
    proofPattern: draft.intake.proofPattern,
    why: element("why").value,
    timeboxMinutes: element("timeboxMinutes").value,
    baselineConfidence: element("baselineConfidence").value,
  };
}

function renderReviewContext(draft) {
  const context = element("review-context");
  context.replaceChildren();
  const goal = makeElement("p");
  goal.append(makeElement("strong", "", "Goal: "));
  goal.append(document.createTextNode(draft.intake.goal));
  const constraint = makeElement("p");
  constraint.append(makeElement("strong", "", "Constraint: "));
  constraint.append(document.createTextNode(draft.intake.obstacle));
  const pattern = makeElement("p");
  pattern.append(makeElement("strong", "", "Pattern: "));
  pattern.append(document.createTextNode(PROOF_PATTERNS[draft.intake.proofPattern].label));
  context.append(goal, constraint, pattern);
  if (draft.predecessorId) {
    const lineage = makeElement("p", "lineage-note", `Linked successor to ${draft.predecessorId} · decision: ${draft.decision.replaceAll("_", " ")}`);
    context.append(lineage);
  }
}

function updateStartButton() {
  const minutes = Number(element("timeboxMinutes").value) || 5;
  element("start-sprint").textContent = `Freeze and start ${formatMinutes(minutes)} sprint`;
}

function setReviewValues(draft) {
  renderReviewContext(draft);
  element("mission").value = draft.plan.mission;
  element("successCriterion").value = draft.plan.successCriterion;
  element("stopCondition").value = draft.plan.stopCondition;
  element("scopeValue").value = String(draft.plan.scope.value);
  element("scopeValue").min = String(draft.plan.scope.min);
  element("scope-label").textContent = draft.plan.scope.label;
  element("scope-hint").textContent = `Minimum ${formatScopeValue(draft.plan.scope, draft.plan.scope.min)}; currently ${formatScopeValue(draft.plan.scope)}. “Reduce” must lower this number.`;
  element("timeboxMinutes").value = String(draft.intake.timeboxMinutes);
  element("why").value = draft.intake.why;
  element("baselineConfidence").value = String(draft.intake.baselineConfidence);
  updateStartButton();
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
  const hidden = state.settings.timerHidden;
  timerBlock.hidden = hidden;
  element("toggle-timer").textContent = hidden ? "Show countdown" : "Hide countdown";
  if (hidden) {
    return;
  }
  const remaining = getRemainingSeconds(goal.sprint.endsAt);
  element("sprint-timer").textContent = formatTimer(remaining);
  element("sprint-timer").setAttribute("aria-label", `${remaining} seconds remaining`);
  timerBlock.classList.toggle("is-expired", remaining === 0);
  element("timer-note").textContent = remaining === 0
    ? "The reference timebox ended. Record completed, attempted, or blocked whenever you are ready."
    : "The deadline continues across reloads. A late result is still valid evidence.";
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
  element("active-mission").textContent = plan.mission;
  element("active-success").textContent = plan.successCriterion;
  element("active-stop").textContent = plan.stopCondition;
  element("active-scope").textContent = `${plan.scope.label}: ${formatScopeValue(plan.scope)}`;
  element("frozen-at").textContent = formatDate(goal.sprint.startedAt);
  renderProvenance(goal);
  renderTimer();
}

function appendDefinition(list, term, value) {
  const wrapper = makeElement("div");
  wrapper.append(makeElement("dt", "", term), makeElement("dd", "", value));
  list.append(wrapper);
}

function renderReceipt(goal) {
  receiptGoalId = goal.id;
  const receipt = element("receipt");
  receipt.replaceChildren();

  const header = makeElement("div", "receipt-header");
  const badge = makeElement("span", "status-badge", goal.outcome.status);
  const date = makeElement("span", "history-meta", formatDate(goal.outcome.recordedAt));
  header.append(badge, date);

  const title = makeElement("h3", "", goal.intake.goal);
  const mission = makeElement("p", "mission-text", goal.preregisteredPlan.mission);

  const confidence = makeElement("div", "confidence-row");
  [
    [`${goal.intake.baselineConfidence}%`, "Before"],
    [`${goal.outcome.postConfidence}%`, "After"],
    [formatConfidenceDelta(goal.outcome.confidenceDelta), "Confidence delta"],
  ].forEach(([value, label]) => {
    const item = makeElement("div");
    item.append(makeElement("strong", "", value), makeElement("span", "", label));
    confidence.append(item);
  });

  const details = makeElement("dl");
  appendDefinition(details, "Frozen criterion", goal.preregisteredPlan.successCriterion);
  appendDefinition(details, "Criterion verdict", goal.outcome.criterionVerdict.replaceAll("_", " "));
  appendDefinition(details, "Self-recorded observation", goal.outcome.observation);
  appendDefinition(details, "Verification boundary", "Not independently verified");
  const actionLabel = goal.outcome.actionKind === "taken" ? "Action taken" : "Could not start";
  appendDefinition(
    details,
    actionLabel,
    `${formatDate(goal.sprint.action.recordedAt)} · ${goal.sprint.action.elapsedSeconds} seconds after sprint start`,
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
  appendDefinition(details, "Original compiled mission", goal.originalPlan.mission);
  appendDefinition(details, "Pre-start changes", String(goal.revisions.length));
  if (goal.predecessorId) {
    appendDefinition(details, "Linked predecessor", goal.predecessorId);
  }
  receipt.append(header, title, mission, confidence, details);
  renderDecision(goal);
}

function setDecisionButton(button, action, text) {
  button.dataset.action = action;
  button.textContent = text;
}

function renderDecision(goal) {
  const decision = recommendNextDecision(goal);
  const title = element("decision-title");
  const copy = element("decision-copy");
  const primary = element("decision-primary");
  const secondary = element("decision-secondary");
  if (decision === "stop") {
    title.textContent = "Stop: the criterion was observed.";
    copy.textContent = "Close this loop without inflating the task. Continuing is optional.";
    setDecisionButton(primary, "stop", "Stop here");
    setDecisionButton(secondary, "continue", "Create a linked continuation");
  } else if (decision === "continue") {
    title.textContent = "Continue only if another signal is useful.";
    copy.textContent = "The criterion was observed during an attempt. A linked successor preserves this receipt.";
    setDecisionButton(primary, "continue", "Create a linked continuation");
    setDecisionButton(secondary, "stop", "Stop here");
  } else if (decision === "seek_access") {
    title.textContent = "Seek access; do not blame effort.";
    copy.textContent = "Create a linked constraint-checking mission, or stop with the blocker intact.";
    setDecisionButton(primary, "seek_access", "Plan an access-seeking test");
    setDecisionButton(secondary, "stop", "Stop here");
  } else {
    title.textContent = "Revise by shrinking declared scope.";
    copy.textContent = "Create a linked successor with a smaller numeric scope. This receipt remains unchanged.";
    setDecisionButton(primary, "revise_shrink", "Create a smaller linked test");
    setDecisionButton(secondary, "stop", "Stop here");
  }
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
    content.append(makeElement("h3", "", goal.intake.goal));
    const statusText = goal.outcome
      ? `${goal.outcome.status} · criterion ${goal.outcome.criterionVerdict.replaceAll("_", " ")}`
      : "Sprint running · criterion preregistered";
    content.append(makeElement("p", "", statusText));
    content.append(makeElement("p", "", goal.preregisteredPlan.mission));
    const side = makeElement("div", "history-meta");
    side.append(makeElement("span", "", formatDate(goal.createdAt)));
    const viewButton = makeElement(
      "button",
      "button button-secondary",
      goal.outcome ? "View receipt" : "Resume sprint",
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
    now: nowIso(),
  });
  persistState();
  setReviewValues(state.draft);
  showPanel("review");
  announce("Experiment compiled. Review it before preregistering.");
}

function syncTimeboxText() {
  const minutes = Number(element("timeboxMinutes").value);
  const replacement = `after ${formatMinutes(minutes)}`;
  const stop = element("stopCondition");
  if (/after \d+ minutes?/i.test(stop.value)) {
    stop.value = stop.value.replace(/after \d+ minutes?/i, replacement);
  }
  updateStartButton();
  autosaveReview();
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
    id: createId("sprint"),
    now: startedAt,
    nowMilliseconds: Date.parse(startedAt),
  });
  persistState();
  renderAll();
  renderSprint(currentGoal());
  startTimerUpdates();
  showPanel("sprint");
  announce("Mission and criterion preregistered. The optional wall-clock reference has started.");
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
  announce("Back at the two-input draft. Nothing entered history.");
}

function openOutcomePanel() {
  const goal = currentGoal();
  stopTimerUpdates();
  element("outcome-criterion").textContent = goal.preregisteredPlan.successCriterion;
  element("postConfidence").value = String(goal.intake.baselineConfidence);
  showPanel("outcome");
  announce("Receipt opened. Countdown updates are frozen while you record.");
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
  state = recordOutcome(state, goalId, result.value, nowIso());
  persistState();
  stopTimerUpdates();
  renderAll();
  const goal = findGoal(state, goalId);
  renderReceipt(goal);
  showPanel("receipt");
  announce(`${goal.outcome.status} recorded; criterion ${goal.outcome.criterionVerdict.replaceAll("_", " ")}.`);
  form.reset();
}

function backToSprint() {
  renderSprint(currentGoal());
  startTimerUpdates();
  showPanel("sprint");
  announce("Returned to the frozen mission. No receipt was saved.");
}

function startFresh() {
  receiptGoalId = null;
  element("intake-form").reset();
  populateIntake(null);
  showPanel("intake");
  announce("Ready for another two-input experiment.");
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
  announce("Linked successor created. The original receipt remains unchanged.");
}

function handleDecision(event) {
  const action = event.currentTarget.dataset.action;
  if (action === "stop") {
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
  announce("Uncommitted draft discarded. Sprint history was preserved.");
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
    element("import-status").textContent = "Validated import merged successfully. Existing receipts were preserved.";
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
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(JOURNAL_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }
  element("clear-dialog").close();
  element("intake-form").reset();
  renderAll();
  populateIntake(null);
  showPanel("intake");
  element("import-status").textContent = "Local workspace and recovery journal deleted.";
  announce("All Proof of Possible data was deleted from this browser profile.");
}

function toggleTimer() {
  state = setTimerHidden(state, !state.settings.timerHidden, nowIso());
  persistState();
  renderTimer();
  announce(state.settings.timerHidden ? "Countdown hidden." : "Countdown shown.");
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
    if (activePanel === "intake" || activePanel === "review" || activePanel === "sprint") {
      restoreFlow(false);
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
  element("timeboxMinutes").addEventListener("change", syncTimeboxText);
  element("shrink-draft").addEventListener("click", handleShrinkDraft);
  element("back-to-intake").addEventListener("click", backToIntake);
  element("discard-draft").addEventListener("click", () => openDialog("discard-dialog"));
  element("cancel-discard").addEventListener("click", () => element("discard-dialog").close());
  element("confirm-discard").addEventListener("click", confirmDiscardDraft);

  element("toggle-timer").addEventListener("click", toggleTimer);
  element("open-outcome").addEventListener("click", openOutcomePanel);
  element("back-to-sprint").addEventListener("click", backToSprint);
  element("outcome-form").addEventListener("submit", handleOutcomeSubmit);
  element("action-could-not-start").addEventListener("change", () => {
    element("outcome-form").elements.status.value = "blocked";
    element("outcome-form").elements.criterionVerdict.value = "blocked";
  });
  element("decision-primary").addEventListener("click", handleDecision);
  element("decision-secondary").addEventListener("click", handleDecision);

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
