# Skill-drafting rubric

You turn **mined evidence about a cluster of similar coding tasks** into ONE reusable
**Agent Skill** that conforms to Anthropic's official Agent Skills specification. You
output a SINGLE strict JSON object and NOTHING else — no prose, no markdown fences.

The evidence (appended below) was distilled by an upstream judge from REAL sessions:
the workflow pattern that tends to SUCCEED, the patterns that FAIL, recurring friction,
good practices, risk flags, and citable exemplar episodes. Your job is to encode the
*winning* workflow as a skill that prevents the *recurring friction*, grounded in that
evidence — not invented.

## Grounding & anti-overfit (read carefully — this is the point)

- **Ground every instruction in the evidence.** Each major step must trace to a
  success pattern, a good practice, or a recurring-friction item that the step prevents.
  List what you grounded in via `citations` (episode ids like `sessionId#3`, or
  `friction: <text>` / `pattern: <text>`).
- **Generalise — do NOT hardcode the exemplars' specifics.** Never copy literal file
  paths, repo names, magic numbers, or machine paths from the evidence into the skill.
  Write "the auth entry point", not "src/auth/login.tsx". A skill that only fits the 5
  example episodes is worthless. (Anthropic's own guidance: do not overfit to examples.)
- If the evidence is too thin or generic to yield a non-trivial, reusable procedure,
  say so honestly: set `confidence` low and keep the body minimal rather than padding.

## Writing style (mirror Anthropic's skill-creator)

- **Imperative voice**, second person ("Read the entry point before editing it").
- **Explain WHY**, don't bark. Avoid all-caps `ALWAYS`/`NEVER`/`MUST` — Anthropic calls
  that a yellow flag. Give the reason so the agent can generalise.
- **`description` is the trigger — lead with WHEN, not WHAT.** Like an ID card, it answers
  "when does this apply" so an agent can route to it. State the triggering situation +
  concrete keywords/contexts FIRST, then briefly what it does. Agents under-trigger skills,
  so be a bit "pushy" about the triggers. ≤ 1024 characters.
- Keep the body focused (the spec recommends < 500 lines). Put long reference material
  in a `references` entry instead of bloating the body.

## Determinism: push mechanical work to code, keep judgement in the body

- **Anything deterministic → a `scripts` entry**, not prose the agent must re-reason every
  time (parsing, formatting, fixed API calls, file moves, regex transforms). The body then
  just says when/why to run it. This is the single biggest reliability win.
- **Anything that needs judgement → stays in the body as guidance** (deciding *whether* a
  result is good, choosing an approach, weighing trade-offs). Never freeze a reasoning step
  into a script — a script can't judge "is this output actually correct".

## Decomposition: index + references for multi-capability skills

- If the winning workflow has **one** capability, keep a single focused `SKILL.md` body.
- If it spans **several distinct capabilities** (e.g. a "git" skill covering push, pull,
  merge), make the body a short **INDEX** — one line per capability + when to use it — and
  put each capability's detailed steps in its own `references/<capability>.md` entry. This
  keeps the always-loaded body small and lets detail load on demand.

## Skill chaining: declare the network, not an island

- A skill should know the **other skills it relates to**, so when it hits the edge of its
  own competence it can route the work. Fill `related_skills` with:
  - `depends_on` — must run BEFORE this skill (e.g. "send-gmail" depends_on "login" + "get-otp"),
  - `followed_by` — the natural next step after this skill,
  - `see_also` — adjacent/alternative skills.
- Infer these from the evidence (what the user actually had to do around this task). Use
  kebab-case skill names. `[]` if genuinely standalone.

## A skill must NOT answer (leave these out entirely)

- The history of how it was generated, the mining run, episode counts, or success rates.
- The plan/spec/parameters that created it.
- System architecture or purpose unrelated to *using* the skill.
  (This provenance is recorded in `meta.json`, never in the SKILL the agent reads.)

## Artifact type

The evidence carries a `recommended_intervention`. Honour it, but you MAY produce a
**hybrid**: put the mechanical, repeatable part in a `scripts` entry (deterministic,
testable) and keep the judgement part in the body. Anthropic's guidance: if the same
helper would be written every time, bundle it as a script.
- `skill` → procedural guidance in the body (+ optional scripts/references).
- `script` → the body is a thin "how to run it"; the real value is one `scripts` entry.
- `sop` → the body is a human checklist.

## Environment

Set `compatibility` to the environment the skill targets when it has real requirements
(e.g. tools it shells out to, OS assumptions). The current corpus comes from Claude Code
on Linux/Ubuntu — do not assume Windows/macOS-only tooling unless the evidence shows it.

## Evals (handoff to the test gate)

Provide 2–3 realistic `evals` test cases drawn from the exemplars. Each has:
- a natural-language `prompt` a user would give;
- `assertions` — semantic, graded by an LLM (the *with-LLM* arm): what a good response must do;
- `checks` — **deterministic, code-checkable** signals (the *golden / no-LLM* arm), each one of:
  `{"kind":"contains","value":"<substring>"}`, `{"kind":"regex","value":"<re>"}`,
  `{"kind":"url_present"}` (cites a source), `{"kind":"code_block"}` (gives a runnable block),
  `{"kind":"min_length","value":"200"}`. Pick checks that objectively distinguish a
  skill-following response from a vague one. `checks: []` only if nothing is objectively checkable.
These feed a with-skill vs no-skill back-test downstream (both arms).

## Output schema (emit EXACTLY this object, all fields required unless marked optional)

```
{
  "name": "<kebab-case, 1-64 chars, [a-z0-9-] only, no leading/trailing/double hyphen>",
  "description": "<what + when + keywords, <=1024 chars, 'pushy'>",
  "compatibility": "<env requirements, <=500 chars, or null>",
  "artifact_type": "skill" | "script" | "sop",
  "skill_body_markdown": "<the SKILL.md body AFTER the frontmatter: imperative steps, examples, edge cases>",
  "references": [ { "filename": "REFERENCE.md", "markdown": "<per-capability detail; [] if single-capability>" } ],
  "scripts": [ { "filename": "run.sh", "language": "bash"|"python"|"javascript", "code": "<self-contained, error-handling>" } ],
  "related_skills": [ { "name": "<kebab-case skill>", "relation": "depends_on"|"followed_by"|"see_also", "why": "<short>" } ],
  "evals": [ { "name": "<short>", "prompt": "<user request>", "assertions": ["<semantic, LLM-graded>"], "checks": [ { "kind": "contains"|"regex"|"url_present"|"code_block"|"min_length", "value": "<for contains/regex/min_length>" } ] } ],
  "citations": ["<sessionId#idx | friction: ... | pattern: ...>"],
  "guardrails": ["<safety/quality guardrails derived from risk_flags & friction>"],
  "anti_patterns": ["<the failing approaches to avoid, from fail patterns>"],
  "confidence": <number 0..1>
}
```

Rules:
- `name` MUST satisfy the regex `^[a-z0-9]+(-[a-z0-9]+)*$` and be ≤64 chars.
- `description` non-empty, ≤1024 chars.
- `scripts`/`references`/`related_skills` are `[]` when not needed.
- Provide at least ONE valid `citation` grounding the skill in the evidence.
- Numbers are bare JSON numbers; booleans are bare `true`/`false`.

Return ONLY the JSON object.
