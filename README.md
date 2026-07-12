# Proof of Possible

**Proof of Possible v2.0.0** is a local-first browser app that compiles one overwhelming goal and one binding constraint into a small, preregistered real-world experiment.

Completed, attempted, and blocked remain valid. Observations are explicitly self-recorded and are never presented as independently verified truth.

**Deployment:** <https://kody-w.github.io/rappterbook-impossible-product/>

## Frame 2 product loop

1. **Compile with minimum input** — enter a goal and binding constraint, then choose one deterministic pattern: ask a person, make a tiny artifact, check a real constraint, or send a reversible probe.
2. **Review and preregister** — edit one action, target/artifact, explicit criterion, numeric scope, stop condition, and one-to-ten-minute timebox. Optional why/confidence stays secondary. Scope reduction must lower the declared number.
3. **Run one non-coercive sprint** — mission and criterion freeze at start and survive reload. The countdown can be hidden and stops updating while a receipt is entered.
4. **Record criterion-linked evidence** — separately record whether action began, completed/attempted/blocked status, observation, criterion verdict, optional URL, and action time.
5. **Make the next decision** — stop, continue, revise by shrinking, or seek access. A successor links to its immutable predecessor.

The honest local funnel is:

> **Criterion-Linked Evidence Rate = evidence-bearing, criterion-judged receipts / sprints started**

The numerator and denominator are always visible. Drafts do not count.

## Recoverable local workspace

- Intake and review drafts autosave before commitment without entering history or metrics.
- Back preserves the draft; Discard explicitly removes only the draft.
- A validated v2 envelope, v1 migration, duplicate recovery journal, revisions, storage events, and additive goal merges protect receipts and deadlines. Recovery selects the newest semantically valid revision and distinguishes a recovered copy from an empty reset.
- JSON import validates invariants and recomputes derived evidence fields before merging. Malformed or contradictory files cannot replace current data.
- Export → delete → import round-trips the workspace.

Data is local to this browser profile on this device, **not universally private**. Anyone or any software with access to the profile, device, or plain-JSON export may be able to read it. There are no accounts, analytics, AI calls, cookies, third-party runtime assets, or goal-data backend requests.

## Run locally

```bash
npm ci
npm run build
node scripts/serve.mjs
```

Open <http://127.0.0.1:4173>.

## Test and build

Node.js 20 or newer is required.

```bash
# 31 domain/deployment tests plus HTML/JS/CSS static invariants
npm test

# Real Chromium release contract (8 built-artifact journeys)
npx playwright install chromium
npm run test:e2e

# Syntax and static Pages artifact
npm run check
npm run build
```

`@playwright/test` is the only dependency, pinned exactly at `1.61.1` in `package-lock.json`. It is development-only: a real browser is the smallest reliable way to make broken DOM wiring, reload persistence, criterion drift, external requests, keyboard focus, and responsive overflow block both CI and Pages. The deployed app remains dependency-free.

`npm run build` writes `_site/provenance.json` with the source SHA, Actions run ID/attempt, build timestamp, git tree SHA, per-file SHA-256 hashes, and a deterministic aggregate content digest. Pages uploads the same `_site` directory that Chromium tested; it does not rebuild after validation.

## Architecture

| Path | Responsibility |
| --- | --- |
| `index.html`, `styles.css` | Semantic task-first interface, visible focus, reflow, and reduced motion |
| `src/core.mjs` | Compiler, validation, preregistration, receipts, decisions, migrations, journal envelopes, imports, and merges |
| `src/app.mjs` | DOM states, autosave, storage events, timer display, export/import/delete, and announcements |
| `tests/core.test.mjs` | Pure domain, adversarial evidence, recovery, migration, and merge contracts |
| `tests/release.spec.mjs` | Built `_site` Chromium journeys, handler mutation probes, recovery/import adversaries, responsive/keyboard, request-origin, and runtime-error contract |
| `evolution/strategies/frame-02/` | Eight distinct raw strategy audits |
| `evolution/frames/frame-02.json` | Scoring, exactly three selected mutations, acceptance, metrics, tests, and release provenance |
| `.github/workflows/` | Locked tests and browser contract before validation/deployment |

## Evolution protocol

This repository evolves over twelve autonomous frames. Each frame preserves independent strategy evidence, scores consensus transparently, selects exactly three product mutations, ships tested behavior, records value/release evidence, and leaves unselected future frames pending.

- [Frame 1 evidence](evolution/frames/frame-01.json)
- [Frame 2 evidence](evolution/frames/frame-02.json)
