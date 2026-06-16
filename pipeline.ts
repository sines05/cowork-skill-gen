// Orchestrator (resumable): discover → classify → group → signals → subagents → render → judge → store.
// Usage:
//   bun run pipeline.ts [--project <substr>] [--session <id>] [--limit N] [--since ISO] [--resume]
//                       [--classify-llm] [--max-episodes N] [--no-judge]
//                       [--max-cost USD] [--yes] [--db <path>] [--mine]
//                       [--runner ccs|claude] [--ccs-profile <name>]
//
// --runner picks how the headless `claude -p` calls are routed (default: ccs):
//   ccs    → real `claude` binary with the ccs profile's env injected
//            (ANTHROPIC_BASE_URL/_AUTH_TOKEN from `ccs env <--ccs-profile>`, default son)
//   claude → plain `claude` with the ambient environment
//
// Resume model: all writes are idempotent upserts and the judge is cache-keyed on
// content+prompt+schema+model+cli, so re-running simply skips already-judged episodes.
import { getSource } from "./src/ingest/source.ts";
import { classifyTurns } from "./src/pipeline/classify.ts";
import { segmentEpisodes } from "./src/pipeline/segment.ts";
import { attachSubagents } from "./src/pipeline/subagents.ts";
import { computeSignalsAndFeatures } from "./src/pipeline/signals.ts";
import { renderEpisodeRedacted } from "./src/pipeline/render.ts";
import {
  judgeEpisode,
  getJudgePromptHash,
  getModel,
  getCliVersion,
} from "./src/llm/judge.ts";
import { judgeEpisodeDebate, debateCacheHash } from "./src/llm/judge.debate.ts";
import { mine } from "./src/analysis/mine.ts";
import { report } from "./src/analysis/report.ts";
import { configureRunner, describeRunner, setLlmPhase, type RunnerName } from "./src/llm/runner.ts";
import {
  openDb,
  upsertSession,
  upsertTurn,
  upsertEpisode,
  upsertLabel,
  upsertJudgeRounds,
  isJudged,
  pruneSessionEpisodes,
  type CacheKey,
} from "./src/db/db.ts";
import { LABEL_SCHEMA_VERSION, type Episode } from "./src/core/types.ts";

// Rough metered cost of one headless judge call (used only for the est-cost gate;
// actual cost varies with episode size and the retry path).
const COST_PER_JUDGE_USD = 0.4;
const AVG_EPISODES_PER_SESSION = 3; // corpus ≈ 329 episodes / 111 sessions
const CONFIRM_COST_THRESHOLD_USD = 5; // only prompt above this estimated spend
const MAX_CONSEC_JUDGE_ERRORS = 5; // circuit breaker for a broken judge/CLI

interface Flags {
  project?: string;
  session?: string;
  limit?: number;
  since?: string;
  resume: boolean;
  classifyLlm: boolean;
  maxEpisodes?: number;
  noJudge: boolean;
  maxCost?: number;
  yes: boolean;
  dbPath?: string;
  mine: boolean;
  runner?: RunnerName;
  ccsProfile?: string;
  source?: string;
  judgeDebate: boolean;
  judgeRounds?: number;
}

// Parse a numeric flag, failing CLOSED on a missing/non-numeric value. A cost-bearing
// run must never silently fall back to "unbounded" because a flag value was a typo.
function numFlag(name: string, raw: string | undefined): number {
  const n = Number(raw);
  if (raw === undefined || raw === "" || !Number.isFinite(n)) {
    console.error(
      `[pipeline] flag ${name} requires a numeric value (got ${JSON.stringify(raw)}). Aborting.`
    );
    process.exit(2);
  }
  return n;
}

function parseFlags(argv: string[]): Flags {
  const f: Flags = { resume: false, classifyLlm: false, noJudge: false, yes: false, mine: false, judgeDebate: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--project": f.project = next(); break;
      case "--session": f.session = next(); break;
      case "--limit": f.limit = numFlag("--limit", next()); break;
      case "--since": f.since = next(); break;
      case "--resume": f.resume = true; break;
      case "--classify-llm": f.classifyLlm = true; break;
      case "--max-episodes": f.maxEpisodes = numFlag("--max-episodes", next()); break;
      case "--no-judge": f.noJudge = true; break;
      case "--max-cost": f.maxCost = numFlag("--max-cost", next()); break;
      case "--yes": case "-y": f.yes = true; break;
      case "--db": f.dbPath = next(); break;
      case "--mine": f.mine = true; break;
      case "--runner": {
        const v = next();
        if (v !== "ccs" && v !== "claude" && v !== "api") {
          console.error(
            `[pipeline] --runner must be "ccs", "claude" or "api" (got ${JSON.stringify(v)}). Aborting.`
          );
          process.exit(2);
        }
        f.runner = v;
        break;
      }
      case "--ccs-profile": f.ccsProfile = next(); break;
      case "--source": f.source = next(); break;
      case "--judge-debate": f.judgeDebate = true; break;
      case "--judge-rounds": f.judgeRounds = numFlag("--judge-rounds", next()); break;
      default:
        if (a.startsWith("--")) console.warn(`[pipeline] unknown flag ignored: ${a}`);
    }
  }
  // Env fallback for the cost ceiling: if --max-cost wasn't passed but MINER_MAX_COST is set,
  // use it. Lets `bun run all` stay cap-free by default yet be bounded without editing scripts.
  if (f.maxCost === undefined && process.env.MINER_MAX_COST) {
    const v = Number(process.env.MINER_MAX_COST);
    if (Number.isFinite(v) && v >= 0) f.maxCost = v;
  }
  // Env fallback for the session scope: lets the fixed `bun run all` chain run end-to-end
  // for ONE session (MINER_SESSION=<id> bun run all) without editing the script. --session wins.
  if (f.session === undefined && process.env.MINER_SESSION?.trim()) {
    f.session = process.env.MINER_SESSION.trim();
  }
  if (f.limit !== undefined && f.limit < 0) {
    console.error("[pipeline] --limit must be >= 0. Aborting.");
    process.exit(2);
  }
  if (f.maxEpisodes !== undefined && f.maxEpisodes < 0) {
    console.error("[pipeline] --max-episodes must be >= 0. Aborting.");
    process.exit(2);
  }
  return f;
}

function log(msg: string) {
  console.log(`[pipeline] ${msg}`);
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const db = openDb(flags.dbPath);

  // Select the LLM runner before any headless `claude -p` call. Default: ccs:son.
  configureRunner({ runner: flags.runner, ccsProfile: flags.ccsProfile });
  log(`LLM runner: ${describeRunner()}`);

  // Cache-key constants (cheap, side-effect-free getters) — resolved once.
  const judgePromptHash = getJudgePromptHash();
  // Debate path: content-addressed hash of the lenses + templates + round budget, so the
  // pre-judge cache check here matches the hash the debate judge stamps (no stale "debate" literal).
  const debateHash = debateCacheHash(flags.judgeRounds);
  const model = getModel();
  const cliVersion = flags.noJudge ? "" : await getCliVersion();

  const source = getSource(flags.source);
  log(
    `source: ${source.name} · discovering sessions` +
      `${flags.project ? ` (project~="${flags.project}")` : ""}` +
      `${flags.session ? ` (session^="${flags.session}")` : ""}…`
  );
  const sessions = await source.discover({
    project: flags.project,
    session: flags.session,
    since: flags.since,
    limit: flags.limit,
  });
  log(`found ${sessions.length} session(s).`);

  // ── Cost gate (H2) ────────────────────────────────────────────────────────
  // Confirm before an expensive serial judge run. Upper-bound estimate (ignores
  // cache); --yes skips it; --no-judge has no cost. Fails CLOSED on non-TTY.
  if (!flags.noJudge && !flags.yes) {
    const estEpisodes =
      flags.maxEpisodes !== undefined
        ? Math.min(flags.maxEpisodes, sessions.length * AVG_EPISODES_PER_SESSION)
        : sessions.length * AVG_EPISODES_PER_SESSION;
    const estCost = estEpisodes * COST_PER_JUDGE_USD;
    if (estCost > CONFIRM_COST_THRESHOLD_USD) {
      const answer = prompt(
        `[pipeline] About to judge up to ~${estEpisodes} uncached episodes ` +
          `(~$${estCost.toFixed(0)} at $${COST_PER_JUDGE_USD}/call; cache reduces this). ` +
          `Proceed? [y/N] `
      );
      if (!answer || !/^y(es)?$/i.test(answer.trim())) {
        log("aborted at cost gate (pass --yes to skip, or --max-episodes/--max-cost to bound).");
        db.close();
        return;
      }
    }
  }

  let totalEpisodes = 0;
  let judged = 0;
  let skipped = 0;
  let judgeErrors = 0;
  let sessionErrors = 0;
  let spentUsd = 0;
  let redactedTotal = 0; // secrets/PII scrubbed at the judge boundary (no silent redaction)
  let consecErrors = 0;
  let stopJudging = false;
  let episodeBudget = flags.maxEpisodes ?? Infinity; // flags validated → never NaN

  for (let si = 0; si < sessions.length; si++) {
    const session = sessions[si];

    // ── Structure phase (H6: one bad session must skip, not abort the run) ──
    let episodes: Episode[];
    let turns: Awaited<ReturnType<typeof classifyTurns>>;
    try {
      const events = await source.read(session);
      setLlmPhase("classify"); // any LLM classify calls below land in the classify bucket
      turns = await classifyTurns(session, events, { classifyLlm: flags.classifyLlm });
      episodes = segmentEpisodes(session, events, turns);
      episodes.forEach((ep, i) => {
        // consumed by signals.ts abandoned_mid_edit heuristic
        (ep as any).isLastInSession = i === episodes.length - 1;
      });
      await attachSubagents(session, episodes);
      for (const ep of episodes) computeSignalsAndFeatures(ep);

      // persist structure: prune orphans first, then session, turns, episodes
      pruneSessionEpisodes(db, session.sessionId, episodes.map((e) => e.episodeId));
      upsertSession(db, session, episodes.length);
      for (const t of turns) upsertTurn(db, t);
      for (const ep of episodes) upsertEpisode(db, ep);
    } catch (e) {
      sessionErrors++;
      log(`  ! skip session ${session.project}/${session.sessionId.slice(0, 8)} (${(e as Error).message})`);
      continue;
    }

    totalEpisodes += episodes.length;
    log(
      `[${si + 1}/${sessions.length}] ${session.project}/${session.sessionId.slice(0, 8)} ` +
        `— ${turns.length} turns → ${episodes.length} episodes`
    );

    // ── Judge phase ──────────────────────────────────────────────────────────
    if (flags.noJudge || stopJudging) continue;
    setLlmPhase("judge"); // judge/debate LLM spend → judge bucket
    for (const ep of episodes) {
      if (episodeBudget <= 0) {
        log(`reached --max-episodes budget; stopping judge phase.`);
        stopJudging = true;
        break;
      }
      const key: CacheKey = {
        episodeId: ep.episodeId,
        contentHash: ep.contentHash,
        // Debate-judged episodes use a distinct (content-addressed) cache namespace so they
        // never collide with single-judge results and re-judge when any lens/template changes.
        judgePromptHash: flags.judgeDebate ? debateHash : judgePromptHash,
        labelSchemaVersion: LABEL_SCHEMA_VERSION,
        model,
        cliVersion,
      };
      if (isJudged(db, key)) {
        skipped++;
        continue;
      }
      if (flags.maxCost !== undefined && spentUsd + COST_PER_JUDGE_USD > flags.maxCost) {
        log(`reached --max-cost ceiling ($${flags.maxCost}); stopping judge phase.`);
        stopJudging = true;
        break;
      }
      episodeBudget--;
      spentUsd += COST_PER_JUDGE_USD;
      try {
        const { text: rendered, nRedacted } = renderEpisodeRedacted(ep);
        redactedTotal += nRedacted;
        const adapter = flags.runner === "api" ? "api" : "claude";
        let label, meta;
        if (flags.judgeDebate) {
          // Multi-perspective adversarial ensemble + persisted round-by-round trail.
          const res = await judgeEpisodeDebate(rendered, ep.episodeId, {
            model,
            adapter,
            maxRounds: flags.judgeRounds,
          });
          label = res.label;
          meta = { ...res.meta, cli_version: cliVersion };
          upsertJudgeRounds(db, res.debate);
        } else {
          const res = await judgeEpisode(rendered, ep.episodeId, { model, adapter });
          label = res.label;
          meta = res.meta;
        }
        upsertLabel(db, label, meta);
        judged++;
        consecErrors = 0;
        process.stdout.write(`\r  judged ${judged} (skipped ${skipped}, errors ${judgeErrors})   `);
      } catch (e) {
        judgeErrors++;
        consecErrors++;
        log(`  ! judge failed for ${ep.episodeId}: ${(e as Error).message}`);
        if (consecErrors >= MAX_CONSEC_JUDGE_ERRORS) {
          log(
            `circuit breaker: ${consecErrors} consecutive judge failures — stopping judge ` +
              `phase (structure for remaining sessions still persists). Check the claude CLI.`
          );
          stopJudging = true;
          break;
        }
      }
    }
    if (!flags.noJudge) process.stdout.write("\n");
  }

  log(
    `done. sessions=${sessions.length} (errors=${sessionErrors}) episodes=${totalEpisodes} ` +
      `judged=${judged} cached/skipped=${skipped} judgeErrors=${judgeErrors} ` +
      `est_spend=$${spentUsd.toFixed(2)} redacted=${redactedTotal} item(s) at judge boundary`
  );
  if (flags.mine && !flags.noJudge) {
    log("running mine + report…");
    setLlmPhase("mine"); // cluster-labeling LLM spend → mine bucket
    await mine(db);
    await report(db);
    log("wrote out/report.md and out/candidates.json");
  }
  db.close();
}

main().catch((e) => {
  console.error("[pipeline] fatal:", e);
  process.exit(1);
});
