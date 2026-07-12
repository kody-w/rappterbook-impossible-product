# Frame 2 strategy audit — Accessibility

## Observed in the live Frame 1

- Semantic headings, native controls, reduced-motion CSS, and a skip link were strong foundations.
- The mobile stepper intentionally scrolled horizontally, the timer could not be hidden, and focus contrast had not been measured against all surfaces.
- Static source checks could not detect broken DOM event wiring.

## Proposal

Use a wrapping two-column mobile stepper, dual-contrast focus treatment, polite status announcements, a non-coercive hideable timer, and a browser-level keyboard/responsive contract at 320 CSS pixels. Keep every state’s main action visually singular.

## Acceptance signal

Browser tests prove skip-link keyboard focus, visible focus styling, no page-level horizontal overflow at 320px, and a complete wired journey.

## Consensus votes (1–5)

- Assisted experiment compiler: **4**
- Criterion-linked evidence and decision: **4**
- Recoverable local workspace: **5**

