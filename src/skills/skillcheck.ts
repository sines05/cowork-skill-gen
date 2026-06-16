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
import { skillsOutDir } from "../core/paths.ts";

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

  // structure + Agent Skills spec name rules (agentskills.io/specification)
  if (!fm) findings.push({ level: "FAIL", msg: "missing YAML frontmatter" });
  if (!NAME_RE.test(name) || name.length > 64)
    findings.push({ level: "FAIL", msg: `name invalid (≤64, [a-z0-9-], no leading/trailing/double hyphen): ${name}` });
  if (name !== basename(dir))
    findings.push({ level: "FAIL", msg: `name "${name}" must match parent directory "${basename(dir)}"` });

  // description: required, ≤1024, and WHEN-oriented (it's the trigger)
  const desc = fmValue(fm, "description") || "";
  if (!desc) findings.push({ level: "FAIL", msg: "description missing" });
  else {
    if (desc.length > 1024) findings.push({ level: "FAIL", msg: `description >1024 chars (${desc.length})` });
    if (!/\bwhen\b|\btrigger|use (this )?(when|for)|keywords?:/i.test(desc))
      findings.push({ level: "WARN", msg: "description not clearly when-to-use (no trigger/when/keywords)" });
  }

  // compatibility: optional, but spec-bounded to ≤500 chars when present
  const compat = fmValue(fm, "compatibility");
  if (compat && compat.length > 500)
    findings.push({ level: "FAIL", msg: `compatibility >500 chars (${compat.length})` });

  // license frontmatter referencing a file → that file must exist
  const lic = fmValue(fm, "license") || "";
  if (/LICENSE/i.test(lic) && !existsSync(join(dir, "LICENSE.txt")))
    findings.push({ level: "WARN", msg: "license references LICENSE.txt but the file is missing" });

  // dangling bundled-file references — a backticked `scripts|references|assets/<file>`
  // pointer in the body must resolve to a real file (spec: refs are relative to skill root,
  // one level deep). A pointer to a missing file sends the agent to a dead end.
  const refRe = /`(scripts|references|assets)\/([A-Za-z0-9._-]+)`/g;
  for (const m of bd.matchAll(refRe)) {
    const rel = `${m[1]}/${m[2]}`;
    if (!existsSync(join(dir, rel)))
      findings.push({ level: "FAIL", msg: `body references missing bundled file: ${rel}` });
  }

  // creation-history leak — a skill must NOT answer how it was made (belongs in meta.json)
  if (/auto-drafted|success rate|\d+\s*episode\(s\)|generated from \d+/i.test(bd))
    findings.push({ level: "FAIL", msg: "creation-history leaked into body (belongs in meta.json)" });

  // PII leak (deterministic redactor finds something it would have scrubbed)
  const pii = redactText(md).nRedacted;
  if (pii > 0) findings.push({ level: "FAIL", msg: `${pii} PII-like token(s) present` });

  // meta.json — our provenance sidecar: gate verdict + chaining live here, not in frontmatter
  const metaPath = join(dir, "meta.json");
  let meta: any = null;
  if (existsSync(metaPath)) { try { meta = JSON.parse(readFileSync(metaPath, "utf8")); } catch { /* below */ } }
  if (!meta) findings.push({ level: "WARN", msg: "no/invalid meta.json (provenance sidecar)" });
  else {
    if (meta.gate?.status === "reject") findings.push({ level: "FAIL", msg: "meta.json gate=reject" });
    if (!Array.isArray(meta.related_skills) || meta.related_skills.length === 0)
      findings.push({ level: "WARN", msg: "no related_skills (chaining recommended)" });
  }

  // evals handoff — skill-creator schema (`evals`), tolerate older `test_cases`
  const evalsPath = join(dir, "evals", "evals.json");
  if (!existsSync(evalsPath)) findings.push({ level: "WARN", msg: "no evals/evals.json (back-test handoff)" });
  else {
    try {
      const j = JSON.parse(readFileSync(evalsPath, "utf8"));
      const cases = Array.isArray(j.evals) ? j.evals : j.test_cases;
      if (!Array.isArray(cases) || cases.length === 0)
        findings.push({ level: "WARN", msg: "evals.json has no eval cases" });
    } catch {
      findings.push({ level: "FAIL", msg: "evals.json is not valid JSON" });
    }
  }

  return { name, findings };
}

// Resolve the target(s): a SKILL.md path, a skill dir, or default = all skills in skillsOutDir
// (out/skills, or MINER_SKILLS_OUT — kept in sync with skillgen so `all` checks what it wrote).
function resolveTargets(arg?: string): string[] {
  if (arg) {
    const p = arg.endsWith("SKILL.md") ? dirname(arg) : arg;
    return [p];
  }
  const root = skillsOutDir;
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
