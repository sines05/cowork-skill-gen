# Packaging & running — three ways, pick by audience

The engine talks to the LLM through a small adapter (`src/llm/runner.ts`) that has three
backends, auto-selected so the *same code* runs on a laptop, a server, or in a container:

| Runner | When | Needs |
|---|---|---|
| `ccs` (default) | dev box / fleet machine with the `ccs` gateway CLI | `ccs` on PATH + a profile (default `son`, or `MINER_CCS_PROFILE`) |
| `api` | container / headless / no CLI | `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` in the env (pure HTTP — **no `claude` CLI**) |
| `claude` | last resort | the ambient `claude` login (rate-limited under burst load) |

`--runner` overrides per command; the launcher auto-detects (ccs → api → claude).

---

## 1. Interactive launcher (easiest — for a person at a keyboard)

```bash
bun run start          # menu: pick corpus, run any stage, confirm cost inline
```

A single menu wraps every stage (mine / generate / validate / back-test / calibrate /
shadow / dashboard / full). It shells out with the terminal inherited, so each stage's own
prompts (the spend gate, the calibration review) still work. Runner + corpus are shown at the
top; `c` toggles corpus, `q` quits. This is the answer to "the commands should be interactive".

## 2. Docker (most reproducible — for a server / non-dev machine)

The image **bundles the Claude Code CLI** so EVERY stage works (mining, skill-gen, **and**
skilleval / calibrate — which call `claude -p` directly and have no HTTP path). Auth needs
**no interactive login**: `claude -p` reads `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`
straight from the env (bearer to your gateway). Cowork logs bind-mount read-only; SQLite +
generated skills persist to `./data` and `./out`.

```bash
bun run setup:env             # auto-writes .env: detects the Cowork logs path + pulls ccs creds
                              # (or `cp .env.example .env` and fill it by hand on a box without ccs)
docker build -t cowork-miner .
docker compose run --rm miner                                      # interactive launcher in the container
docker compose run --rm miner pipeline --source cowork --runner claude --mine --yes   # one stage, headless
docker compose run --rm miner skilleval --skill <name> --execute --yes --runner claude  # the back-test, in-container
```

> The image carries Node (the CLI's runtime) + the Claude Code CLI, so it's larger than a
> pure-Bun image — the price of running the *whole* system in one container. (The alternative,
> "HTTP-only / no CLI", would require giving `skilleval` + `calibrate` an `--runner api` path;
> not done yet.)

### Dashboard, integrated (one stack)

The leadership dashboard is wired into the **same** compose file under a `dashboard` profile —
Metabase reads the live `./data` DB and `dashboard-init` builds the BI views + provisions every
card (including the **back-test / eval uplift** cards), then prints the dashboard URL:

```bash
docker compose --profile dashboard up -d        # metabase + auto-provision
docker compose logs dashboard-init | grep dashboard/   # → http://localhost:3000/dashboard/<id>
# login: admin@cowork.local / Cowork-admin-1   ·   pick the cowork corpus with MINER_DB_FILE=cowork.db
```

The dashboard now shows, in order: Overview KPIs · Cost & tokens · Outcomes · Generated skills ·
**Skill back-test (with vs no-skill uplift, LLM + golden)**. The eval cards read `v_skill_telemetry`
(the latest `--execute` run per skill), so "does the skill actually help" is on the leadership view,
not just "a skill was generated".

Dashboard stays the already-built separate layer:

```bash
bun run bi:refresh && docker compose -f bi/docker-compose.yml up -d   # → http://localhost:3000
```

> **Why Docker is BI-only by default, and the engine is an *optional* container:** the miner's
> natural habitat is the machine that *has* the Cowork logs (an employee's Windows box). There,
> the launcher or the `.exe` is simpler than Docker. The engine image earns its keep on a
> **central analytics server** that pulls already-collected logs and runs headless via the api
> runner — which is exactly what `docker compose run miner …` is for.

## 3. Single binary (for fleet rollout — no Bun install)

```bash
bun run build:win      # dist/cowork-miner-win.exe   (Windows / MDM)
bun run build:linux    # dist/cowork-miner
```

> Caveat: `build:*` compiles `pipeline.ts` only (mining). Skill-gen / back-test / calibrate are
> separate entrypoints — for the full toolchain on a fleet machine, ship Bun + the repo + the
> launcher, or extend the build to compile `start.ts` as the entry once the launcher covers
> every stage.

---

## What still needs a decision before fleet use (not code)

- **Secrets**: the gateway token lives in `.env` / the ccs profile. For a fleet, distribute it
  via your secret manager / MDM, not the repo.
- **Log collection + redaction-at-source**: redaction now runs at the judge boundary, but the
  *collection* of employee logs to a central store (and running redaction on each machine before
  anything leaves) is still the 🔶 piece. That, plus legal/HR sign-off, gates real fleet use.
