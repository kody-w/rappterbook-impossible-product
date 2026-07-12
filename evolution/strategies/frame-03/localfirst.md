# Local-first audit — Frame 03

## Raw observation

Frame 2 recovery, import/export, and journal semantics were strong, but migration into a richer lineage schema could silently invent action times or confidence. Plain JSON transfer remains sensitive.

## Majority strategy

Ship a versioned Frame 3 workspace with explicit Frame 2 migration. Preserve old deadlines, receipts, confidence values, and linkage; represent unknown historical action-start time as unknown rather than relabeling receipt time. Keep semantic validation, additive multi-tab merge, corruption recovery, and no third-party runtime requests.

## Minority proposals retained, not selected

- Encrypted transfer packages with a user-held passphrase.
- Offline evidence packets designed for movement between devices.

These are valuable local-first directions but would be a fourth product mutation and require a separate threat model. They remain raw evidence, not shipped claims.

