---
name: feature-edit-validate-loop
description: "Use when implementing or modifying a feature in an existing codebase and you need confidence the change is correct — especially when the request touches behavior spread across several files, asks for an index/cache to stay in sync, or invites a design decision (e.g. 'should this auto-index?', 'is this the right place to fix it?'). Triggers: implement/change a feature, fix a bug whose root cause is unclear, validate an edit, refresh a derived index/cache after a code change, weigh a refactor vs. a targeted fix. Drives an explore → edit → run-the-real-path → QA → analyze loop: read code before editing it, trace the root cause across files before proposing a fix, run the actual code path to validate (not just unit asserts), and present design trade-offs (pros/risks) rather than jumping straight to a rewrite."
license: Proprietary. LICENSE.txt has complete terms
---

Use this loop when a coding request needs to *land correctly*, not just compile: feature edits, bug fixes with an unclear cause, or changes that must keep a derived index/cache in sync.

## 1. Explore before you touch anything

Read the file(s) you intend to edit, and the ones they call into, before writing a change. The point is to edit against the code that actually runs, not against your memory of how it probably works — small files still hide assumptions (a side effect, a cached value, an ordering constraint) that a blind one-line edit breaks.

## 2. Trace the root cause across files before proposing a fix

When the symptom and the cause may live in different places (e.g. an API client surfaces an error that originates in a tuner/config layer), follow the data through each hop before deciding where to change. Fixing at the first place the symptom appears tends to paper over the real defect and reopen later. Name the file and line where the cause actually lives, then fix there.

## 3. Make the edit, then run the real code path

Validate by exercising the actual path the change affects, end to end — not only an isolated assertion. If the change feeds a derived artifact (an index, a cache, a generated file), run the step that rebuilds it and confirm the artifact reflects the new behavior. Running the real path is what catches the integration gaps that unit-level checks miss.

## 4. QA the result against the original intent

Re-read the request and confirm the observed behavior matches what was asked — including the implicit part ("keep it in sync", "don't regress the other caller"). If you changed shared code, check the other callers you found in step 2.

## 5. When the request is a design question, analyze — don't just refactor

If the user is asking *whether* or *how* ("should this auto-index?", "is a refactor worth it?"), present the trade-offs: the options, their pros, and their concrete risks, then a recommendation. Jumping straight to a rewrite hides the decision the user actually wanted to make and discards cheaper targeted options.

## Edge cases

- If running the real path is expensive or destructive, run the narrowest slice that still exercises the changed behavior, and say what you could not run.
- If the root-cause trace turns up two plausible fix sites, surface both with their trade-offs rather than silently picking one.

## Guardrails
- When validation requires running an expensive or destructive path, run the narrowest representative slice and state explicitly what was not exercised.
- When editing shared code, re-check every caller found during the root-cause trace before declaring the change done.

## Anti-patterns (observed failures to avoid)
- Editing a file from memory without reading the code that actually runs, even when it looks like a trivial one-liner.
- Fixing the bug at the first place the symptom surfaces instead of at the originating layer.
- Validating only with an isolated assertion and skipping the real end-to-end path, so a derived index/cache silently goes stale.
- Jumping straight to a refactor when the user asked a design question that needed options and trade-offs.

## Related skills
- **verify** (followed_by) — After the edit-validate loop, run the app/feature to confirm the change behaves correctly in the real environment.
- **code-review** (see_also) — Use to review the diff for correctness bugs and cleanups once the change is made and validated.
