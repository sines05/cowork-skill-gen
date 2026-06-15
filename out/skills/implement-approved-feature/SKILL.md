---
name: implement-approved-feature
description: "Use when implementing a feature or change request in a codebase — especially after a design discussion, when the user gives a terse approval ('do it', 'go ahead', 'thực hiện'), or asks to add/modify behavior across source files. Triggers: feature request, code change, refactor, 'implement', 'add support for', 'change X to Y', write-heavy edits, multi-file changes. Confirms the concrete scope against what was actually approved, grounds the design in the real repo code, then edits-test-verify in tracked steps and reports results honestly. Helps when a long design chat preceded a short OK and the delivered change risks drifting from the explicit ask."
license: Proprietary. LICENSE.txt has complete terms
compatibility: "Assumes a git repository and a runnable test/verification step (build, test suite, or end-to-end check). Corpus is Claude Code on Linux/Ubuntu; do not assume OS-specific tooling."
---

# Implement an approved feature without scope drift

The common failure here is delivering something that does not obviously match the *explicit* request. A long design discussion followed by a terse approval leaves the implemented scope only loosely tied to what was actually OK'd. Anchor on the concrete change before writing code.

## 1. Restate the concrete change and confirm scope

Before editing, write back — in one or two lines — the specific, literal change you are about to make ("change the 6 seed buckets to 6 named buckets", not "improve bucketing"). If a design discussion produced several ideas but the user approved tersely, the approval covers the *narrow stated change*, not every idea raised. When the discussion and the literal ask diverge, surface the gap and let the user pick scope rather than silently shipping the broader design.

Answer any conceptual questions the user asked *before* coding — they often gate the design decision.

## 2. Ground the design in the actual repo

Read the real entry points and the files you will change before proposing how. Base claims about current behavior on the code in front of you, not on assumptions — measure or inspect rather than guess (e.g. check the actual data/log/accuracy if a number drives the decision). This prevents building on a wrong mental model.

## 3. Branch and checkpoint

Branch off the main branch before making changes you will push, per typical repo policy. Commit a clean checkpoint before large edits so a bad regeneration or a transient error is easy to roll back.

## 4. Break the work into explicit tracked tasks

Decompose into small, individually verifiable tasks (e.g. 4a / 4b / 4c) rather than one sweeping edit. This keeps a write-heavy change reviewable and makes partial failure recoverable.

## 5. Edit, then test, then fix, then verify

Read each file before editing it. After mechanical reformatting (moving blocks, reindenting, regex edits), sanity-check structural integrity — balanced braces/brackets, valid syntax — before moving on. Run the tests; fix what breaks; then run an end-to-end check on the real artifact, not just unit tests. Cover invariants, edge tiers, modes, and fail-open behavior in the tests.

Transient infrastructure errors (a socket drop, a flaky network call mid-batch) are not logic bugs — re-run the affected step before assuming the code is wrong.

## 6. Report honestly and clean up

Report real results, including null or negative outcomes ("uplift +0") rather than overclaiming. Confirm side effects actually happened (e.g. telemetry persisted, file written) instead of assuming. Remove temp/scratch files before committing the final change.

## Avoid open-ended hangs

If an exploration or generation step appears to hang, it is better to bound it (timeout, smaller batch, progress output) than to leave the user waiting and forced to interrupt. Prefer the explain→plan→edit→verify path over diving into open-ended exploration with no checkpoint.

## Guardrails
- Confirm the literal scope of the change before write-heavy edits; the approval covers the stated change, not every idea from the discussion.
- Branch off main and commit a checkpoint before large or regenerative edits so failures are recoverable.
- Report real results including null/negative outcomes; verify side effects (telemetry, writes) actually persisted rather than assuming.

## Anti-patterns (observed failures to avoid)
- explore>qa>plan>edit>test>fix — diving into open-ended exploration with no checkpoint, which can hang and force a user interrupt.
- Treating a terse approval after a long design chat as license to implement the broad design instead of the explicit ask.
- Assuming a transient infrastructure error (socket drop) is a logic bug and rewriting code instead of re-running the step.

## Related skills
- **code-review** (followed_by) — Review the write-heavy diff for correctness and scope before merging.
- **verify** (followed_by) — Run the app/end-to-end to confirm the feature actually works, not just unit tests.
