// skillgen.write.ts — Render SKILL.md and write the skill folder to disk.
//
// Builds spec-compliant YAML frontmatter + body (scrubbed once more on write,
// defense in depth) and lays out the folder: SKILL.md, scripts/, references/,
// evals/evals.json, meta.json.

import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { redactText } from "../core/redact.ts";
import type { Draft } from "./skillgen.draft.ts";
import type { Evidence } from "./skillgen.evidence.ts";
import type { GateResult } from "./skillgen.gate.ts";

// ── YAML frontmatter (safe single-line scalars) ──────────────────────────────
export function yamlScalar(s: string): string {
  // double-quote and escape; collapse newlines so the scalar stays single-line.
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ").trim() + '"';
}

export function buildSkillMd(draft: Draft, ev: Evidence, gate: GateResult, generatedAt: string): string {
  const fm: string[] = ["---"];
  fm.push(`name: ${draft.name}`);
  fm.push(`description: ${yamlScalar(draft.description)}`);
  if (draft.compatibility) fm.push(`compatibility: ${yamlScalar(draft.compatibility)}`);
  fm.push(`license: Proprietary`);
  fm.push(`metadata:`);
  fm.push(`  source: cowork-workflow-miner`);
  fm.push(`  cluster_id: ${yamlScalar(ev.cluster_id)}`);
  fm.push(`  artifact_type: ${draft.artifact_type}`);
  fm.push(`  confidence: ${yamlScalar(String(draft.confidence))}`);
  fm.push(`  gate_status: ${gate.status}`);
  fm.push(`  generated_at: ${yamlScalar(generatedAt)}`);
  fm.push(`  generated: "true"`);
  fm.push("---");

  // Body: scrub once more on write (defense in depth — Gate may have only warned).
  const body = redactText(draft.skill_body_markdown).text;

  const extra: string[] = [];
  if (draft.guardrails.length) {
    extra.push("", "## Guardrails", ...draft.guardrails.map((g) => `- ${g}`));
  }
  if (draft.anti_patterns.length) {
    extra.push("", "## Anti-patterns (observed failures to avoid)",
      ...draft.anti_patterns.map((a) => `- ${a}`));
  }
  if (draft.scripts.length) {
    extra.push("", "## Bundled scripts",
      ...draft.scripts.map((s) => `- \`scripts/${s.filename}\` (${s.language})`));
  }
  extra.push(
    "", "---",
    `_Auto-drafted by cowork-workflow-miner from ${ev.frequency} episode(s) across ` +
      `${ev.n_sessions} session(s); success rate ${(ev.success_rate * 100).toFixed(0)}%. ` +
      `Gate 2-A: ${gate.status}. Review before use._`
  );

  return fm.join("\n") + "\n\n" + body + "\n" + extra.join("\n") + "\n";
}

// ── Write the skill folder ───────────────────────────────────────────────────
export function writeSkillFolder(
  baseDir: string,
  draft: Draft,
  ev: Evidence,
  gate: GateResult,
  generatedAt: string
): string {
  const dir = join(baseDir, draft.name);
  // fresh each run for this skill (idempotent)
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  mkdirSync(dir, { recursive: true });

  writeFileSync(join(dir, "SKILL.md"), buildSkillMd(draft, ev, gate, generatedAt), "utf8");

  if (draft.scripts.length) {
    mkdirSync(join(dir, "scripts"), { recursive: true });
    for (const s of draft.scripts) {
      writeFileSync(join(dir, "scripts", s.filename), redactText(s.code).text, "utf8");
    }
  }
  if (draft.references.length) {
    mkdirSync(join(dir, "references"), { recursive: true });
    for (const r of draft.references) {
      writeFileSync(join(dir, "references", r.filename), redactText(r.markdown).text, "utf8");
    }
  }
  // evals/evals.json — handoff to the Gate 2-B back-test.
  mkdirSync(join(dir, "evals"), { recursive: true });
  writeFileSync(
    join(dir, "evals", "evals.json"),
    JSON.stringify({ skill: draft.name, test_cases: draft.evals }, null, 2),
    "utf8"
  );
  // meta.json — provenance + gate result.
  writeFileSync(
    join(dir, "meta.json"),
    JSON.stringify(
      {
        name: draft.name,
        cluster_id: ev.cluster_id,
        artifact_type: draft.artifact_type,
        confidence: draft.confidence,
        gate: gate,
        citations: draft.citations,
        evidence_summary: {
          frequency: ev.frequency,
          n_sessions: ev.n_sessions,
          success_rate: ev.success_rate,
          dominant_pattern: ev.dominant_pattern,
          recommended_intervention: ev.recommended_intervention,
        },
        generated_at: generatedAt,
      },
      null,
      2
    ),
    "utf8"
  );
  return dir;
}
