---
name: investigate-generation-prompts
description: "Use when empirically investigating or tuning the prompts and generation parameters of an LLM/content-generation pipeline — A/B comparing prompt or inspiration-source variants, deciding a parameter value (e.g. how many items to generate), validating that output quality matches a user's qualitative impression, or when a user says they cannot see the generated output file. Triggers: \"tune the prompt\", \"why are the generated results like this\", \"compare inspiration sources\", \"pick the right count/parameter\", \"show me what was generated\", quant-alpha/text/code generation tuning, dry-run experiments, output looks wrong or missing. It runs systematic dry-run experiments, quantifies qualitative observations into counts/metrics, checks variance before committing a value, and surfaces the output to the user."
license: Proprietary. LICENSE.txt has complete terms
compatibility: "Assumes a shell with git available and a generation pipeline you can invoke repeatedly in a dry-run / non-committing mode. Corpus is Claude Code on Linux/Ubuntu; the visibility script uses `git check-ignore` and standard POSIX tools."
---

Investigate generation behaviour empirically instead of guessing: explore the current setup, turn the user's qualitative impression into numbers, run controlled experiments, confirm stability, then change config and document what you found.

## 1. Explore before touching anything

Read the generation entry point and its config file end-to-end **before editing** — the parameters that shape output (prompt template, inspiration/source list, count, temperature) are usually clustered there, and editing blind tends to break assumptions you haven't seen yet.

## 2. Quantify the qualitative observation

When a user reports a vague impression ("the results feel repetitive", "too simple", "all similar"), convert it into a concrete metric over the **whole** output set, not a couple of samples — e.g. count operators/tokens/distinct sources across every generated item. A number you can compare beats an impression you can argue about, and it tells you whether the user's feeling is real before you spend effort fixing it.

If your metric comes from parsing output (regex, field extraction) and the parse fails or looks unreliable, **say so explicitly** rather than reporting a number you don't trust. A wrong metric is worse than an admitted gap.

## 3. Run controlled A/B dry-run experiments

Vary one thing at a time (one prompt variant, one inspiration source, one parameter) and run each in a dry-run / non-committing mode so experiments don't pollute real output. Hold everything else fixed so a difference is attributable. Compare the variants on the metric from step 2.

## 4. Check stability before committing a value

Generation is stochastic — a single run can mislead. Before you settle on a parameter value (a count, a chosen source, a prompt variant), run it **several times** and look at the variance. Commit the value only when the result is stable enough that the choice is defensible, and record the spread you saw.

## 5. Make the output visible to the user

A common failure: the generated file exists but the user can't see it because an ignore rule (e.g. a broad `*.txt` pattern in `.gitignore`) hides it from their tooling. Before telling the user "it's generated", confirm the path is actually surfaced. Run `scripts/check_output_visible.sh <path>` — if it reports the file is ignored, either write to a non-ignored path, add a negation rule, or show the contents directly instead of just pointing at the path.

## 6. Document and persist the insight

Write findings into a short report (use `assets/investigation-report.md`): what you tested, the numbers, the decision, and the residual uncertainty. Persist the one durable insight (the rule that will still be true next time) to memory so the next investigation starts ahead.

## Guardrails
- Do not report a metric derived from a failed or unreliable parse — disclose the gap instead.
- Confirm a generated output is actually visible to the user (not hidden by an ignore rule) before declaring it done.
- Run experiments in a dry-run / non-committing mode so investigation does not pollute real output.

## Anti-patterns (observed failures to avoid)
- Committing a parameter value from a single run without checking variance across repeats.
- Editing the config before reading it, breaking assumptions you never saw.
- Judging quality from one or two samples instead of a metric over the whole output set.
- Telling the user output is generated while it sits at a gitignored path they cannot see.

## Bundled scripts
- `scripts/check_output_visible.sh` (bash) — deterministic; prefer running this over re-deriving the steps by hand.

## Assets
- `assets/investigation-report.md` — template/resource to apply when producing the output.
