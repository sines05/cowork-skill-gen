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

The image runs **entirely over HTTP** (`--runner api`), so it needs no `claude`/`ccs` CLI —
only gateway creds in the environment. Cowork logs are bind-mounted read-only; SQLite +
generated skills persist to `./data` and `./out`.

```bash
cp .env.example .env          # fill ANTHROPIC_BASE_URL / _AUTH_TOKEN (e.g. from `ccs env son`), COWORK_LOGS
docker compose run --rm miner                                   # interactive launcher in the container
docker compose run --rm miner pipeline --source cowork --runner api --mine --yes   # one stage, headless
docker compose run --rm miner skillcheck                        # any package.json script as the command
```

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
