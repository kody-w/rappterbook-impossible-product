# Frame 2 strategy audit — Reliability

## Observed in the live Frame 1

- State had a version number but no migration path, journal, nested validation, or revision-aware tab reconciliation.
- Concurrent tabs could overwrite a newer receipt or deadline with stale state.
- CI unit-tested pure functions and scanned HTML resources, but did not execute the DOM journey or inspect browser requests.

## Proposal

Introduce a validated v2 envelope, v1 migration, duplicate last-known-good journal, additive goal merge keyed by ID, monotonic revisions/storage events, and safe imports. Add pinned Playwright Chromium tests and scan HTML, runtime JavaScript, and CSS for third-party resource loads.

## Acceptance signal

Unit tests preserve receipts/deadlines across merges and journal recovery; CI and Pages both block on the real-browser release contract and request-origin assertions.

## Consensus votes (1–5)

- Assisted experiment compiler: **4**
- Criterion-linked evidence and decision: **4**
- Recoverable local workspace: **5**
