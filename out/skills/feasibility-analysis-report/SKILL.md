---
name: feasibility-analysis-report
description: "Use when asked to assess whether something is feasible and write or edit a feasibility/analysis report grounded in source documents — e.g. 'is this approach viable', 'check X and research Y', 'write a feasibility report', 'evaluate whether this can work on <platform/environment>'. Triggers on tasks that mix reading existing docs, verifying environment- or platform-specific facts (file paths, OS targets, transcript/storage locations), and producing a written verdict with a test plan. Steers you to read every source first, separate confirmed facts from claims still needing verification, verify environment specifics with web search instead of guessing, and edit precisely so transient errors don't corrupt the document. Keywords: feasibility, viability assessment, analysis report, can this work, verify path, platform-specific, test plan, PASS criteria."
license: Proprietary. LICENSE.txt has complete terms
compatibility: "Assumes an agent with file read/edit access and a web search tool for verifying external facts. No OS-specific tooling required; platform-specific claims (paths, storage locations) must be verified per target environment rather than assumed."
---

Produce a feasibility report that a reader can trust: every claim is either confirmed from a source or clearly flagged as needing verification, and the conclusion comes with a concrete way to test it.

## 1. Read all the source material first

Read every referenced document and the relevant region of every file you'll touch *before* forming an assessment. A feasibility verdict written before you've seen the inputs tends to conflate distinct systems or assert paths that don't exist — the most common cause of rework here is a report that mixed up platforms and stated an incorrect location, then needed several corrective passes. Reading first prevents that.

## 2. Separate confirmed facts from claims needing verification

As you read, sort each relevant statement into one of two buckets:
- **Confirmed** — directly supported by a source you read.
- **Needs verification** — plausible but not yet grounded (especially environment specifics: file paths, OS targets, where data is stored).

Keep these visibly separate in the report. Mixing an unverified guess in with confirmed facts is what makes a feasibility report misleading.

## 3. Verify environment- and platform-specific facts before asserting them

Paths, storage locations, and platform behaviour differ by OS and product. Don't infer them from one example or from a different platform. Use web search (or the authoritative doc) to confirm the *real* value for the *target* environment before writing it down. If you can't verify it, leave it in the "needs verification" bucket rather than promoting it.

## 4. Adapt when the user supplies new facts

If the user corrects an assumption or adds a constraint (a different platform target, where data actually lives), revise the affected sections rather than defending the original draft. New facts override prior inference.

## 5. Edit precisely, and re-read the region before each edit

Re-read the exact region right before editing it so the change lands where you intend. Make focused edits rather than large rewrites: a transient API/socket error can interrupt an edit mid-stream, and small, idempotent edits are far easier to recover and re-apply than a half-written wholesale rewrite. After an interruption, re-read the file to see what actually landed before retrying.

## 6. End with a concrete, testable conclusion

Don't stop at "feasible / not feasible." State the verdict, then give a test plan that someone else could execute: the roles involved (per machine/environment where relevant), the steps, and explicit PASS criteria. A feasibility claim is only as good as the experiment that would confirm it.

Fill in the bundled report template rather than re-inventing the structure each time.

## Guardrails
- Do not assert environment- or platform-specific paths/locations without verifying them for the actual target; otherwise flag them as needing verification.
- Never present an unverified guess as a confirmed fact — keep the two buckets visibly separate.
- Prefer small, focused edits; after a transient/interrupted edit, re-read the file to see what landed before retrying so the document isn't left half-written.

## Anti-patterns (observed failures to avoid)
- Writing the feasibility verdict before reading all the source docs, which leads to conflating distinct platforms/systems.
- Copying a file path or storage location from one platform and assuming it holds on the target platform.
- Doing a large wholesale rewrite that a mid-stream error can corrupt, instead of focused idempotent edits.
- Concluding 'feasible' with no test plan or PASS criteria for someone to confirm it.

## Assets
- `assets/feasibility-report-template.md` — template/resource to apply when producing the output.
