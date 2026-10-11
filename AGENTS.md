# Project guidance

## Plain-language UI standard

Write every user-facing explanation for someone who understands the extension's purpose but not its implementation. Lead with the outcome, why it matters, whether data changed, and the next action. Use ordinary language; keep internal terms and raw counters in optional Technical details or exported reports. Distinguish titles, purchases and saved records; different totals do not prove missing purchases, and timestamp changes do not prove improved information. Describe read-only checks, offers, confirmed imports and store scans accurately. Explain errors with their impact and an actionable next step; never invent certainty.

Before committing changed UI text, check first-time comprehension, jargon, misleading claims, the next action, and zero/large/partial-failure cases. Failures are UX defects. Apply this review to GL, HB and FAN consistently.

## Automatic purchase sync

Extension pairing alone is not standing import permission. Preserve the explicitly confirmed account relationship, stable account IDs, provider/sender scoping and save-time consent guards. One local setup confirmation may authorize both verified extensions only through reverse-verified setup tickets and exact account checks; old pairing/proposals alone never grant standing consent. Sync only committed data, retain additive merges and idempotency, and keep manual offers separate. Shared sync runtime/UI are authored in GalacticLibrary/shared and mirrored with its sync-companion-purchases script. Validate synthetic data in disposable browser profiles; never use an installed personal library as a test destination.
