// skilleval.ts — Gate 2-B back-test harness (SCAFFOLD).
//
// The skill-gen phase (skillgen.ts) does the cheap STATIC gate (2-A) and emits
// `evals/evals.json` per skill. This module is the EXPENSIVE behavioural gate (2-B):
// does the skill actually *change behaviour for the better*? It runs each eval case
// with-skill vs no-skill (a baseline) and grades the objectively-verifiable assertions
// with an LLM judge, then reports a per-skill pass rate and the with-vs-without delta.
//
// Honest limitations (by design):
//  - "Skill active" is APPROXIMATED by prepending the SKILL.md body to the prompt. Real
//    activation goes through the agent's skills mechanism; a true back-test installs the
//    skill and runs the agent. The prepend is a faithful-enough proxy for measuring
//    whether the guidance shifts the response.
//  - The strongest back-test runs on FUTURE real tasks of the cluster (canary), not on
//    eval prompts derived from the same exemplars. Treat this harness as a fast offline
//    pre-check; the real signal is the closed loop (skill deployed → new logs → re-mine).
//  - Eval prompts can be agentic (they ask the model to build/inspect). Actually executing
//    them can have side effects, so this harness DRY-RUNS by default and only prompts the
//    model for a *plan + self-assessment*; pass --execute to let the model act (sandbox it).
//
// CLI:
//   bun run src/skilleval.ts --skill <name|path> [--dry|--execute] [--runner claude]
//                            [--ccs-profile p] [--model M] [--yes]
//   --dry (default): for $0-safe planning, prints the assembled with/without prompts and
//                    the assertions; makes NO LLM calls.
//   --execute:       runs with-skill vs no-skill + LLM assertion grading (costs money).

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join, isAbsolute } from "path";
import { runClaudeP, getModel } from "../llm/judge.ts";
import { configureRunner, describeRunner, setLlmPhase, type RunnerName } from "../llm/runner.ts";
import { redactText } from "../core/redact.ts";
import { outDir } from "../core/paths.ts";
import { openDb, upsertSkillTelemetry } from "../db/db.ts";
import type { DetCheck } from "./skillgen.draft.ts";

const SKILLS_DIR = join(outDir, "skills");

interface Flags {
  skill?: string;
  execute: boolean;
  yes: boolean;
  runner?: RunnerName;
  ccsProfile?: string;
  model?: string;
}

function parseFlags(argv: string[]): Flags {
  const f: Flags = { execute: false, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--skill": f.skill = next(); break;
      case "--execute": f.execute = true; break;
      case "--dry": f.execute = false; break;
      case "--yes": case "-y": f.yes = true; break;
      case "--model": f.model = next(); break;
      case "--runner": {
        const v = next();
        if (v !== "ccs" && v !== "claude") { console.error(`--runner must be ccs|claude`); process.exit(2); }
        f.runner = v; break;
      }
      case "--ccs-profile": f.ccsProfile = next(); break;
    }
  }
  return f;
}

interface EvalCase { name: string; prompt: string; expectations: string[]; checks: DetCheck[]; }

// ── Deterministic grader (the GOLDEN / no-LLM arm) ────────────────────────────
// Objective, $0 checks. This is the half of the back-test that does NOT depend on an LLM,
// so it stays valid even if the grader model drifts — and it's the part you can trust
// without a second model in the loop.
function gradeChecks(response: string, checks: DetCheck[]): boolean[] {
  return checks.map((c) => {
    try {
      switch (c.kind) {
        case "contains":
          return !!c.value && response.toLowerCase().includes(c.value.toLowerCase());
        case "regex":
          return !!c.value && new RegExp(c.value, "i").test(response);
        case "url_present":
          return /https?:\/\/\S+/i.test(response);
        case "code_block":
          return /```[\s\S]*?```|(^|\n)\s{4}\S/.test(response);
        case "min_length":
          return response.trim().length >= Number(c.value ?? 0);
        default:
          return false;
      }
    } catch {
      return false; // a bad regex value never throws the whole back-test
    }
  });
}

function resolveSkillDir(skill: string): string {
  // accept a name (under out/skills) or an explicit path
  if (isAbsolute(skill) || skill.includes("/")) return skill;
  return join(SKILLS_DIR, skill);
}

interface EvalProvenance {
  source?: string;
  n_held_out?: number;
  n_train?: number;
  note?: string;
}

function loadSkill(dir: string): {
  body: string;
  evals: EvalCase[];
  name: string;
  provenance: EvalProvenance | null;
} {
  const md = readFileSync(join(dir, "SKILL.md"), "utf8");
  // strip frontmatter → body
  const body = md.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
  const name = (md.match(/^name:\s*(.+)$/m) || [])[1]?.trim() || "skill";
  const evalsPath = join(dir, "evals", "evals.json");
  let evals: EvalCase[] = [];
  let provenance: EvalProvenance | null = null;
  if (existsSync(evalsPath)) {
    try {
      const j = JSON.parse(readFileSync(evalsPath, "utf8"));
      provenance = j.eval_provenance ?? null;
      // Canonical skill-creator schema uses `evals`; tolerate the older `test_cases`.
      const cases = Array.isArray(j.evals) ? j.evals : Array.isArray(j.test_cases) ? j.test_cases : [];
      evals = cases.map((c: any, i: number) => ({
        name: c.name ?? c.eval_name ?? `case-${i + 1}`,
        prompt: String(c.prompt ?? ""),
        // tolerate the spec field `expectations` or the colloquial `assertions`
        expectations: Array.isArray(c.expectations) ? c.expectations : Array.isArray(c.assertions) ? c.assertions : [],
        checks: Array.isArray(c.checks) ? c.checks : [],
      }));
    } catch { /* ignore */ }
  }
  return { body, evals, name, provenance };
}

// Prompt assembly. The "with-skill" arm prepends the skill body as guidance.
function withSkillPrompt(body: string, taskPrompt: string): string {
  return (
    `You have access to the following skill. Apply it where relevant.\n\n` +
    `<skill>\n${body}\n</skill>\n\n` +
    `Task: ${taskPrompt}\n\n` +
    `Respond with the plan you would follow and the concrete steps/commands, ` +
    `grounded in the skill where it applies.`
  );
}
// The baseline must be a FAIR control: same framing as the with-skill arm, only the skill
// block removed. Otherwise the "uplift" partly measures the extra framing, not the skill.
function baselinePrompt(taskPrompt: string): string {
  return (
    `You are a capable assistant. Apply your own best judgment.\n\n` +
    `Task: ${taskPrompt}\n\n` +
    `Respond with the plan you would follow and the concrete steps/commands.`
  );
}

// LLM judge: grade each assertion against a response. Returns booleans.
async function gradeAssertions(
  taskPrompt: string,
  response: string,
  assertions: string[],
  model: string
): Promise<boolean[]> {
  const rubric =
    `You are grading whether a candidate response to a task would satisfy each assertion. ` +
    `Be strict and literal. Return ONLY a JSON array of booleans, one per assertion, in order.\n\n` +
    `TASK: ${taskPrompt}\n\nRESPONSE:\n${response.slice(0, 6000)}\n\n` +
    `ASSERTIONS:\n${assertions.map((a, i) => `${i + 1}. ${a}`).join("\n")}\n\n` +
    `Return exactly ${assertions.length} booleans as a JSON array, e.g. [true,false,true].`;
  try {
    const out = await runClaudeP(rubric, { model, timeoutMs: 180_000 });
    const m = out.match(/\[[\s\S]*?\]/);
    const arr = JSON.parse(m ? m[0] : out);
    if (Array.isArray(arr)) return assertions.map((_, i) => arr[i] === true);
  } catch { /* fall through */ }
  return assertions.map(() => false);
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  if (!flags.skill) {
    console.error("usage: bun run src/skilleval.ts --skill <name|path> [--dry|--execute] [--yes]");
    process.exit(2);
  }
  const dir = resolveSkillDir(flags.skill);
  if (!existsSync(join(dir, "SKILL.md"))) {
    console.error(`[skilleval] no SKILL.md at ${dir}`);
    process.exit(2);
  }
  configureRunner({ runner: flags.runner, ccsProfile: flags.ccsProfile });
  setLlmPhase("skilleval"); // attribute all LLM spend in this process to the skilleval bucket
  const model = getModel({ model: flags.model });
  const { body, evals, name, provenance } = loadSkill(dir);

  const provLabel = provenance?.source === "held-out"
    ? `held-out (${provenance.n_held_out ?? "?"} unseen task(s)) — generalisation test`
    : provenance?.source === "in-distribution"
      ? `in-distribution (NOT a generalisation test — cluster too thin for a held-out split)`
      : "unknown (legacy skill without eval provenance)";
  console.log(`[skilleval] skill: ${name} · ${evals.length} eval case(s) · runner: ${describeRunner()}`);
  console.log(`[skilleval] eval set: ${provLabel}`);
  if (evals.length === 0) {
    console.log("[skilleval] no eval cases — nothing to back-test.");
    return;
  }

  // ── DRY (default, $0): print the plan + assembled prompts, make no LLM calls. ──
  if (!flags.execute) {
    console.log(
      `\n[DRY RUN — no LLM calls]. This shows what --execute would run: for each case, a\n` +
      `with-skill vs no-skill generation, then LLM grading of the assertions.\n`
    );
    for (const c of evals) {
      console.log(`\n=== case: ${c.name} ===`);
      console.log(`prompt: ${redactText(c.prompt).text}`);
      console.log(`expectations — LLM-graded (${c.expectations.length}):`);
      c.expectations.forEach((a, i) => console.log(`  ${i + 1}. ${a}`));
      console.log(`checks — golden/no-LLM (${c.checks.length}):`);
      c.checks.forEach((ch, i) => console.log(`  ${i + 1}. ${ch.kind}${ch.value ? ` "${ch.value}"` : ""}`));
    }
    console.log(
      `\nRun with --execute --yes to actually back-test (costs ~${evals.length * 3} LLM calls). ` +
      `NOTE: eval prompts can be agentic — run --execute in a sandbox.`
    );
    return;
  }

  // ── EXECUTE: real back-test (costs money). ──
  if (!flags.yes) {
    const ans = prompt(`[skilleval] run ${evals.length * 3} LLM calls for ${name}? [y/N] `);
    if (!ans || !/^y(es)?$/i.test(ans.trim())) { console.log("aborted."); return; }
  }

  const TM = 240_000; // heavy plan-generation prompts blow past the 120s default
  const createdAt = new Date().toISOString();
  const events: any[] = [];
  let withLlm = 0, baseLlm = 0, llmTotal = 0; // semantic (LLM-graded) arm
  let withDet = 0, baseDet = 0, detTotal = 0; // deterministic golden (no-LLM) arm
  let doneCases = 0;
  for (const c of evals) {
    // Per-case isolation: one LLM timeout must not kill the whole back-test.
    try {
      const [withResp, baseResp] = await Promise.all([
        runClaudeP(withSkillPrompt(body, c.prompt), { model, timeoutMs: TM }),
        runClaudeP(baselinePrompt(c.prompt), { model, timeoutMs: TM }),
      ]);
      // Arm 1 — LLM-graded semantic assertions (needs the grader model).
      const [withG, baseG] = await Promise.all([
        gradeAssertions(c.prompt, withResp, c.expectations, model),
        gradeAssertions(c.prompt, baseResp, c.expectations, model),
      ]);
      const wL = withG.filter(Boolean).length, bL = baseG.filter(Boolean).length;
      // Arm 2 — deterministic golden checks ($0, no LLM), same responses.
      const wD = gradeChecks(withResp, c.checks).filter(Boolean).length;
      const bD = gradeChecks(baseResp, c.checks).filter(Boolean).length;
      withLlm += wL; baseLlm += bL; llmTotal += c.expectations.length;
      withDet += wD; baseDet += bD; detTotal += c.checks.length;
      doneCases++;
      console.log(
        `  ${c.name}: LLM with ${wL}/${c.expectations.length} vs base ${bL} ` +
        `(Δ${wL - bL >= 0 ? "+" : ""}${wL - bL}) · golden with ${wD}/${c.checks.length} vs base ${bD} ` +
        `(Δ${wD - bD >= 0 ? "+" : ""}${wD - bD})`
      );
      events.push({
        skill: name, case: c.name, ts: createdAt,
        llm: { with: wL, base: bL, total: c.expectations.length },
        golden: { with: wD, base: bD, total: c.checks.length },
      });
    } catch (e) {
      console.log(`  ${c.name}: SKIPPED (${(e as Error).message.slice(0, 60)})`);
    }
  }
  if (doneCases === 0) { console.log("[skilleval] all cases failed (likely LLM timeouts)."); return; }

  const pct = (n: number, d: number) => (d ? ((n / d) * 100).toFixed(0) + "%" : "—");
  console.log(
    `\n[skilleval] ${name}:` +
    `\n  LLM-graded:     with ${withLlm}/${llmTotal} (${pct(withLlm, llmTotal)}) vs base ${baseLlm}/${llmTotal} (${pct(baseLlm, llmTotal)}) — uplift ${withLlm - baseLlm >= 0 ? "+" : ""}${withLlm - baseLlm}` +
    `\n  golden (no-LLM): with ${withDet}/${detTotal} (${pct(withDet, detTotal)}) vs base ${baseDet}/${detTotal} (${pct(baseDet, detTotal)}) — uplift ${withDet - baseDet >= 0 ? "+" : ""}${withDet - baseDet}`
  );

  // ── Telemetry: per-case JSONL + a DB row, so "does the skill help, and still work
  // over time" is queryable (BI), not just printed once. ──
  const telDir = join(outDir, "telemetry");
  mkdirSync(telDir, { recursive: true });
  const telFile = join(telDir, `skilleval-${name}-${createdAt.replace(/[:.]/g, "-")}.jsonl`);
  writeFileSync(telFile, events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  const db = openDb();
  upsertSkillTelemetry(db, {
    skill: name, runner: describeRunner(), model, mode: "execute",
    nCases: doneCases, withLlmPass: withLlm, baseLlmPass: baseLlm, llmTotal,
    withDetPass: withDet, baseDetPass: baseDet, detTotal, createdAt,
  });
  db.close();
  console.log(`[skilleval] telemetry → ${telFile} + skill_telemetry table.`);
  console.log(
    `(Proxy back-test: skill prepended, not installed. Golden arm is $0/no-LLM and stays valid ` +
    `even if the grader drifts; LLM arm is semantic. Real signal is the canary loop — deploy, re-mine.)`
  );
}

main().catch((e) => {
  console.error("[skilleval] fatal:", e);
  process.exit(1);
});
