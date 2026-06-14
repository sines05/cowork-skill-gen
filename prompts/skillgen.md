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
- **`description` is the trigger** and should be a bit "pushy": state BOTH what the skill
  does AND when to use it, with concrete keywords/contexts, because agents tend to
  under-trigger skills. ≤ 1024 characters.
- Keep the body focused (the spec recommends < 500 lines). Put long reference material
  in a `references` entry instead of bloating the body.

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

Provide 2–3 realistic `evals` test cases drawn from the exemplars: a natural-language
`prompt` a user would give, plus `assertions` that are **objectively verifiable**
(file produced, command exits 0, specific transformation happened). Skip assertions that
need human judgement. These feed a with-skill vs no-skill back-test downstream.

## Output schema (emit EXACTLY this object, all fields required unless marked optional)

```
{
  "name": "<kebab-case, 1-64 chars, [a-z0-9-] only, no leading/trailing/double hyphen>",
  "description": "<what + when + keywords, <=1024 chars, 'pushy'>",
  "compatibility": "<env requirements, <=500 chars, or null>",
  "artifact_type": "skill" | "script" | "sop",
  "skill_body_markdown": "<the SKILL.md body AFTER the frontmatter: imperative steps, examples, edge cases>",
  "references": [ { "filename": "REFERENCE.md", "markdown": "<detailed reference, optional, [] if none>" } ],
  "scripts": [ { "filename": "run.sh", "language": "bash"|"python"|"javascript", "code": "<self-contained, error-handling>" } ],
  "evals": [ { "name": "<short>", "prompt": "<user request>", "assertions": ["<objectively verifiable>"] } ],
  "citations": ["<sessionId#idx | friction: ... | pattern: ...>"],
  "guardrails": ["<safety/quality guardrails derived from risk_flags & friction>"],
  "anti_patterns": ["<the failing approaches to avoid, from fail patterns>"],
  "confidence": <number 0..1>
}
```

Rules:
- `name` MUST satisfy the regex `^[a-z0-9]+(-[a-z0-9]+)*$` and be ≤64 chars.
- `description` non-empty, ≤1024 chars.
- `scripts`/`references` are `[]` when not needed.
- Provide at least ONE valid `citation` grounding the skill in the evidence.
- Numbers are bare JSON numbers; booleans are bare `true`/`false`.

Return ONLY the JSON object.
