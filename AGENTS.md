# Project guidance

## Plain-language UI standard

Write every user-facing explanation for someone who understands the extension's purpose but not its implementation. Lead with the outcome, why it matters, whether data changed, and the next action. Use ordinary language; keep internal terms and raw counters in optional Technical details or exported reports. Distinguish titles, purchases and saved records; different totals do not prove missing purchases, and timestamp changes do not prove improved information. Describe read-only checks, offers, confirmed imports and store scans accurately. Explain errors with their impact and an actionable next step; never invent certainty.

Before committing changed UI text, check first-time comprehension, jargon, misleading claims, the next action, and zero/large/partial-failure cases. Failures are UX defects. Apply this review to GL, HB and FAN consistently.

## Automatic purchase sync

Extension pairing alone is not standing import permission. Preserve the explicitly confirmed account relationship, stable account IDs, provider/sender scoping and save-time consent guards. One local setup confirmation may authorize both verified extensions only through reverse-verified setup tickets and exact account checks; old pairing/proposals alone never grant standing consent. Sync only committed data, retain additive merges and idempotency, and keep manual offers separate. Shared sync runtime/UI are authored in GalacticLibrary/shared and mirrored with its sync-companion-purchases script. Validate synthetic data in disposable browser profiles; never use an installed personal library as a test destination.

## Git identity hook

Install the version-controlled identity guard with `git config --local core.hooksPath .githooks`.
See [.githooks/README.md](.githooks/README.md) for installation, effective-identity checks and tests.

## Audit document maintenance

When an implementation change fully resolves findings in a tracked audit document, update that document in the same implementation commit or remove it only if it is obsolete, contains no unique enduring technical information, and no active workflow depends on it. Preserve architectural decisions, contracts, recovery procedures, regression cases, diagnostics and unresolved limitations. Check source, test, script and documentation references before removal; retain uncertain material and label historical findings clearly rather than presenting them as current behavior. This policy applies to future ordinary commits and does not authorize rewriting history.
