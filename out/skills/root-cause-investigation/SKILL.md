---
name: root-cause-investigation
description: "Use when asked to diagnose, debug, or explain WHY a system behaves a certain way and the answer is not obvious from one file — e.g. 'why does the classifier pick X', 'where does this skew come from', 'find the root cause of this behavior', 'investigate this anomaly'. Triggers on diagnostic/forensic questions over code, configs (YAML/JSON), prompts, logs, or data exports (CSV) where you must read multiple layers and quantify findings before concluding. Produces an evidence-grounded root-cause finding with numbers, not a guess. Keywords: diagnose, root cause, why, investigate, anomaly, skew, distribution, trace, debug across layers."
license: Proprietary. LICENSE.txt has complete terms
compatibility: "Assumes a shell with standard text/data tooling (grep, and a way to count/aggregate CSV rows such as awk/python). No OS-specific assumptions; works wherever the codebase and its logs/exports are readable."
---

Diagnostic questions ('why does it do X?', 'where does this skew come from?') are answered by tracing the behavior through every layer that produces it and backing each claim with a number — not by reading one file and asserting a cause. Surface symptoms and real root causes often live in different layers (a prompt, a config default, the data itself), so a single-file guess is usually wrong.

## 1. Frame the question as a measurable claim
Restate the question as something you can confirm or refute with evidence: not "is the classifier biased" but "what fraction of outputs fall into each class, and which input feature predicts that." If you can't name the number that would settle it, you don't yet understand the question — keep refining before you dig.

## 2. Enumerate the layers before reading any of them
List the layers that could plausibly produce the behavior: prompts/instructions, code paths, configuration (YAML/JSON, defaults, env), and the actual data flowing through. Naming them up front stops you from concluding at the first plausible-looking file. Most real root causes are found by checking a layer you'd have skipped.

## 3. Read the layers systematically, top to bottom
Work through each layer in order, reading the relevant prompts, then the code that consumes them, then the config that parameterizes it. Read before you theorize — a default value or a prompt clause often is the cause, and you only see it by looking.

## 4. Quantify against real data, don't assert
When logs or exports (CSV, JSONL) are available, measure. Count occurrences, compute the distribution, report fractions with their denominators (e.g. "66% of N rows", "359 of 769"). A quantified finding is checkable and survives scrutiny; a vague "it seems to favor X" does not. Prefer the raw export over your impression of it.

## 5. Trace to a root cause across layers, not a symptom
Before concluding, ask whether the thing you found *causes* the behavior or merely *correlates* with it. Follow it back: if the data is skewed, what produced the skew — a prompt, a default, an upstream filter? Stop when you reach a layer you can change to alter the outcome. That is the root cause; everything above it is a symptom.

## 6. Report the finding, grounded
State the root cause in one line, then the evidence chain: the number that demonstrates the behavior, the layer it traces to, and the specific code/config/prompt responsible. Distinguish what you measured from what you inferred.

## Working under interruption
Exploration can run long and get interrupted before you conclude. Keep a running note of what you've measured and what's left, so a partial finding is still useful and you can resume without re-reading everything. Surface your current best-supported conclusion early rather than holding everything until a grand finale.

## Guardrails
- Report fractions with their denominators so a claim is independently checkable; an unquantified 'it seems to favor X' is not a finding.
- Separate what you measured from what you inferred so a reader can trust the evidence chain.
- Because long explorations get interrupted, keep a resumable note of what's measured and what's pending, and surface a best-supported partial conclusion early.

## Anti-patterns (observed failures to avoid)
- Concluding from a single file without checking the other layers (prompt, code, config, data) that could produce the behavior.
- Asserting a cause vaguely instead of measuring the actual distribution from available logs/exports.
- Reporting a correlated symptom as the root cause without tracing back to the changeable layer that produces it.

## Assets
- `assets/root-cause-finding.md` — template/resource to apply when producing the output.
