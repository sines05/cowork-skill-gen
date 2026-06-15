# Skill Standard — canonical file structure

What a generated skill folder contains, what each part is **for**, and the rule the
generator follows to emit or omit it. Grounded in the official
[Agent Skills specification](https://agentskills.io/specification) and Anthropic's own
[`anthropics/skills`](https://github.com/anthropics/skills) repo (especially `skill-creator`).

## The spec in one paragraph

A skill is a **directory** whose only required file is `SKILL.md`. Everything else —
`scripts/`, `references/`, `assets/` — is optional and exists to support
**progressive disclosure**: the agent loads as little as possible until a task needs more.
Three loading levels:

1. **Metadata** (`name` + `description`, ~100 tokens) — always in context, for *all* skills.
2. **Body** (the `SKILL.md` markdown, <500 lines) — loaded only when the skill triggers.
3. **Resources** (`scripts/`, `references/`, `assets/`) — loaded only when a step calls for them.

Designing to these levels is the whole point: the trigger lives in the description, the
procedure in the body, the heavy detail in files that load on demand.

## The folder

```
<skill-name>/
  SKILL.md                     # REQUIRED — metadata + instructions
  LICENSE.txt                  # license body referenced by the frontmatter
  scripts/                     # optional — executable, deterministic code
  references/                  # optional — docs loaded on demand
  assets/                      # optional — templates/schemas the OUTPUT must match
  evals/evals.json             # skill-creator convention — back-test cases
  meta.json                    # our extension — provenance + execution hint (NOT part of the spec)
```

### `SKILL.md` — required

YAML frontmatter + markdown body.

**Frontmatter fields** (spec constraints, enforced by `skillcheck`):

| Field | Required | Constraint | Purpose |
|---|---|---|---|
| `name` | ✅ | ≤64, `[a-z0-9-]`, no leading/trailing/`--` hyphen, **== dir name** | Stable identifier |
| `description` | ✅ | ≤1024, non-empty, **what + when + keywords** | The **trigger** — how an agent decides to use the skill. Leads with *when*. |
| `license` | — | name or file reference | Legal terms |
| `compatibility` | — | ≤500 | Real environment needs (tools/OS/network) — most skills omit it |
| `metadata` | — | string→string map | Client-defined extras |
| `allowed-tools` | — | space-separated (experimental) | Pre-approved tools |

**Body**: imperative, second-person instructions; explain *why* over barking `MUST`;
steps grounded in evidence; edge cases. Keep under 500 lines — push detail to `references/`.

### `LICENSE.txt`

Not in the spec, but every Anthropic skill ships one, and the `license` frontmatter
points at it (`license: Proprietary. LICENSE.txt has complete terms`). Our generator
writes a proprietary internal-use license. `skillcheck` warns if the frontmatter cites a
LICENSE file that is missing.

### `scripts/` — standardise the *doing*

Executable code for **deterministic, repeatable** steps: parsing, formatting, fixed API
calls, file moves, regex transforms. The body says *when/why* to run the script; the
script does the mechanical work the same way every time. This is the single biggest
reliability win — the agent stops re-deriving (and re-bungling) the same mechanics.

> **Rule the generator follows:** anything deterministic → a script entry. Anything that
> needs judgement (is this output correct? which approach fits?) → stays in the body.
> A script can't judge; never freeze a reasoning step into one.

### `references/` — split a multi-capability skill

When a skill spans several distinct capabilities (e.g. a "git" skill covering push, pull,
merge), the body becomes a short **index** — one line per capability + when to use it —
and each capability's detail goes to its own `references/<capability>.md`. The
always-loaded body stays small; detail loads on demand. For a single-capability skill,
`references/` is correctly absent.

### `assets/` — standardise the *deliverable*

The output-side twin of `scripts/`. When the workflow repeatedly produces output in a
**fixed shape** — a report template, a JSON/CSV schema the result must match, a checklist,
a config skeleton, a lookup table — bundle that artifact here and have the body fill it in,
rather than re-describing the shape in prose every time. Text only (no binaries) for mined
skills, so the redactor can scrub it. Absent when the output is free-form (e.g. research prose).

### `evals/evals.json` — the back-test handoff

skill-creator's convention (not shipped in the public repo — it's a dev artifact, but it
lives *inside* the skill dir). Schema:

```json
{
  "skill_name": "<name>",
  "evals": [
    { "id": 1, "prompt": "...", "expected_output": "...", "files": [],
      "expectations": ["semantic statement graded by an LLM"],
      "checks": [ { "kind": "regex", "value": "..." } ] }
  ]
}
```

- `expectations` — semantic statements graded by the **with-LLM** arm of `skilleval`.
- `checks` — **our deterministic extension**: `contains` / `regex` / `url_present` /
  `code_block` / `min_length`, graded in code at $0 (the **golden / no-LLM** arm).

### `meta.json` — provenance + execution hint (our extension, NOT spec)

Everything about *how the skill was made* that must **not** leak into the agent-facing
SKILL.md: `cluster_id`, `confidence`, the gate verdict, `citations`, `related_skills`, and
the mining `evidence_summary`. A skill answers "when/how to use me" — its creation history
belongs here.

It also carries an **`execution` hint** — `{ isolated, recommended_model }`. `isolated` is
true when the skill has no `depends_on` prerequisite, so an orchestrator may run it in its
own context at the suggested model tier. (This replaces an earlier `agent.md` file, which
was just SKILL.md restated — duplicated content, and sitting in the wrong place for Claude
Code to discover as a real sub-agent, since those live in `.claude/agents/`. The intent is
better expressed as one metadata field than as a parallel copy of the body.)

## What's required vs. what we add

| Layer | Files |
|---|---|
| **Spec-required** | `SKILL.md` |
| **Anthropic convention** | `LICENSE.txt`, `evals/evals.json` |
| **Spec-optional (emit when warranted)** | `scripts/`, `references/`, `assets/` |
| **Our extensions** | `meta.json` (provenance + execution hint), the `checks` field in evals |

> **Why no `agent.md` and no `agents/` folder?** `agent.md` would only restate SKILL.md.
> An `agents/` folder (like skill-creator's grader/comparator/analyzer) only fits a skill
> that decomposes into helper sub-agents — our mined skills are single procedures, and
> "needs another skill first" is already modelled by `related_skills` (`depends_on`).
> Inventing helper agents would mean fabricating content the evidence doesn't support.

Optional dirs are **omitted when the evidence shows no need** — no deterministic step
(→ no `scripts/`), one capability (→ no `references/`), free-form output (→ no `assets/`).
An empty structure is the correct answer there, not a deficiency.

## Validation

`skillcheck` (the quality-gate hook) enforces this standard deterministically, $0, no LLM:
spec name rules + `name == dir`, `description` ≤1024 and when-oriented, `compatibility`
≤500, license↔LICENSE.txt, **no dangling bundled-file references**, no creation-history
leak into the body, no PII, and a valid `meta.json` gate verdict. Run it with
`bun run skillcheck` (or it fires automatically via the PostToolUse hook on SKILL.md writes).
