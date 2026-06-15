// skillcheck.ts — quality gate over GENERATED skills (the "hook chốt chặn chất lượng").
//
// A deterministic, $0, no-LLM validator. It is the thing a Claude Code hook runs so a
// low-quality SKILL.md can't slip through: it checks structure, the when-to-use framing,
// the gate verdict, eval presence, PII leakage, and that no creation-history leaked into
// the body (a skill answers "how/when to use me", not "the history of how I was made").
//
// CLI:
//   bun run src/skills/skillcheck.ts                 # validate every out/skills/*/SKILL.md
//   bun run src/skills/skillcheck.ts <dir|SKILL.md>  # validate one skill (used by the hook)
// Exit code: 0 = all pass (warnings allowed), 1 = at least one FAIL (hook blocks on this).

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, basename, dirname } from "path";
import { redactText } from "../core/redact.ts";
import { outDir } from "../core/paths.ts";

interface Finding { level: "FAIL" | "WARN"; msg: string; }

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function frontmatter(md: string): string {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  return m ? m[1] : "";
}
function body(md: string): string {
  return md.replace(/^---\n[\s\S]*?\n---\n?/, "");
}
function fmValue(fm: string, key: string): string | null {
  const m = fm.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, "m"));
  if (!m) return null;
  return m[1].trim().replace(/^["']|["']$/g, "");
}

export function checkSkill(dir: string): { name: string; findings: Finding[] } {
  const findings: Finding[] = [];
  const mdPath = join(dir, "SKILL.md");
  if (!existsSync(mdPath)) return { name: basename(dir), findings: [{ level: "FAIL", msg: "no SKILL.md" }] };
  const md = readFileSync(mdPath, "utf8");
  const fm = frontmatter(md);
  const bd = body(md);
  const name = fmValue(fm, "name") || basename(dir);

  // structure
  if (!fm) findings.push({ level: "FAIL", msg: "missing YAML frontmatter" });
  if (!NAME_RE.test(name)) findings.push({ level: "FAIL", msg: `name not kebab-case: ${name}` });

  // description: present, bounded, and WHEN-oriented (it's the trigger)
  const desc = fmValue(fm, "description") || "";
  if (!desc) findings.push({ level: "FAIL", msg: "description missing" });
  else {
    if (desc.length > 1024) findings.push({ level: "FAIL", msg: `description >1024 chars (${desc.length})` });
    if (!/\bwhen\b|\btrigger|use (this )?(when|for)|keywords?:/i.test(desc))
      findings.push({ level: "WARN", msg: "description not clearly when-to-use (no trigger/when/keywords)" });
  }

  // gate verdict
  const gate = fmValue(fm, "gate_status");
  if (!gate) findings.push({ level: "WARN", msg: "no gate_status in metadata" });
  else if (gate === "reject") findings.push({ level: "FAIL", msg: "gate_status=reject" });

  // chaining (recommended, not required — isolated skills are valid)
  if (!/^\s*related_skills:/m.test(fm))
    findings.push({ level: "WARN", msg: "no related_skills (chaining recommended)" });

  // creation-history leak — a skill must NOT answer how it was made
  if (/auto-drafted|success rate|\d+\s*episode\(s\)|generated from \d+/i.test(bd))
    findings.push({ level: "FAIL", msg: "creation-history leaked into body (belongs in meta.json)" });

  // PII leak (deterministic redactor finds something it would have scrubbed)
  const pii = redactText(md).nRedacted;
  if (pii > 0) findings.push({ level: "FAIL", msg: `${pii} PII-like token(s) present` });

  // evals handoff
  const evalsPath = join(dir, "evals", "evals.json");
  if (!existsSync(evalsPath)) findings.push({ level: "WARN", msg: "no evals/evals.json (back-test handoff)" });
  else {
    try {
      const j = JSON.parse(readFileSync(evalsPath, "utf8"));
      if (!Array.isArray(j.test_cases) || j.test_cases.length === 0)
        findings.push({ level: "WARN", msg: "evals.json has no test_cases" });
    } catch {
      findings.push({ level: "FAIL", msg: "evals.json is not valid JSON" });
    }
  }

  return { name, findings };
}

// Resolve the target(s): a SKILL.md path, a skill dir, or default = all of out/skills.
function resolveTargets(arg?: string): string[] {
  if (arg) {
    const p = arg.endsWith("SKILL.md") ? dirname(arg) : arg;
    return [p];
  }
  const root = join(outDir, "skills");
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .map((n) => join(root, n))
    .filter((p) => { try { return statSync(p).isDirectory() && existsSync(join(p, "SKILL.md")); } catch { return false; } });
}

function main() {
  const targets = resolveTargets(process.argv[2]);
  if (targets.length === 0) {
    console.log("[skillcheck] no skills to check.");
    return;
  }
  let fails = 0, warns = 0;
  for (const dir of targets) {
    const { name, findings } = checkSkill(dir);
    const f = findings.filter((x) => x.level === "FAIL").length;
    const w = findings.filter((x) => x.level === "WARN").length;
    fails += f; warns += w;
    const status = f ? "✗ FAIL" : w ? "▲ warn" : "✓ pass";
    console.log(`${status}  ${name}`);
    for (const x of findings) console.log(`        ${x.level === "FAIL" ? "✗" : "▲"} ${x.msg}`);
  }
  console.log(`\n[skillcheck] ${targets.length} skill(s): ${fails} fail, ${warns} warn.`);
  if (fails > 0) process.exit(1); // non-zero so a hook blocks on real quality failures
}

if (import.meta.main) main();
