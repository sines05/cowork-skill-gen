// start.ts — interactive launcher for the Cowork Skill Factory.
//
// Wraps the stage CLIs behind a menu so anyone can run the whole thing without memorising
// flags/env. Each action shells out with stdio INHERITED, so the underlying command's own
// interactive prompts (the cost gate, the calibration review) keep working as-is.
//
// Runner is auto-detected so the same launcher works on a dev box, a server, or inside
// Docker: ccs (if the `ccs` binary + a profile exist) → api (if ANTHROPIC_* env is set,
// e.g. in a container) → claude (ambient CLI login). Override with MINER_RUNNER.
//
// Usage:  bun run start            (or: bun start.ts)  ·  inside Docker:  docker run -it … start.ts

import { existsSync } from "fs";
import { join } from "path";
import { outDir } from "./src/core/paths.ts";

type Corpus = "cowork" | "claude-code";
let corpus: Corpus = (process.env.MINER_SOURCE as Corpus) || "cowork";

// DB location: MINER_DATA_DIR lets a container keep the SQLite files on a mounted volume
// (e.g. /data) instead of the ephemeral image filesystem. Defaults to the repo root.
const DATA_DIR = process.env.MINER_DATA_DIR?.trim() || ".";
const dbFor = (c: Corpus) =>
  join(DATA_DIR, c === "cowork" ? "cowork.db" : "analysis.db");

// ── runner auto-detection ─────────────────────────────────────────────────────
function detectRunner(): "ccs" | "api" | "claude" {
  const forced = process.env.MINER_RUNNER as "ccs" | "api" | "claude" | undefined;
  if (forced) return forced;
  if (Bun.which("ccs")) return "ccs"; // dev box / fleet machine with the gateway CLI
  if (process.env.ANTHROPIC_BASE_URL || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY)
    return "api"; // container / headless with gateway creds in the env
  return "claude"; // ambient `claude` login
}
const RUNNER = detectRunner();
const CCS_PROFILE = process.env.MINER_CCS_PROFILE || "son";

// Runner flags for the CLIs that accept them (pipeline / skillgen / skilleval).
function runnerFlags(): string[] {
  if (RUNNER === "ccs") return ["--runner", "ccs", "--ccs-profile", CCS_PROFILE];
  if (RUNNER === "api") return ["--runner", "api"];
  return ["--runner", "claude"];
}

function ask(q: string): string {
  return (prompt(q) ?? "").trim();
}

// Shell out, inheriting the terminal so the child's prompts/streaming work.
function run(args: string[], extraEnv: Record<string, string> = {}) {
  console.log(`\n▶ bun run ${args.join(" ")}\n`);
  const p = Bun.spawnSync(["bun", "run", ...args], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, MINER_SOURCE: corpus, MINER_DB: dbFor(corpus), ...extraEnv },
  });
  console.log(`\n— done (exit ${p.exitCode ?? "?"}) —`);
}

function listSkills(): string[] {
  const dir = join(outDir, "skills");
  if (!existsSync(dir)) return [];
  try {
    return [...new Bun.Glob("*/SKILL.md").scanSync(dir)]
      .map((p) => p.split(/[\\/]/)[0])
      .filter((n) => n && n !== "_rejected")
      .sort();
  } catch {
    return [];
  }
}

function pickSkill(): string | null {
  const skills = listSkills();
  if (skills.length === 0) {
    console.log("  (no skills in out/skills — run 'Generate skills' first.)");
    return null;
  }
  skills.forEach((s, i) => console.log(`   ${i + 1}) ${s}`));
  const a = ask("  skill # or name: ");
  const idx = Number(a);
  if (Number.isFinite(idx) && idx >= 1 && idx <= skills.length) return skills[idx - 1];
  return skills.includes(a) ? a : null;
}

function menu() {
  console.log(`
============ Cowork Skill Factory ============
 corpus : ${corpus}   (db=${dbFor(corpus)})
 runner : ${RUNNER}${RUNNER === "ccs" ? `:${CCS_PROFILE}` : ""}
----------------------------------------------
 1) Mine logs        → judge + cluster + report
 2) Generate skills  → out/skills/  (held-out)
 3) Validate skills  → skillcheck
 4) Back-test a skill→ skilleval (with vs without)
 5) Calibrate        → judge vs human (+ Wilson CI)
 6) Shadow loop      → deploy / report
 7) Dashboard        → Metabase (Docker)
 8) FULL pipeline    → mine → gen → check
 c) Toggle corpus      q) Quit
==============================================`);
}

async function main() {
  if (RUNNER === "claude") {
    console.log("[start] note: no ccs/API creds detected — using the ambient `claude` login (rate-limited under load).");
  }
  for (;;) {
    menu();
    const c = ask("> ").toLowerCase();
    if (c === "q" || c === "quit") break;
    else if (c === "c") corpus = corpus === "cowork" ? "claude-code" : "cowork";
    else if (c === "1") run(["pipeline", "--mine", "--yes", ...runnerFlags()]);
    else if (c === "2") run(["skillgen", "--yes", "--min-frequency", "1", ...runnerFlags()]);
    else if (c === "3") run(["skillcheck"]);
    else if (c === "4") {
      const s = pickSkill();
      if (s) {
        const mode = ask("  [d]ry ($0) or [e]xecute (costs LLM)? [d/e]: ").toLowerCase();
        const exec = mode === "e" || mode === "execute";
        run(["skilleval", "--skill", s, exec ? "--execute" : "--dry", ...(exec ? ["--yes"] : []), ...runnerFlags()]);
      }
    } else if (c === "5") run(["calibrate"]);
    else if (c === "6") {
      const s = pickSkill();
      if (s) {
        const m = ask("  [d]eploy (snapshot baseline) or [r]eport (before/after)? [d/r]: ").toLowerCase();
        run(["skillshadow", "--skill", s, m === "r" ? "--report" : "--deploy"]);
      }
    } else if (c === "7") {
      console.log("  Dashboard needs Docker. Running: views → bi:refresh → bi:up → bi:provision …");
      run(["views"]);
      run(["bi:refresh"]);
      run(["bi:up"]);
      run(["bi:provision"]);
      console.log("  → open http://localhost:3000");
    } else if (c === "8") {
      run(["pipeline", "--mine", "--yes", ...runnerFlags()]);
      run(["skillgen", "--yes", "--min-frequency", "1", ...runnerFlags()]);
      run(["skillcheck"]);
    } else if (c) {
      console.log("  ? unknown choice");
    }
  }
  console.log("bye.");
}

main();
