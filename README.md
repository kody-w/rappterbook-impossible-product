# Proof of Possible

**Proof of Possible v3.0.0** is a local-first browser app that compiles one uncertain assumption into a safe, executable real-world probe and preserves the resulting decision lineage.

Completed, attempted, blocked, and safe-stopped remain valid. Activity alone is not belief evidence. Observations are self-recorded and never presented as independently verified or statistically certain.

**Deployment:** <https://kody-w.github.io/rappterbook-impossible-product/>

## Frame 3 product loop

1. **Name the assumption** — record a target/unit, uncertain claim, observable signal, decision it informs, and binding constraint.
2. **Choose the fit** — act safely now, prepare privately, seek trusted support/accommodation, or stop. Unsafe ask/send probes stay private unless outbound contact is explicitly opted into.
3. **Review an executable probe** — edit a copy-ready payload or artifact/check skeleton and preregister supports, weakens, and inconclusive branches. Sending, opening, or completing alone never satisfies the belief criterion.
4. **Choose capacity-aware pacing** — countdown, active-effort cap, or untimed. Waiting for an ask/send response pauses active effort.
5. **Begin explicitly** — `Copy & begin` or `Begin without copying` records `actionStartedAt` separately from probe freeze and receipt time.
6. **Interpret honestly** — save a criterion-linked observation, directional interpretation, diagnosis, optional confidence, and compassionate status.
7. **Decide with lineage** — conclude, replicate, pivot, seek support/access, or continue. Every decision persists; overrides require a reason. Successors preserve the belief ID while allowing route, action, and criterion changes.

After two receipts, deterministic local synthesis reports contradictions, repeated low-information proofs, and the current directional support state. It offers conclude/replicate/pivot without implying statistical certainty.

## Local metrics

The visible Frame 2 funnel remains:

> **Criterion-Linked Evidence Rate = evidence-bearing interpreted receipts / probes frozen**

Frame 3 also exposes **Directional Belief Signals**: receipts interpreted as supports or weakens after an explicit action start. Blocked, safe-stopped, inconclusive, sending, opening, or completion alone cannot enter that count.

There is no telemetry. Metrics are recomputed from this browser profile's local workspace.

## Recoverable local workspace

- The v3 primary envelope and recovery journal preserve drafts, probes, receipts, decisions, and lineage.
- Frame 2 primary/journal/export data migrates explicitly. Existing deadlines, confidence, observations, and links survive; unknown historical action-start time remains unknown.
- Semantic validation, newest-valid-revision recovery, additive multi-tab merge, and derived-field recomputation remain in force.
- Export → delete → import round-trips the workspace. Malformed or contradictory imports cannot replace current data.

Data is local to this browser profile on this device, **not universally private**. Plain-JSON exports are readable. There are no accounts, analytics, AI calls, cookies, third-party runtime assets, or goal-data backend requests.

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
# 54 domain/deployment tests plus static release invariants
npm test

# 15 real Chromium built-artifact journeys
npm run test:e2e

# Syntax and static Pages artifact
npm run check
npm run build
```

`@playwright/test` is the only dependency, pinned exactly at `1.61.1`; it is development-only. Browser gates cover all routes, action timestamps, nullable confidence, untimed and active-effort pacing, unsafe outbound fixtures, branch interpretation, decisions, duplicate/contradiction synthesis, migration, 320px at 200% text, keyboard focus, page/console errors, multi-tab behavior, and third-party requests.

`npm run build` writes `_site/provenance.json` after copying the artifact. Provenance contains the exact source SHA, Actions run ID/attempt, build timestamp, git tree SHA, per-file SHA-256 hashes, and a deterministic aggregate artifact-tree digest. `provenance.json` excludes itself, avoiding self-referential stale claims. Pages uploads the same `_site` directory Chromium tested and does not rebuild it.

## Architecture

| Path | Responsibility |
| --- | --- |
| `index.html`, `styles.css` | Semantic assumption-first interface, visible focus, 320px/200% reflow, and reduced motion |
| `src/core.mjs` | Compiler, safety routes, pacing, receipts, decisions, lineage synthesis, migrations, validation, imports, and merges |
| `src/app.mjs` | DOM states, explicit begin action, local persistence, timers, evidence brief, data controls, and announcements |
| `tests/core.test.mjs` | Domain, migration, safety, pacing, lineage, recovery, import, and merge contracts |
| `tests/release.spec.mjs` | Built `_site` Chromium journeys with pageerror, console, network-origin, focus, and overflow guards |
| `evolution/strategies/frame-03/` | Eight distinct raw Frame 3 strategy audits, including retained minority proposals |
| `evolution/frames/frame-03.json` | Transparent scoring, exactly three selected mutations, acceptance, local metrics, tests, and provenance policy |
| `.github/workflows/` | Locked tests and browser contract before validation/deployment |

## Evolution protocol

This repository evolves over twelve autonomous frames. Each frame preserves independent strategy evidence, scores consensus transparently, selects exactly three product mutations, ships tested behavior, records local value/release evidence, and leaves later frames pending.

- [Frame 1 evidence](evolution/frames/frame-01.json)
- [Frame 2 evidence](evolution/frames/frame-02.json)
- [Frame 3 evidence](evolution/frames/frame-03.json)
