---
name: verify-end-to-end-pipeline-run
description: "Use when you need to verify that an end-to-end pipeline or multi-stage feature actually works after a change — triggers: 'run the pipeline and confirm it works', 'verify the feature end to end', 'check the generated artifacts are valid', 'is the full run green', debugging a stage that timed out or hit transient API/system errors, or confirming output files conform to a spec before declaring done. Drives the loop explore → plan → test → fix root cause → re-test → clean up → document: read the relevant source before touching it, run the whole pipeline, diagnose any failing stage to its root cause (e.g. a too-tight timeout on a slow call) rather than ignoring it, re-run to prove the fix, validate every produced artifact against its schema/spec, then tidy stale outputs and sync docs/dashboards. Keywords: end-to-end, e2e, pipeline run, feature verification, artifact validation, timeout, transient error, re-run."
license: Proprietary. LICENSE.txt has complete terms
compatibility: "Assumes a shell with the project's normal toolchain (run scripts, package manager) available; corpus came from Claude Code on Linux/Ubuntu. No OS-specific tooling required."
---

Verify an end-to-end run by closing a loop, not by eyeballing one pass. The goal is a run you can trust: every stage executed, every artifact conforms to its spec, and any failure was fixed at its cause and re-proven.

## 1. Explore before you touch
Read the source for the stages you'll exercise or change *before* editing them. Knowing what a stage actually does (its inputs, its timeout, where it writes output) prevents fixing the wrong thing. Don't assume from the name — open the file.

## 2. Plan the run
Decide what "green" means up front: which stages must complete, which artifacts they produce, and the spec/schema each artifact must satisfy. Write the success criteria down so verification is a checklist, not a vibe.

## 3. Run the full pipeline
Exercise the whole flow end to end, not just the stage you changed. A change can pass in isolation and break a downstream consumer of its output.

## 4. Diagnose failures to root cause
When a stage fails, find *why* before retrying.
- Distinguish a **transient** failure (intermittent API/system error, flaky network) from a **systematic** one. A transient error justifies a retry; a systematic one does not — retrying just hides it.
- A stage that times out is usually a too-tight limit on a legitimately slow operation, not a hung process. Confirm the operation completes given enough time, then raise the limit at the cause rather than wrapping the symptom or silently ignoring the stage.
- Apply the fix at the stage that owns the problem, then continue.

## 5. Re-run to prove the fix
A fix is unverified until the pipeline runs clean again. Re-run the failing stage (and its dependents) and confirm it now passes. Don't declare success off the first run that errored.

## 6. Validate every artifact against its spec
A stage exiting 0 is necessary, not sufficient. Open the artifacts it produced and check them against their schema/template — required fields present, shape correct, no empties or placeholders. Wrong-but-present output is the failure mode this step catches.

## 7. Clean up
Remove stale output folders, partial artifacts from failed runs, and temp files the run left behind. A clean tree means the next run's results aren't confused with this one's leftovers.

## 8. Document and sync
Update any docs, READMEs, or dashboards/snapshots that should reflect the new state, so data and docs don't drift from reality. Ground every claim you make about the run in concrete evidence from it (actual outputs, exit states), not in what you expected to happen.

## Reporting
When you report, say plainly what ran, what passed, what you fixed and why, and what (if anything) is still failing — with the evidence. Don't round a partial pass up to "done".

## Guardrails
- Treat a stage exiting 0 as necessary but not sufficient — validate the produced artifact's contents against its spec before calling the run good.
- Re-run after any fix and report only what the actual run shows; never round a partial or errored pass up to 'done'.
- Before deleting output/temp files during cleanup, confirm they are stale leftovers and not the run's real deliverables.

## Anti-patterns (observed failures to avoid)
- Retrying a failed stage without diagnosing whether the failure was transient or systematic.
- Working around a timeout by ignoring/skipping the stage instead of fixing the limit at its cause.
- Editing a stage from its name or assumptions without reading the source first.
- Declaring the pipeline verified off a single run that contained errors.
- Leaving stale output folders and temp files behind, so the next run's results get confused with leftovers.

## Related skills
- **verify** (see_also) — General 'run the app and observe behavior' verification; this skill specializes it to multi-stage pipeline runs and artifact validation.
- **validate-artifact-against-schema** (followed_by) — Step 6 hands off to detailed schema/spec conformance checking of produced artifacts.
