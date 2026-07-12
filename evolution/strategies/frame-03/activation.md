# Activation audit — Frame 03

## Raw observation

Frame 2 reached a runnable sprint quickly, but “action taken” and an activity status could dominate the review even when neither changed the underlying belief. The next-step click also disappeared when a user chose stop, so the workspace did not retain the exact decision state.

## Strategy

Grade evidence against one structured assumption, persist every decision, and expose exact lifecycle states: probe frozen, action begun, receipt saved, interpretation chosen, decision recorded, and successor created. A user should see the executable handoff in the first review viewport and make one decision at a time.

## Acceptance signal

- Activity alone cannot satisfy the belief criterion.
- Freeze, action-start, and receipt timestamps are distinct.
- Stop/conclude is persisted as data.
- Every route and receipt has a named, recoverable state.

