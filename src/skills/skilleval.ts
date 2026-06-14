// skilleval.ts — Gate 2-B back-test harness (SCAFFOLD).
//
// The skill-gen phase (skillgen.ts) does the cheap STATIC gate (2-A) and emits
// `evals/evals.json` per skill. This module is the EXPENSIVE behavioural gate (2-B):
// does the skill actually *change behaviour for the better*? It runs each eval case
// with-skill vs no-skill (a baseline) and grades the objectively-verifiable assertions
// with an LLM judge, then reports a per-skill pass rate and the with-vs-without delta.
//
// Honest limitations (by design — this is a scaffold to build on, see BRAINSTORM.md §5):
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

import { readFileSync, existsSync } from "fs";
import { join, isAbsolute } from "path";
import { runClaudeP, getModel } from "../llm/judge.ts";
import { configureRunner, describeRunner, type RunnerName } from "../llm/runner.ts";
import { redactText } from "../core/redact.ts";
import { outDir } from "../core/paths.ts";

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

interface EvalCase { name: string; prompt: string; assertions: string[]; }

function resolveSkillDir(skill: string): string {
  // accept a name (under out/skills) or an explicit path
  if (isAbsolute(skill) || skill.includes("/")) return skill;
  return join(SKILLS_DIR, skill);
}

function loadSkill(dir: string): { body: string; evals: EvalCase[]; name: string } {
  const md = readFileSync(join(dir, "SKILL.md"), "utf8");
  // strip frontmatter → body
  const body = md.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
  const name = (md.match(/^name:\s*(.+)$/m) || [])[1]?.trim() || "skill";
  const evalsPath = join(dir, "evals", "evals.json");
  let evals: EvalCase[] = [];
  if (existsSync(evalsPath)) {
    try {
      const j = JSON.parse(readFileSync(evalsPath, "utf8"));
      if (Array.isArray(j.test_cases)) evals = j.test_cases;
    } catch { /* ignore */ }
  }
  return { body, evals, name };
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
function baselinePrompt(taskPrompt: string): string {
  return `Task: ${taskPrompt}\n\nRespond with the plan you would follow and the concrete steps/commands.`;
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
  const model = getModel({ model: flags.model });
  const { body, evals, name } = loadSkill(dir);

  console.log(`[skilleval] skill: ${name} · ${evals.length} eval case(s) · runner: ${describeRunner()}`);
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
      console.log(`assertions (${c.assertions.length}):`);
      c.assertions.forEach((a, i) => console.log(`  ${i + 1}. ${a}`));
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
  let withPass = 0, basePass = 0, total = 0, doneCases = 0;
  for (const c of evals) {
    // Per-case isolation: one LLM timeout must not kill the whole back-test.
    try {
      const [withResp, baseResp] = await Promise.all([
        runClaudeP(withSkillPrompt(body, c.prompt), { model, timeoutMs: TM }),
        runClaudeP(baselinePrompt(c.prompt), { model, timeoutMs: TM }),
      ]);
      const [withGrades, baseGrades] = await Promise.all([
        gradeAssertions(c.prompt, withResp, c.assertions, model),
        gradeAssertions(c.prompt, baseResp, c.assertions, model),
      ]);
      const w = withGrades.filter(Boolean).length;
      const b = baseGrades.filter(Boolean).length;
      withPass += w; basePass += b; total += c.assertions.length; doneCases++;
      console.log(
        `  ${c.name}: with-skill ${w}/${c.assertions.length} · baseline ${b}/${c.assertions.length} ` +
        `· delta ${w - b >= 0 ? "+" : ""}${w - b}`
      );
    } catch (e) {
      console.log(`  ${c.name}: SKIPPED (${(e as Error).message.slice(0, 60)})`);
    }
  }
  if (doneCases === 0) { console.log("[skilleval] all cases failed (likely LLM timeouts)."); return; }
  const pct = (n: number) => (total ? ((n / total) * 100).toFixed(0) + "%" : "—");
  console.log(
    `\n[skilleval] ${name}: with-skill ${withPass}/${total} (${pct(withPass)}) vs ` +
    `baseline ${basePass}/${total} (${pct(basePass)}) — uplift ${withPass - basePass >= 0 ? "+" : ""}${withPass - basePass}.`
  );
  console.log(
    `(Proxy back-test: skill prepended, not installed; graded by LLM. The real signal is the ` +
    `canary closed loop — deploy, then re-mine future logs. Treat as a fast offline pre-check.)`
  );
}

main().catch((e) => {
  console.error("[skilleval] fatal:", e);
  process.exit(1);
});
