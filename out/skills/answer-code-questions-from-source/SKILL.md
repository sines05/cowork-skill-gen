---
name: answer-code-questions-from-source
description: "Use when asked to explain, justify, or verify a claim about how a codebase actually behaves — 'why is X set to false', 'is this function a no-op', 'what does this flag do', 'how often is Y called', design-rationale and 'does this really work' questions. Triggers on requests to confirm behavior, audit a stub/dead code, prioritize findings by impact, or quantify usage from logs/telemetry. Grounds the answer in the real source and real data instead of guessing, and narrows noisy searches before drawing conclusions."
license: Proprietary. LICENSE.txt has complete terms
compatibility: "Assumes a shell with a code-search tool (grep/ripgrep) and read access to the repository and any telemetry/log files referenced in the question. No OS-specific tooling required."
---

# Answer code questions from source, not memory

When someone asks why the code behaves a certain way, whether something works, or how often a path runs, the cost of a confident-but-wrong answer is high. Resolve the question against the actual source and actual data before you commit to an answer.

## 1. Locate the relevant code before explaining it

Find the definition or call site the question is really about, then read it. A flag, default, or function name in the prompt is a starting point, not the answer — the behavior lives in the implementation.

- Read the source to confirm what a symbol actually does. A function with a promising name (e.g. a `validate_*` or `*_local` helper) can be a stub that returns success unconditionally; only reading it reveals that.
- When checking a default like `auto_index=False`, find where it is consumed, not just where it is declared — the rationale (a race condition, redundant work, wasted calls) is visible at the use site.

## 2. Narrow a noisy search before trusting it

A first broad grep often returns too many matches to reason about, and acting on the noisy result wastes a pass. When results are noisy, tighten the pattern (anchor it, add a path/type filter, match the fuller token) and re-run rather than skimming a flood of hits. Treat the narrowed result as the one you reason from.

## 3. Quantify claims about frequency or impact from real data

If the question is "how often" or "is this worth fixing", count it rather than estimating. Compute the distribution (e.g. tool-call counts across the available sessions/logs) to find dead or rarely-used paths, and prioritize findings by their effect on the metric that matters instead of listing everything equally.

## 4. Classify before any destructive step

If answering the question leads into cleanup (deleting logs, pruning stale index/manifest entries), distinguish transient/temp artifacts from accumulated data you cannot regenerate before removing anything, and check the manifest for stale entries rather than assuming. State which category each item falls in.

## 5. Handle transient tool failures with a retry, not a guess

Search tools and classifiers occasionally fail or come back empty for transient reasons. Re-run the command before concluding the code or data is absent — a single failed call is not evidence.

## 6. Answer with the evidence attached

State the conclusion, then cite what grounds it: the file/symbol you read, the count you computed, the data set size. Explain the *why* (the race condition, the 6x waste, the stub returning success) so the asker can verify and generalize, not just take your word.

## Guardrails
- Do not delete logs or prune index/manifest entries until each item is classified as transient/regenerable vs. accumulated data that cannot be recovered.
- Treat a single failed or empty tool/classifier call as transient — retry before concluding the code or data is missing.
- Attach the grounding evidence (file read, count computed, data size) to every claim so it can be independently verified.

## Anti-patterns (observed failures to avoid)
- Answering a behavior/rationale question from the symbol name or memory instead of reading the implementation.
- Drawing conclusions from a first broad grep whose results are too noisy to reason about, rather than tightening the filter and re-running.
- Estimating frequency or impact when the underlying data is available to count.
- Listing every finding with equal weight instead of prioritizing by impact on the metric that matters.
