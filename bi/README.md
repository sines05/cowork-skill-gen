# BI / Leadership Dashboard (Metabase)

The dashboard is a **separate presentation layer**, not part of the Bun mining engine.
Two layers:

| Layer | Tech | Why |
|---|---|---|
| Mining engine | Bun/TS, zero-dep → **SQLite schema** | headless, single-binary, runs anywhere |
| **Presentation (this dir)** | **Metabase** (a real BI tool) | self-serve charts, auth/RBAC, scheduled reports, sharing — on a central server |

We use **Metabase** (one container, reads SQLite directly, polished, fast to stand up).
*Superset* is the heavier alternative — choose it only if you need fine-grained RBAC / SQL Lab
at scale (it needs Python + Redis + a metadata DB + workers).

> The hand-rolled `out/dashboard.html` (from `bun run dashboard`) is an **offline snapshot
> fallback only** — for the air-gapped / single-`.exe` case where you can't run a BI server.
> It is NOT the primary dashboard.

## Setup (all config-as-code)

```bash
bun run bi:refresh      # (re)build BI views, fold WAL, copy a writable snapshot → bi/data/analysis.db
bun run bi:up           # docker compose up -d  (Metabase on :3000)
bun run bi:provision    # create admin + register the SQLite source + sync + verify the 5 views
# → open http://localhost:3000   (admin@cowork.local / Cowork-admin-1)
```

`bi:refresh` snapshots the DB into `bi/data/` (world-writable, because SQLite must create a
journal even to *read*, and Metabase runs as a different uid). Re-run it whenever the corpus
changes, then re-sync in Metabase (Admin → Databases → Sync).

## What to chart (the BI views, created by `bun run views`)

| View | Use |
|---|---|
| `v_episode_full` | one flat row per episode (project, outcome, friction, tools, duration, tokens, source machine) — the main fact table |
| `v_task_type_summary` | success% + avg friction per task type — "which work succeeds" |
| `v_outcome_distribution` | outcome counts — a single pie/bar |
| `v_calibration` | judge outcome vs human outcome + agreement — the trust view |
| `v_skill_drafts` | generated skills: type, gate status, confidence |

`bun run bi:provision` **auto-builds** a starter dashboard **"Cowork — Leadership"** (8 cards:
total/judged/success%/calibration-agreement scalars · outcome pie · success% by task_type ·
episodes by project · generated-skills table) via the API — open `http://localhost:3000/dashboard/2`.
It's idempotent (reuses cards by name, re-applies layout). Add/rearrange cards in the UI from there;
Admin can schedule an email/Slack digest of the dashboard.

## Production note
At this corpus size SQLite is fine. For a multi-machine fleet, point the **miner** at Postgres
(swap `bun:sqlite` for a pg client) and connect Metabase to Postgres instead — **no dashboard
rework**, just a different data-source connection. Cross-machine data arrives via
`bun run merge` (provenance preserved in `sessions.source`, surfaced as `v_episode_full.source_machine`).
