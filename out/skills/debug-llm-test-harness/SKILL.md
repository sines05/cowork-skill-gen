---
name: debug-llm-test-harness
description: "Use when debugging or analyzing an LLM/agent test harness, a prompt, or a simulation/eval runner — especially when investigating why a run hangs, produces empty progress output, or behaves unexpectedly, or when auditing a prompt's behavior and reporting findings. Triggers: 'why is this run hanging', 'no output from the harness', 'analyze this prompt', 'validate operators/config against data', tool/function-calling schema errors, gemini/anthropic function-calling mocks, simulation step loops, monitoring a long-running eval. Helps you read config before claiming, keep test mocks faithful to real signatures, get real-time progress with unbuffered output, and report findings grounded in code paths that actually execute."
license: Proprietary. LICENSE.txt has complete terms
compatibility: "Assumes a POSIX-ish shell (bash) for running the harness with unbuffered output. Language-agnostic guidance; examples use Python (`python -u`, `stdbuf`) but the principles apply to any runner that buffers stdout or uses function-calling/tool schemas."
---

# Debug & analyze an LLM test harness

Use this when something is wrong with a prompt, an eval/simulation runner, or a test harness around an LLM — it hangs, prints nothing, or you need to report what the code actually does. The failure mode here is confident-but-wrong: claiming behavior you didn't verify, or breaking the run with an unfaithful test double.

## 1. Read the prompt/config before claiming anything

Open the actual prompt, config, and any reference data (CSV/JSON tables of valid operators, dialects, metric names) before stating how the system behaves. Conclusions asserted from memory or a quick skim are the main way these investigations go wrong.

When you make a claim about a value (an operator name, a dialect, a metric), validate it against the source-of-truth data, not against your reading of the code. Cross-checking operator names against the data table is cheap and catches invented specifics.

## 2. Confirm a code path actually executes at runtime before reporting it

A branch existing in the source does not mean it is hit. Before you report "the system uses dialect X" or "this validation runs," trace whether that path is reachable in the run you're analyzing — add a log line, set a breakpoint, or grep the call sites and check the conditions guarding them.

Reason: an earlier investigation overstated a finding (a "legacy dialect" in use) based on a code path that wasn't reached at runtime. State findings at the confidence the evidence supports, and retract gracefully if pushed back on rather than defending an over-read.

## 3. Keep test mocks faithful to the real signature

When you write a mock/stub for an LLM call — especially for function-calling / tool-use — match the real thing exactly: same function name, same parameter names, and type annotations where the framework reads them. Function-calling schemas are often *derived from* the mock's signature and annotations; an untyped or misnamed mock silently produces an invalid schema, and the provider may hang the request instead of erroring fast.

Reason: a self-written mock with no type annotation and a mismatched name broke the function-calling schema and hung a run ~9 minutes. If a run hangs near a model call, suspect your own test double's signature before suspecting the provider.

## 4. Run with unbuffered output so you can actually see progress

Long step-loops and simulations buffer stdout; piping through `tail` then shows nothing and you waste a cycle thinking it's stuck. Run unbuffered (e.g. `python -u`, or wrap with `stdbuf -oL -eL`) and prefer line-buffered streaming over tail-only capture when monitoring. See `scripts/run-unbuffered.sh`.

## 5. Diagnose → fix → re-test → report

After a fix, re-run and confirm the symptom is gone before declaring success. Report findings using `assets/findings-template.md`: each finding carries the evidence (file/line or log excerpt), whether the path is confirmed-executed, and a confidence level. Drop or downgrade any finding you couldn't confirm.

## Edge cases
- If you removed a check (e.g. a local-syntax validation or a result-diagnosis step) because it's redundant, confirm nothing downstream depends on its side effects before deleting.
- If the harness mixes per-step metrics sent to the LLM across many loop iterations, instrument one iteration end-to-end before generalizing about all of them.

## Guardrails
- Do not assert system behavior from a code path's existence alone — confirm it executes at runtime before reporting it.
- Validate concrete values (operator names, dialects, metric names) against the source-of-truth data, not against a reading of the code.
- When deleting a redundant validation/diagnosis step, confirm nothing downstream relies on its side effects first.
- State findings at the confidence the evidence supports and retract gracefully when challenged rather than defending an over-read.

## Anti-patterns (observed failures to avoid)
- Writing an LLM/function-calling mock with a mismatched name or missing type annotations, producing an invalid tool schema that hangs the run.
- Monitoring a buffered process through a tail-only pipe and concluding it's stuck when output is simply buffered.
- Reporting a 'finding' (e.g. a legacy dialect in use) based on a branch that isn't actually hit at runtime.
- Claiming prompt/config behavior before opening and reading the prompt, config, and reference data.

## Bundled scripts
- `scripts/run-unbuffered.sh` (bash) — deterministic; prefer running this over re-deriving the steps by hand.

## Assets
- `assets/findings-template.md` — template/resource to apply when producing the output.
