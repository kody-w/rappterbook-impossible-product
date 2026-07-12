# Frame 2 strategy audit — Retention

## Observed in the live Frame 1

- Intake was not persisted until a goal was created, so reload could erase the highest-friction thinking.
- Clear was the only workspace-management operation; there was no export/import path.
- Receipts ended with “name another impossible thing,” not a decision tied to the result.

## Proposal

Autosave a non-counting draft on every input, make Back preserve it and Discard deliberate, support validated JSON export/import/delete, and turn receipt decisions into linked successors with immutable predecessor provenance.

## Acceptance signal

Release tests cover draft reload, export→clear→import, malformed import without loss, explicit delete, and linked successor lineage.

## Consensus votes (1–5)

- Assisted experiment compiler: **5**
- Criterion-linked evidence and decision: **5**
- Recoverable local workspace: **5**

