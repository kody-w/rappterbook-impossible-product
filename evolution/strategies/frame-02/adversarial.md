# Frame 2 strategy audit — Adversarial

## Observed in the live Frame 1

- A URL by itself satisfied evidence validation even though the app never fetched or verified it.
- A two-character note passed as evidence.
- Mission and success criterion could be changed after action started, enabling retrospective goalpost movement.
- One malformed local-storage payload reset the visible workspace to empty.

## Proposal

Require a meaningful observation independently of an optional HTTP(S) URL, preregister the exact mission/criterion, display the verification boundary, and recover a corrupt primary payload from a separately validated journal.

## Acceptance signal

Adversarial unit and browser tests cover short notes, URL-only receipts, criterion integrity, malformed imports, and corrupt-primary recovery.

## Consensus votes (1–5)

- Assisted experiment compiler: **4**
- Criterion-linked evidence and decision: **5**
- Recoverable local workspace: **5**

