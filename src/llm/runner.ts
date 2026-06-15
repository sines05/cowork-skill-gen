// LLM runner selection — how the headless `claude -p` calls are routed.
//
// Two runners. BOTH spawn the SAME real `claude` binary, so stdout stays a clean
// JSON envelope. (`ccs <profile> -p …` is NOT a drop-in for `claude` — it wraps the
// CLI in a delegation UI that prints a box to stdout and rejects `--output-format
// json`, which would break JSON.parse. So we route via the profile's env instead.)
//
//   "ccs"    → inject the profile's env into the claude subprocess. We read
//              `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` from `ccs env <profile>`
//              and merge them over process.env. Default profile: "my-api".
//   "claude" → plain claude with the ambient environment (the original behavior).
//
// configureRunner() is called once at pipeline startup; every Bun.spawn site
// (judge/classify/mine) merges runnerEnv() into its subprocess env. The default is
// "ccs" + "my-api" so an unconfigured caller still routes through the my-api profile.

// "ccs"/"claude" spawn the `claude` CLI; "api" calls the HTTP Messages API (Windows /
// headless, where the CLI is absent). For "api", runnerEnv() returns {} (the API adapter
// reads ANTHROPIC_* straight from the ambient environment / gateway).
export type RunnerName = "ccs" | "claude" | "api";

let _runner: RunnerName = "ccs";
let _ccsProfile = "my-api";

// ── LLM spend ledger ───────────────────────────────────────────────────────────
// Every real LLM call appends one line to out/telemetry/llm_calls.jsonl. The DB loader
// (src/db/llm_ledger.ts) folds it into the llm_calls table for the BI dashboard. We log
// to a file (not the DB) because the call sites — judge/skillgen/skilleval/classify/mine —
// run in separate processes without a shared DB handle; an append-only ledger is the
// process-independent meeting point. `at` is set here (normal Bun code may use Date).
import { appendFileSync, mkdirSync } from "fs";
import { join } from "path";
import { outDir } from "../core/paths.ts";

// Which pipeline phase is currently spending. Set once per process (or per sub-phase in
// the pipeline orchestrator) so each recorded call is attributed to the right bucket.
let _llmPhase = "other";
export function setLlmPhase(phase: string): void { _llmPhase = phase; }
export function getLlmPhase(): string { return _llmPhase; }

export interface LlmCallRecord {
  model: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_creation_tokens?: number;
  cost_usd?: number;
  duration_ms?: number;
  ok?: boolean;
}

let _ledgerPath: string | null = null;
function ledgerPath(): string {
  if (_ledgerPath === null) {
    const dir = join(outDir, "telemetry");
    try { mkdirSync(dir, { recursive: true }); } catch { /* exists */ }
    _ledgerPath = join(dir, "llm_calls.jsonl");
  }
  return _ledgerPath;
}

// Append one call to the ledger. Best-effort: a logging failure must never break the
// actual LLM work, so all errors are swallowed.
export function recordLlmCall(rec: LlmCallRecord): void {
  try {
    const line = JSON.stringify({
      at: new Date().toISOString(),
      phase: _llmPhase,
      runner: describeRunner(),
      model: rec.model,
      input_tokens: rec.input_tokens ?? 0,
      output_tokens: rec.output_tokens ?? 0,
      cache_read_tokens: rec.cache_read_tokens ?? 0,
      cache_creation_tokens: rec.cache_creation_tokens ?? 0,
      cost_usd: rec.cost_usd ?? 0,
      duration_ms: rec.duration_ms ?? 0,
      ok: rec.ok === false ? 0 : 1,
    });
    appendFileSync(ledgerPath(), line + "\n", "utf8");
  } catch { /* never let telemetry break the pipeline */ }
}

// Rough cost estimate for the API path: the Messages API returns token usage but NOT a
// dollar cost (only the `claude -p` envelope does). Per-Mtok USD, matched by substring so a
// version bump still resolves. Returns 0 for an unknown model rather than guessing wrong.
const PRICE_PER_MTOK: Array<[RegExp, number, number]> = [
  [/opus/i, 15, 75],
  [/sonnet/i, 3, 15],
  [/haiku/i, 1, 5],
];
export function estimateCostUsd(model: string, inTok: number, outTok: number): number {
  const row = PRICE_PER_MTOK.find(([re]) => re.test(model));
  if (!row) return 0;
  return (inTok / 1e6) * row[1] + (outTok / 1e6) * row[2];
}

// Pull cost/usage out of a `claude -p --output-format json` envelope (shape is stable:
// total_cost_usd + usage{input_tokens,output_tokens,cache_*}). Tolerates missing fields.
export function recordFromEnvelope(envelope: any, model: string): void {
  const u = envelope?.usage ?? {};
  recordLlmCall({
    model: envelope?.model || model,
    input_tokens: u.input_tokens,
    output_tokens: u.output_tokens,
    cache_read_tokens: u.cache_read_input_tokens,
    cache_creation_tokens: u.cache_creation_input_tokens,
    cost_usd: typeof envelope?.total_cost_usd === "number" ? envelope.total_cost_usd : 0,
    duration_ms: envelope?.duration_ms,
    ok: envelope?.is_error !== true,
  });
}
// Reflects what actually happened after runnerEnv() resolved (e.g. a ccs→claude
// fallback). Surfaced by describeRunner() so logs/errors don't claim "ccs:my-api"
// when we silently dropped to the ambient login.
let _effectiveRunner: string | null = null;

export function configureRunner(opts: { runner?: RunnerName; ccsProfile?: string }): void {
  if (opts.runner) _runner = opts.runner;
  if (opts.ccsProfile) _ccsProfile = opts.ccsProfile;
}

// Model tiering — pick the model by how much REASONING the step needs, not one-size-fits-all.
// Leadership rec: discovery/triage on a cheap model; heavy reasoning / review / consolidation
// on the best model; planned implementation on a mid model. Overridable per tier via env so
// an operator can retune without code changes.
export type ModelTier = "cheap" | "standard" | "best";
const TIER_DEFAULTS: Record<ModelTier, string> = {
  cheap: "claude-haiku-4-5-20251001", // discovery, clustering, batch classification
  standard: "claude-sonnet-4-6", // planned implementation
  best: "claude-opus-4-8", // judging, critique/consolidation, review
};
export function modelTier(tier: ModelTier): string {
  const env = process.env[`MINER_MODEL_${tier.toUpperCase()}`];
  return env && env.trim() ? env.trim() : TIER_DEFAULTS[tier];
}

// Resolve a CLI's real executable path before spawning. On Windows the `claude`/`ccs`
// entry points are `.cmd` shims and Bun.spawn(["claude", …]) does NOT resolve a bare name
// against PATHEXT — it fails with `ENOENT: uv_spawn 'claude'`. Bun.which() does the PATH +
// PATHEXT lookup (→ `…\claude.cmd`), which Bun.spawn then executes correctly. Memoized.
const _binCache = new Map<string, string>();
export function resolveBin(name: string): string {
  let p = _binCache.get(name);
  if (p === undefined) {
    p = Bun.which(name) ?? name; // fall back to the bare name (POSIX: resolves fine)
    _binCache.set(name, p);
  }
  return p;
}

export function getRunnerName(): RunnerName {
  return _runner;
}

// Short label for logs / error messages (e.g. "ccs:my-api" or "claude").
export function describeRunner(): string {
  if (_effectiveRunner) return _effectiveRunner;
  if (_runner === "api") return "api";
  return _runner === "ccs" ? `ccs:${_ccsProfile}` : "claude";
}

// Parse the `export KEY='VALUE'` lines emitted by `ccs env <profile>`.
function parseExports(out: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of out.split("\n")) {
    const m = line.match(/^\s*export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      v.length >= 2 &&
      ((v[0] === "'" && v.endsWith("'")) || (v[0] === '"' && v.endsWith('"')))
    ) {
      v = v.slice(1, -1);
    }
    env[m[1]] = v;
  }
  return env;
}

// Memoized: env overrides to merge into a `claude` spawn. {} for the plain runner.
// Resolved at most once per process (a Promise so concurrent callers share it).
let _envPromise: Promise<Record<string, string>> | null = null;
export function runnerEnv(): Promise<Record<string, string>> {
  if (_runner !== "ccs") return Promise.resolve({});
  if (_envPromise) return _envPromise;
  _envPromise = (async () => {
    // Fail SOFT: if ccs is missing or the profile doesn't exist, fall back to the
    // ambient `claude` login (env {}) with a loud warning, instead of throwing and
    // taking down the whole pipeline. The old code hard-required a specific profile
    // ("my-api"); on a machine without it, every LLM call died. Portability > purity.
    try {
      const proc = Bun.spawn([resolveBin("ccs"), "env", _ccsProfile], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const code = await proc.exited;
      if (code !== 0) {
        console.warn(
          `[runner] ccs env ${_ccsProfile} failed (exit ${code}): ${(err || out).slice(0, 160)}\n` +
            `[runner] falling back to plain 'claude' (ambient login). Pass --runner claude to silence, ` +
            `or --ccs-profile <name> for a valid profile.`
        );
        _effectiveRunner = "claude (fallback)";
        return {};
      }
      const env = parseExports(out);
      if (!env.ANTHROPIC_BASE_URL && !env.ANTHROPIC_AUTH_TOKEN && !env.ANTHROPIC_API_KEY) {
        console.warn(
          `[runner] ccs env ${_ccsProfile} returned no ANTHROPIC_* vars — falling back to plain 'claude'.`
        );
        _effectiveRunner = "claude (fallback)";
        return {};
      }
      return env;
    } catch (e) {
      console.warn(
        `[runner] could not run ccs (${(e as Error).message}); falling back to plain 'claude'.`
      );
      _effectiveRunner = "claude (fallback)";
      return {};
    }
  })();
  return _envPromise;
}
