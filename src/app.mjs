import {
  STORAGE_KEY,
  computeMetrics,
  createEmptyState,
  createGoal,
  deserializeState,
  findGoal,
  formatConfidenceDelta,
  getRemainingSeconds,
  recordOutcome,
  serializeState,
  simplifyMission,
  startSprint,
  suggestSimplerPlan,
  validateIntake,
  validateOutcome,
  validatePlan,
} from "./core.mjs";

const panelNames = ["intake", "review", "sprint", "outcome", "receipt"];
const stepIndexes = { intake: 0, review: 1, sprint: 2, outcome: 3, receipt: 3 };
const fieldTargets = {
  goal: "goal",
  why: "why",
  obstacle: "obstacle",
  proof: "proof",
  timeboxMinutes: "timeboxMinutes",
  baselineConfidence: "baselineConfidence",
  mission: "mission",
  successCriterion: "successCriterion",
  stopCondition: "stopCondition",
  status: "status-completed",
  evidence: "evidenceNote",
  note: "evidenceNote",
  url: "evidenceUrl",
  postConfidence: "postConfidence",
};

const element = (id) => document.getElementById(id);
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let state = createEmptyState();
let timerInterval = null;
let storageAvailable = true;

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

function createId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `goal-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadState() {
  try {
    const probeKey = `${STORAGE_KEY}:probe`;
    localStorage.setItem(probeKey, "1");
    localStorage.removeItem(probeKey);
    const loaded = deserializeState(localStorage.getItem(STORAGE_KEY));
    state = loaded.state;
    element("recovery-warning").hidden = !loaded.recovered;
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
    localStorage.setItem(STORAGE_KEY, serializeState(state));
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
    if (target) {
      target.setAttribute("aria-invalid", "true");
    }
    const messageElement = element(`${targetId}-error`) ?? element(`${field}-error`);
    if (messageElement) {
      messageElement.textContent = message;
    }

    const item = makeElement("li");
    const link = makeElement("a", "", message);
    link.href = `#${targetId}`;
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
  element("metric-rate").textContent = `${metrics.firstEvidencePercent}%`;
  element("metric-ratio").textContent = `${metrics.outcomesRecorded} ${metrics.outcomesRecorded === 1 ? "outcome" : "outcomes"} / ${metrics.goalsCreated} ${metrics.goalsCreated === 1 ? "goal" : "goals"}`;
  element("metric-goals").textContent = String(metrics.goalsCreated);
  element("metric-outcomes").textContent = String(metrics.outcomesRecorded);
}

function setReviewValues(goal) {
  element("mission").value = goal.currentPlan.mission;
  element("successCriterion").value = goal.currentPlan.successCriterion;
  element("stopCondition").value = goal.currentPlan.stopCondition;

  const context = element("review-context");
  context.replaceChildren();
  const constraint = makeElement("p");
  constraint.append(makeElement("strong", "", "Constraint: "));
  constraint.append(document.createTextNode(goal.intake.obstacle));
  const reason = makeElement("p");
  reason.append(makeElement("strong", "", "Why this matters: "));
  reason.append(document.createTextNode(goal.intake.why));
  context.append(constraint, reason);
}

function setSimplifyValues(goal) {
  element("simplifiedMission").value = goal.currentPlan.mission;
  element("simplifiedSuccess").value = goal.currentPlan.successCriterion;
  element("simplifiedStop").value = goal.currentPlan.stopCondition;
  element("simplifyReason").value = "";
}

function renderProvenance(goal) {
  const section = element("provenance-section");
  const list = element("provenance-list");
  list.replaceChildren();
  section.hidden = goal.revisions.length === 0;

  goal.revisions.forEach((revision, index) => {
    const item = makeElement("li");
    const heading = makeElement("strong", "", `Simplification ${index + 1} · ${formatDate(revision.recordedAt)}`);
    const reason = makeElement("div", "", revision.reason);
    const change = makeElement("div", "", `Changed from “${revision.from.mission}” to “${revision.to.mission}”`);
    item.append(heading, reason, change);
    list.append(item);
  });
}

function renderSprint(goal) {
  element("active-mission").textContent = goal.currentPlan.mission;
  element("active-success").textContent = goal.currentPlan.successCriterion;
  element("active-stop").textContent = goal.currentPlan.stopCondition;
  setSimplifyValues(goal);
  renderProvenance(goal);
  element("simplify-details").open = false;
  renderTimer();
}

function renderTimer() {
  const goal = currentGoal();
  if (!goal || goal.status !== "running" || !goal.sprint) {
    return;
  }
  const remaining = getRemainingSeconds(goal.sprint.endsAt);
  const text = formatTimer(remaining);
  element("sprint-timer").textContent = text;
  element("sprint-timer").setAttribute("aria-label", `${remaining} seconds remaining`);
  element("outcome-timer").textContent = text;
  const timerBlock = element("sprint-timer").closest(".timer-block");
  timerBlock.classList.toggle("is-expired", remaining === 0);
  element("timer-note").textContent = remaining === 0
    ? "Time is up. Record completed, attempted, or blocked—each is valid evidence."
    : "No pause: this deadline keeps running across reloads and closed tabs.";
}

function startTimerUpdates() {
  stopTimerUpdates();
  renderTimer();
  timerInterval = window.setInterval(renderTimer, 500);
}

function stopTimerUpdates() {
  if (timerInterval !== null) {
    window.clearInterval(timerInterval);
    timerInterval = null;
  }
}

function appendDefinition(list, term, value) {
  const wrapper = makeElement("div");
  wrapper.append(makeElement("dt", "", term), makeElement("dd", "", value));
  list.append(wrapper);
}

function renderReceipt(goal) {
  const receipt = element("receipt");
  receipt.replaceChildren();

  const header = makeElement("div", "receipt-header");
  const badge = makeElement("span", "status-badge", goal.outcome.status);
  const date = makeElement("span", "history-meta", formatDate(goal.outcome.recordedAt));
  header.append(badge, date);

  const title = makeElement("h3", "", goal.intake.goal);
  const mission = makeElement("p", "mission-text", goal.currentPlan.mission);

  const confidence = makeElement("div", "confidence-row");
  const before = makeElement("div");
  before.append(
    makeElement("strong", "", `${goal.intake.baselineConfidence}%`),
    makeElement("span", "", "Before"),
  );
  const after = makeElement("div");
  after.append(
    makeElement("strong", "", `${goal.outcome.postConfidence}%`),
    makeElement("span", "", "After"),
  );
  const delta = makeElement("div");
  delta.append(
    makeElement("strong", "", formatConfidenceDelta(goal.outcome.confidenceDelta)),
    makeElement("span", "", "Confidence delta"),
  );
  confidence.append(before, after, delta);

  const details = makeElement("dl");
  appendDefinition(details, "Observable success", goal.currentPlan.successCriterion);
  appendDefinition(details, "Evidence note", goal.outcome.note || "No note recorded.");
  if (goal.outcome.url) {
    const wrapper = makeElement("div");
    wrapper.append(makeElement("dt", "", "Evidence URL"));
    const description = makeElement("dd");
    const link = makeElement("a", "", goal.outcome.url);
    link.href = goal.outcome.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    description.append(link);
    wrapper.append(description);
    details.append(wrapper);
  }
  appendDefinition(details, "Original mission", goal.originalPlan.mission);
  appendDefinition(details, "Simplifications", String(goal.revisions.length));

  receipt.append(header, title, mission, confidence, details);
  element("new-goal").textContent = currentGoal()
    ? "Return to active proof"
    : "Name another impossible thing";
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
      ? `${goal.outcome.status} · confidence ${formatConfidenceDelta(goal.outcome.confidenceDelta)}`
      : goal.status === "running"
        ? "Proof sprint in progress"
        : "Mission created; no outcome yet";
    content.append(makeElement("p", "", statusText));
    content.append(makeElement("p", "", goal.currentPlan.mission));

    const side = makeElement("div", "history-meta");
    side.append(makeElement("span", "", formatDate(goal.createdAt)));
    if (goal.outcome) {
      const viewButton = makeElement("button", "button button-secondary", "View receipt");
      viewButton.type = "button";
      viewButton.dataset.receiptId = goal.id;
      side.append(viewButton);
    }
    item.append(index, content, side);
    list.append(item);
  });
}

function renderAll() {
  renderMetrics();
  renderHistory();
}

function restoreFlow() {
  const goal = currentGoal();
  if (goal?.status === "planned") {
    setReviewValues(goal);
    showPanel("review", false);
    return;
  }
  if (goal?.status === "running") {
    renderSprint(goal);
    startTimerUpdates();
    showPanel("sprint", false);
    return;
  }
  if (state.activeGoalId !== null) {
    state = { ...state, activeGoalId: null };
    persistState();
  }
  showPanel("intake", false);
}

function handleIntakeSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const result = validateIntake(formObject(form));
  clearErrors(form, "intake-errors");
  if (!result.valid) {
    showErrors(form, "intake-errors", result.errors);
    return;
  }

  state = createGoal(state, result.value, { id: createId(), now: nowIso() });
  persistState();
  renderAll();
  const goal = currentGoal();
  setReviewValues(goal);
  showPanel("review");
  announce("Proof mission created. Review it before starting the timer.");
}

function handleReviewSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const result = validatePlan(formObject(form));
  clearErrors(form, "review-errors");
  if (!result.valid) {
    showErrors(form, "review-errors", result.errors);
    return;
  }

  const goal = currentGoal();
  state = startSprint(state, goal.id, result.value, Date.now());
  persistState();
  renderAll();
  renderSprint(currentGoal());
  startTimerUpdates();
  showPanel("sprint");
  announce("Proof sprint started. The wall-clock timer cannot pause.");
}

function handleSuggestion() {
  const plan = {
    mission: element("simplifiedMission").value,
    successCriterion: element("simplifiedSuccess").value,
    stopCondition: element("simplifiedStop").value,
  };
  const result = validatePlan(plan);
  if (!result.valid) {
    showErrors(element("simplify-form"), "simplify-errors", result.errors, {
      mission: "simplifiedMission",
      successCriterion: "simplifiedSuccess",
      stopCondition: "simplifiedStop",
    });
    return;
  }
  const suggestion = suggestSimplerPlan(result.value);
  element("simplifiedMission").value = suggestion.mission;
  element("simplifiedSuccess").value = suggestion.successCriterion;
  announce("A smaller slice was suggested. Edit it if needed.");
}

function handleSimplifySubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const input = formObject(form);
  const result = validatePlan(input);
  const errors = { ...result.errors };
  if (!input.reason || input.reason.trim().length < 3) {
    errors.reason = "Say briefly why the mission needed to get smaller.";
  }
  clearErrors(form, "simplify-errors");
  if (Object.keys(errors).length > 0) {
    showErrors(form, "simplify-errors", errors, {
      mission: "simplifiedMission",
      successCriterion: "simplifiedSuccess",
      stopCondition: "simplifiedStop",
      reason: "simplifyReason",
    });
    return;
  }

  try {
    state = simplifyMission(state, currentGoal().id, result.value, input.reason, nowIso());
  } catch (error) {
    showErrors(form, "simplify-errors", { mission: error.message }, {
      mission: "simplifiedMission",
    });
    return;
  }
  persistState();
  renderAll();
  renderSprint(currentGoal());
  announce("Mission simplified. The original and deadline were preserved.");
}

function openOutcomePanel() {
  const goal = currentGoal();
  element("postConfidence").value = String(goal.intake.baselineConfidence);
  showPanel("outcome");
  renderTimer();
  announce("Evidence receipt opened. The timer is still running.");
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
  announce(`${goal.outcome.status} outcome recorded. Confidence delta ${formatConfidenceDelta(goal.outcome.confidenceDelta)}.`);
  form.reset();
}

function startAnotherGoal() {
  element("intake-form").reset();
  element("baselineConfidence").value = "30";
  element("timeboxMinutes").value = "5";
  showPanel("intake");
  announce("Ready for another proof mission.");
}

function handleReceiptPrimaryAction() {
  const goal = currentGoal();
  if (goal?.status === "planned") {
    setReviewValues(goal);
    showPanel("review");
    announce("Returned to your planned proof mission.");
    return;
  }
  if (goal?.status === "running") {
    renderSprint(goal);
    startTimerUpdates();
    showPanel("sprint");
    announce("Returned to your active proof sprint. The timer never paused.");
    return;
  }
  startAnotherGoal();
}

function openReceiptFromHistory(goalId) {
  const goal = findGoal(state, goalId);
  if (!goal?.outcome) {
    return;
  }
  renderReceipt(goal);
  showPanel("receipt");
}

function openClearDialog() {
  const dialog = element("clear-dialog");
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  }
}

function clearLocalData() {
  stopTimerUpdates();
  state = createEmptyState();
  if (storageAvailable) {
    localStorage.removeItem(STORAGE_KEY);
  }
  element("clear-dialog").close();
  renderAll();
  startAnotherGoal();
  announce("All Proof of Possible data was removed from this browser.");
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
    const timeline = element("evolution-timeline");
    timeline.replaceChildren(makeElement(
      "li",
      "timeline-loading",
      "Evolution data is unavailable. Frame 1 evidence remains linked below.",
    ));
  }
}

function bindEvents() {
  element("intake-form").addEventListener("submit", handleIntakeSubmit);
  element("review-form").addEventListener("submit", handleReviewSubmit);
  element("suggest-smaller").addEventListener("click", handleSuggestion);
  element("simplify-form").addEventListener("submit", handleSimplifySubmit);
  element("open-outcome").addEventListener("click", openOutcomePanel);
  element("back-to-sprint").addEventListener("click", () => {
    renderSprint(currentGoal());
    showPanel("sprint");
    announce("Returned to the proof sprint. The timer never paused.");
  });
  element("outcome-form").addEventListener("submit", handleOutcomeSubmit);
  element("new-goal").addEventListener("click", handleReceiptPrimaryAction);
  element("history-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-receipt-id]");
    if (button) {
      openReceiptFromHistory(button.dataset.receiptId);
    }
  });
  element("clear-data").addEventListener("click", openClearDialog);
  element("cancel-clear").addEventListener("click", () => element("clear-dialog").close());
  element("confirm-clear").addEventListener("click", clearLocalData);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      renderTimer();
    }
  });
}

loadState();
bindEvents();
renderAll();
restoreFlow();
loadTimeline();
