// skillshadow.ts — the shadow closed-loop (Gate 3, causal-ish).
//
// WHY THIS EXISTS
// The offline back-test (skilleval / Gate 2-B) can only measure "does the skill's guidance
// shift a model response on prompts we chose". It cannot tell you the thing leadership
// actually cares about: did putting this skill in front of people make the real work BETTER?
// Self-grading on hand-picked prompts is a proxy; the honest signal is the CLOSED LOOP —
// deploy the skill, let real tasks happen, re-mine the new logs, and compare outcomes.
//
// "Shadow" = observational, no live agent intervention required. We record WHEN a skill went
// live and the PRE-deploy baseline for its task family, then later snapshot the SAME family's
// POST-deploy outcomes from freshly-mined episodes and report the delta. It is a quasi-
// experiment (before/after on the same task_type), NOT a randomised trial — confounders
// (people getting better over time, task mix drifting) are real and we say so. But unlike the
// offline back-test it is immune to teaching-to-the-test: the post-deploy tasks are real,
// arrived AFTER the skill existed, and were not chosen by us.
//
// USAGE
//   bun run src/skills/skillshadow.ts --skill <name> --deploy [--task-type T] [--db p]
//       Mark the skill live NOW. Snapshots the pre-deploy baseline for its task family.
//   bun run src/skills/skillshadow.ts --skill <name> --report [--db p]
//       Re-mine has happened since deploy → compare post-deploy outcomes to the baseline.
//   bun run src/skills/skillshadow.ts --list [--db p]
//
// The skill's task family is the modal task_type of its source cluster (read from the skill's
// meta.json cluster_id), overridable with --task-type when the judge's labels are noisy.

import { readFileSync, existsSync } from "fs";
import { join, isAbsolute } from "path";
import { outDir } from "../core/paths.ts";
import {
  openDb,
  taskTypeStats,
  modalTaskType,
  getClusterMembers,
  getSkillDeployment,
  upsertSkillDeployment,
  upsertShadowObs,
} from "../db/db.ts";

const SKILLS_DIR = join(outDir, "skills");

interface Flags {
  skill?: string;
  deploy: boolean;
  report: boolean;
  list: boolean;
  taskType?: string;
  dbPath?: string;
}

function parseFlags(argv: string[]): Flags {
  const f: Flags = { deploy: false, report: false, list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--skill": f.skill = next(); break;
      case "--deploy": f.deploy = true; break;
      case "--report": f.report = true; break;
      case "--list": f.list = true; break;
      case "--task-type": f.taskType = next(); break;
      case "--db": f.dbPath = next(); break;
      default:
        if (a.startsWith("--")) console.warn(`[skillshadow] unknown flag ignored: ${a}`);
    }
  }
  return f;
}

function resolveSkillDir(skill: string): string {
  if (isAbsolute(skill) || skill.includes("/") || skill.includes("\\")) return skill;
  return join(SKILLS_DIR, skill);
}

// Resolve the task family a skill targets: explicit override > modal task_type of its
// source cluster (via meta.json cluster_id). Returns { taskType, clusterId } or null.
function resolveTaskFamily(
  db: ReturnType<typeof openDb>,
  dir: string,
  override?: string
): { taskType: string; clusterId: string | null } | null {
  let clusterId: string | null = null;
  const metaPath = join(dir, "meta.json");
  if (existsSync(metaPath)) {
    try {
      const meta = JSON.parse(readFileSync(metaPath, "utf8"));
      clusterId = typeof meta.cluster_id === "string" ? meta.cluster_id : null;
    } catch { /* ignore */ }
  }
  if (override) return { taskType: override, clusterId };
  if (!clusterId) return null;
  const members = getClusterMembers(db, clusterId);
  const taskType = modalTaskType(db, members);
  return taskType ? { taskType, clusterId } : null;
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const signed = (x: number, d = 0) => `${x >= 0 ? "+" : ""}${x.toFixed(d)}`;

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const db = openDb(flags.dbPath);

  if (flags.list) {
    const rows = db.query(`SELECT skill, task_type, deployed_at, pre_n, pre_success_rate FROM skill_deployments ORDER BY deployed_at`).all() as any[];
    if (!rows.length) { console.log("[skillshadow] no deployments recorded."); db.close(); return; }
    console.log("[skillshadow] deployments:");
    for (const r of rows) {
      console.log(`  ${r.skill} · task_type="${r.task_type}" · since ${r.deployed_at} · baseline ${r.pre_n} ep, ${pct(r.pre_success_rate)} success`);
    }
    db.close();
    return;
  }

  if (!flags.skill || (!flags.deploy && !flags.report)) {
    console.error("usage: skillshadow --skill <name> (--deploy | --report) [--task-type T] [--db p] | --list");
    process.exit(2);
  }

  const dir = resolveSkillDir(flags.skill);
  const skillName = flags.skill.split(/[\\/]/).pop() || flags.skill;

  // ── DEPLOY: mark live, snapshot the pre-deploy baseline for the task family. ──
  if (flags.deploy) {
    const fam = resolveTaskFamily(db, dir, flags.taskType);
    if (!fam) {
      console.error(
        `[skillshadow] cannot resolve a task_type for ${skillName} ` +
        `(no meta.json cluster_id with labelled episodes). Pass --task-type explicitly.`
      );
      db.close();
      process.exit(2);
    }
    const deployedAt = new Date().toISOString();
    const pre = taskTypeStats(db, fam.taskType, { before: deployedAt });
    upsertSkillDeployment(db, {
      skill: skillName,
      clusterId: fam.clusterId,
      taskType: fam.taskType,
      deployedAt,
      preN: pre.n,
      preSuccessRate: pre.successRate,
      preMedianFriction: pre.medianFriction,
      note: pre.n < 5 ? "thin baseline (<5 episodes) — treat the post-deploy delta as directional only" : "",
    });
    console.log(`[skillshadow] deployed ${skillName} at ${deployedAt}`);
    console.log(`  task family: "${fam.taskType}"  (cluster ${fam.clusterId ?? "?"})`);
    console.log(`  PRE-deploy baseline: ${pre.n} judged episode(s) · success ${pct(pre.successRate)} · median friction ${pre.medianFriction}`);
    if (pre.n < 5) console.log(`  ⚠ thin baseline — re-mine enough future tasks before trusting the delta.`);
    console.log(`  Next: keep mining future logs, then: skillshadow --skill ${skillName} --report`);
    db.close();
    return;
  }

  // ── REPORT: compare post-deploy outcomes of the SAME family to the baseline. ──
  const dep = getSkillDeployment(db, skillName);
  if (!dep) {
    console.error(`[skillshadow] ${skillName} is not deployed yet — run --deploy first.`);
    db.close();
    process.exit(2);
  }
  const post = taskTypeStats(db, dep.taskType, { after: dep.deployedAt });
  const dSucc = post.successRate - dep.preSuccessRate;
  const dFric = post.medianFriction - dep.preMedianFriction;
  const observedAt = new Date().toISOString();
  upsertShadowObs(db, {
    skill: skillName,
    observedAt,
    postN: post.n,
    postSuccessRate: post.successRate,
    postMedianFriction: post.medianFriction,
    deltaSuccessRate: dSucc,
    deltaMedianFriction: dFric,
  });

  console.log(`[skillshadow] ${skillName} — shadow closed-loop report`);
  console.log(`  task family: "${dep.taskType}" · deployed ${dep.deployedAt}`);
  console.log(`  PRE  (before deploy): ${dep.preN} ep · success ${pct(dep.preSuccessRate)} · median friction ${dep.preMedianFriction}`);
  console.log(`  POST (after deploy):  ${post.n} ep · success ${pct(post.successRate)} · median friction ${post.medianFriction}`);
  console.log(`  Δ success ${signed(dSucc * 100)}pp · Δ friction ${signed(dFric, 1)}`);
  if (post.n === 0) {
    console.log(`  ⚠ no post-deploy episodes of this task family yet — mine more future logs, then re-report.`);
  } else if (post.n < 5 || dep.preN < 5) {
    console.log(`  ⚠ small N (pre=${dep.preN}, post=${post.n}) — directional, not significant. This is a quasi-experiment (before/after), not an RCT: confounders apply.`);
  } else {
    console.log(`  (Quasi-experiment: real future tasks, immune to teaching-to-the-test, but before/after ≠ causal proof — confounders apply.)`);
  }
  db.close();
}

main();
