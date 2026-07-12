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
npm run build:local
node scripts/serve.mjs
```

Open <http://127.0.0.1:4173>.

## Test and build

Node.js 20 or newer is required.

```bash
# 75 domain/deployment/release-contract tests (66 prior + 9 policy mutations)
npm test

# Build once in explicit trusted local mode, then run 15 Chromium journeys
npm run test:e2e:local

# Syntax and an explicit local static Pages artifact
npm run check
npm run build:local
```

`@playwright/test` is the only dependency, pinned exactly at `1.61.1`; it is development-only. Browser gates cover all routes, action timestamps, nullable confidence, untimed and active-effort pacing, unsafe outbound fixtures, branch interpretation, decisions, duplicate/contradiction synthesis, migration, 320px at 200% text, keyboard focus, page/console errors, multi-tab behavior, and third-party requests.

`npm run build` is the fail-closed CI build. It rejects a missing, malformed, unresolvable, or non-HEAD `GITHUB_SHA`, a missing Git executable, and any failed commit/tree lookup. `TRUSTED_LOCAL_BUILD=1` is available only through `npm run build:local` and is rejected when CI is active.

The build writes `_site/provenance.json` with the exact source SHA, Actions run ID/attempt, build timestamp, git tree SHA, per-file SHA-256 hashes, and a deterministic content digest. `provenance.json` excludes itself, avoiding self-reference.

Both workflows build `_site` exactly once before Chromium. They snapshot every artifact byte, test only `_site`, and verify immutability after tests. The Pages validation job is a fail-closed structural allowlist: its ordered build → snapshot → browser → verification → `_site` upload steps must match exactly, and no extra command, shell block, alias, action, or mutation is accepted. Nine mutation contracts cover equivalent build commands, a post-browser touch, multiline shell, an extra pinned action, reordering, missing verification, and upload-path drift. A required job then downloads that exact Pages artifact and retries live comparison of provenance plus every manifest asset hash without following redirects.

After the repaired gate passes, the exact Pages artifact is retained at the new [`frame-03.2` release](https://github.com/kody-w/rappterbook-impossible-product/releases/tag/frame-03.2); the rejected `frame-03` tag remains unchanged. No signing identity is configured, so this is hash-verifiable unsigned provenance—not a claimed cryptographic signature. The repair changes release integrity only: Frame 4 remains pending and no fourth Frame 3 product mutation was added.

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
| `scripts/provenance.mjs`, `scripts/attest-artifact.mjs`, `scripts/verify-live.mjs` | Fail-closed source identity, full-byte artifact attestation, and post-deploy every-asset verification |
| `.github/workflows/` | SHA-pinned tests, single-build artifact contract, Pages deployment, and required live verification |

## Evolution protocol

This repository evolves over twelve autonomous frames. Each frame preserves independent strategy evidence, scores consensus transparently, selects exactly three product mutations, ships tested behavior, records local value/release evidence, and leaves later frames pending.

- [Frame 1 evidence](evolution/frames/frame-01.json)
- [Frame 2 evidence](evolution/frames/frame-02.json)
- [Frame 3 evidence](evolution/frames/frame-03.json)
