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
// Reflects what actually happened after runnerEnv() resolved (e.g. a ccs→claude
// fallback). Surfaced by describeRunner() so logs/errors don't claim "ccs:my-api"
// when we silently dropped to the ambient login.
let _effectiveRunner: string | null = null;

export function configureRunner(opts: { runner?: RunnerName; ccsProfile?: string }): void {
  if (opts.runner) _runner = opts.runner;
  if (opts.ccsProfile) _ccsProfile = opts.ccsProfile;
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
      const proc = Bun.spawn(["ccs", "env", _ccsProfile], {
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
