# Held-out evals + the shadow closed-loop

Two honesty upgrades to the trust gates. Both attack the same flaw: **a skill must not be
judged on the very evidence it was built from.**

---

## 1. Held-out evals (Gate 2-B, fixed)

### The flaw
`evals.json` used to be authored by the *same* LLM call that drafted the skill, from the
*same* exemplar episodes. The back-test then ran the skill against those cases. The skill
passed because it was reproducing the examples it learned from — **teaching-to-the-test**.
A high "uplift" number said nothing about whether the skill *generalises*.

### The fix — a train/held-out split
For each worth-codifying cluster, `splitMembers()` (`src/skills/skillgen.heldout.ts`)
deterministically partitions the member episodes:

| Partition | Used for |
|---|---|
| **train** (~70%) | the *only* episodes the skill-draft LLM sees (evidence, exemplars, grounding) |
| **held-out** (~30%, ≥1) | kept hidden; their **real task prompts** become the eval cases |

- The split is hash-ordered (`sha256(episode_id)`), so it is reproducible and uncorrelated
  with episode order. It folds into the skillgen cache key, so changing the split re-drafts.
- `buildHeldOutEvals()` turns each held-out episode into an `EvalCase`: the prompt is that
  episode's **real first human turn** (redacted), and the LLM-graded expectations are that
  episode's own observed `good_practices`. These are independent of the drafted skill.
- A skill that helps on held-out tasks (which it never saw) shows **real transfer**; one
  that only passes train is overfit.
- **Provenance is recorded** in `evals/evals.json` (`eval_provenance`) and `meta.json`, and
  surfaced by `skilleval`:
  - `held-out` — a genuine generalisation test.
  - `in-distribution` — fallback for a cluster too thin (n<2) to spare a held-out episode.
    **Explicitly flagged as NOT a generalisation test.** Honest, not hidden.

### Fair baseline
The `skilleval` "no-skill" arm now mirrors the with-skill framing (same "capable assistant…
respond with a plan" wrapper, only the `<skill>` block removed), so the measured uplift is
attributable to the skill content — not to extra scaffolding the with-skill arm happened to
carry.

### What it still is not
The held-out back-test is still an **offline proxy** (skill prepended, not installed; one
grader pass; small N). It is a fast pre-check, not proof. That is what the shadow loop is for.

---

## 2. Shadow closed-loop (Gate 3)

### The flaw
Every offline eval is the model predicting "I think this skill is useful". The question
leadership actually asks — *did deploying this skill make the real work better?* — can only
be answered by what happens **after** deployment, on tasks **nobody picked in advance**.

### The fix — observational before/after on future tasks
`src/skills/skillshadow.ts` records the closed loop in **shadow** mode (no live agent
intervention required):

```bash
bun run skillshadow --skill <name> --deploy     # mark live now; snapshot the PRE baseline
#   … keep mining future logs (new episodes accumulate) …
bun run skillshadow --skill <name> --report     # compare POST outcomes to the baseline
bun run skillshadow --list
```

- A skill's **task family** = the modal `task_type` of its source cluster (from `meta.json`
  `cluster_id`), overridable with `--task-type`.
- **Deploy** snapshots the pre-deploy baseline for that family: judged episodes with
  `started_at < deployed_at` → success rate + median friction (`skill_deployments` table).
- **Report** computes the same stats for episodes with `started_at >= deployed_at` and the
  delta (`skill_shadow_obs` table). `started_at` is ISO, so the split is purely chronological.
- Unlike the offline back-test, the post-deploy tasks are **real, arrived after the skill
  existed, and were not chosen by us** — so this is immune to teaching-to-the-test.

### What it is and isn't
It is a **quasi-experiment** (before/after on the same task family), **not an RCT**.
Confounders are real: people improve over time, task mix drifts. The tool says so out loud
and warns on small N. It is the strongest signal in the system precisely because the data is
future and unchosen — but it is evidence, not proof, and is reported as such.

---

## Related hardening (review follow-ups)

Smaller correctness/honesty fixes made alongside the two gates above:

- **Calibration honesty (Gate 1).** The spot-check sample is now **deterministic**
  (sha256-ordered, `--seed` to rotate) so the agreement number is reproducible and a
  reviewer re-opens the exact same cases. Every figure carries a **Wilson 95% CI**
  (`fmtRateCI`), and `--non-interactive` no longer fires LLM self-consistency by default
  (the trust gate runs `$0` on any machine). No more bare "82% on 11".
- **"continue" ≠ "satisfied".** English proceed cues (`continue`/`go`/`go ahead`/`proceed`/
  `next`) were pure-approval phrases, so a "continue" near a dropped task fired the +strong
  `explicit_user_approval` signal and inflated it to *success*. They are now continuation
  cues (matching the Vietnamese `tiếp tục` handling), and the signal additionally requires
  genuine satisfaction wording — defense in depth.
- **Exemplar opening prompt.** `first_prompt` is chosen from the episode's real opening
  `new_task` turn, never an interruption marker or empty turn — fixing report exemplars that
  showed "[Request interrupted by user]" and, because the same field feeds held-out eval
  prompts, keeping those clean too.
- **Cost excludes failed calls.** The BI cost views sum `cost_usd` only for `ok=1` calls
  (legacy `NULL` treated as ok), with `failed_calls` broken out — an errored call can no
  longer inflate reported spend.
- **Runner/path portability.** The `ccs` runner already fails soft to plain `claude` on a
  machine without the profile; paths resolve via the nearest `package.json` and `MINER_DB`.

## Where these sit in the gate chain

```
mine + judge → Gate 1 (calibration)
            → skillgen (draft from TRAIN) → Gate 2-A (static)
            → Gate 2-B (skilleval, back-test on HELD-OUT)   ← teaching-to-the-test removed
            → deploy → Gate 3 (skillshadow, before/after on FUTURE real tasks)  ← causal-ish
```
