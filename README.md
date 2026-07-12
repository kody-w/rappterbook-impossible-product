# Proof of Possible

**Proof of Possible** is a private, local-first browser app for stalled solo builders and learners. It turns an overwhelming goal into one small, falsifiable real-world experiment, runs a proof sprint of ten minutes or less, and records what reality says.

Completed, attempted, and blocked are all valid outcomes. The product explicitly does not claim that motivation or effort can erase structural barriers.

**Deployment:** <https://kody-w.github.io/rappterbook-impossible-product/>

## Frame 1 product loop

1. **Name + Compress the Impossible** — capture the goal, why it matters, binding constraint, observable proof, timebox, and baseline confidence. A deterministic generator creates one editable mission with success and stop conditions.
2. **Run One Proof Sprint** — use a wall-clock deadline that persists across reloads and never pretends to pause. An infeasible mission can be simplified without losing its original wording, revision reason, or deadline.
3. **Evidence Receipt + Value Measurement** — record completed, attempted, or blocked with a note or URL, compare post-confidence to baseline, keep local history, and display First-Evidence Rate.

## Privacy

There are no accounts, analytics, cookies, third-party runtime assets, AI calls, or backend requests. Goals and receipts remain in the browser’s `localStorage`. Saved evidence URLs are displayed but never fetched by the app. Clearing browser site data—or using **Clear local data**—removes the record.

## Run locally

The application is static. Python is only used here as a convenient local file server:

```bash
python3 -m http.server 8000
```

Open <http://localhost:8000>. Opening `index.html` directly may prevent the browser from loading the local evolution JSON.

## Test and build

Node.js 20 or newer is sufficient; there is no install step and no dependency download.

```bash
# Domain logic and deployment smoke test
node --test tests/*.test.mjs

# Resource, accessibility, and evolution-data invariants
node scripts/check-static.mjs

# Produce the exact GitHub Pages artifact in _site/
node scripts/build.mjs
```

## Architecture

| Path | Responsibility |
| --- | --- |
| `index.html`, `styles.css` | Semantic, responsive interface with visible focus and reduced-motion support |
| `src/core.mjs` | Pure validation, deterministic mission generation, state transitions, timer math, metrics, and serialization |
| `src/app.mjs` | DOM rendering, keyboard-native interactions, wall-clock updates, and local persistence |
| `evolution/frames/frame-01.json` | Machine-readable strategy, decision, acceptance, metric, test, and release evidence |
| `evolution/timeline.json` | Twelve-frame timeline consumed by the interface |
| `tests/` | Node built-in tests; no third-party test runner |
| `.github/workflows/` | Test and GitHub Pages workflow deployment |

State is a single versioned local object. Every goal retains `originalPlan`, `currentPlan`, zero or more provenance revisions, a persisted sprint deadline, and an optional outcome. First-Evidence Rate is computed as goals with outcomes divided by goals created.

## Evolution protocol

This repository evolves over twelve autonomous frames. Each frame must:

1. preserve its independent strategy inputs and consensus rationale;
2. select exactly three product mutations;
3. define testable acceptance criteria and baseline/live value metrics;
4. ship tested code rather than a speculative roadmap;
5. append machine-readable evidence under `evolution/frames/`; and
6. update the visible timeline while leaving unselected future frames pending.

Frame 1 evidence is available at [`evolution/frames/frame-01.json`](evolution/frames/frame-01.json).
