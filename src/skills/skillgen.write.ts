// skillgen.write.ts — Render SKILL.md and write the skill folder to disk.
//
// Builds spec-compliant YAML frontmatter + body (scrubbed once more on write,
// defense in depth) and lays out the folder: SKILL.md, scripts/, references/,
// assets/, evals/evals.json, meta.json.

import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { redactText } from "../core/redact.ts";
import type { Draft, EvalCase } from "./skillgen.draft.ts";
import type { Evidence } from "./skillgen.evidence.ts";
import type { GateResult } from "./skillgen.gate.ts";
import type { EvalProvenance } from "./skillgen.heldout.ts";

// Bundled license, referenced by the SKILL.md `license` frontmatter (mirrors how Anthropic's
// own skills ship a LICENSE.txt). Adjust the holder/terms to your org's policy.
const LICENSE_TEXT = `Proprietary — internal use only.

This skill was auto-drafted by the Cowork Skill Factory from mined session evidence and
is intended for internal review and use. Do not redistribute without authorization.
All rights reserved.
`;

// ── YAML frontmatter (safe single-line scalars) ──────────────────────────────
export function yamlScalar(s: string): string {
  // double-quote and escape; collapse newlines so the scalar stays single-line.
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ").trim() + '"';
}

export function buildSkillMd(draft: Draft): string {
  // Frontmatter follows skill-creator's CANONICAL minimal form: just `name` + `description`
  // (+ `compatibility` only when there are real tool/OS requirements). All provenance, gate
  // status, confidence and chaining live in meta.json — never in the skill an agent reads.
  const fm: string[] = ["---", `name: ${draft.name}`, `description: ${yamlScalar(draft.description)}`];
  fm.push(`license: Proprietary. LICENSE.txt has complete terms`);
  if (draft.compatibility) fm.push(`compatibility: ${yamlScalar(draft.compatibility)}`);
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
      ...draft.scripts.map((s) => `- \`scripts/${s.filename}\` (${s.language}) — deterministic; prefer running this over re-deriving the steps by hand.`));
  }
  if (draft.references.length) {
    extra.push("", "## References",
      ...draft.references.map((r) => `- \`references/${r.filename}\` — load on demand for this capability's detail.`));
  }
  if (draft.assets.length) {
    extra.push("", "## Assets",
      ...draft.assets.map((a) => `- \`assets/${a.filename}\` — template/resource to apply when producing the output.`));
  }
  // Skill chaining (human-visible mirror of the frontmatter): one network so the skill
  // knows what to reach for when it hits the edge of its own competence.
  if (draft.related_skills.length) {
    extra.push("", "## Related skills",
      ...draft.related_skills.map((r) => `- **${r.name}** (${r.relation})${r.why ? ` — ${r.why}` : ""}`));
  }
  // NOTE: deliberately NO "auto-drafted from N episodes / success rate" footer here.
  // A skill answers "when/how to use me", not "the history/stats of how I was created" —
  // that provenance lives in meta.json, not in the skill an agent reads at runtime.

  return fm.join("\n") + "\n\n" + body + "\n" + extra.join("\n") + "\n";
}

// A skill is "isolated" when it has no `depends_on` prerequisite — it can run standalone.
// Leadership rec: isolated skills can execute in a dedicated context with a chosen model
// tier. We DON'T duplicate SKILL.md into an agent.md to express this (that file is just the
// body restated, and it sits in the wrong place for Claude Code to discover it as a real
// sub-agent — those live in .claude/agents/). The intent is recorded as metadata in
// meta.json instead; an orchestrator reads it to decide isolation + model.
export function isIsolated(draft: Draft): boolean {
  return !draft.related_skills.some((r) => r.relation === "depends_on");
}

// ── Write the skill folder ───────────────────────────────────────────────────
export function writeSkillFolder(
  baseDir: string,
  draft: Draft,
  ev: Evidence,
  gate: GateResult,
  generatedAt: string,
  evalOpts?: { evals?: EvalCase[]; provenance?: EvalProvenance }
): string {
  // The back-test cases written to disk: prefer the independent HELD-OUT evals (tasks the
  // skill never saw) over the LLM's self-authored in-distribution evals. Provenance is
  // recorded in meta.json so the eval source is auditable, never assumed.
  const evalsToWrite =
    evalOpts?.evals && evalOpts.evals.length ? evalOpts.evals : draft.evals;
  const dir = join(baseDir, draft.name);
  // fresh each run for this skill (idempotent)
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  mkdirSync(dir, { recursive: true });

  writeFileSync(join(dir, "SKILL.md"), buildSkillMd(draft), "utf8");
  // LICENSE.txt — referenced by the `license` frontmatter, matching Anthropic's own skills.
  writeFileSync(join(dir, "LICENSE.txt"), LICENSE_TEXT, "utf8");

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
  if (draft.assets.length) {
    mkdirSync(join(dir, "assets"), { recursive: true });
    for (const a of draft.assets) {
      writeFileSync(join(dir, "assets", a.filename), redactText(a.content).text, "utf8");
    }
  }
  // evals/evals.json — skill-creator's canonical schema ({skill_name, evals:[{id, prompt,
  // expected_output, expectations, files}]}) + our deterministic `checks` extension.
  mkdirSync(join(dir, "evals"), { recursive: true });
  writeFileSync(
    join(dir, "evals", "evals.json"),
    JSON.stringify(
      {
        skill_name: draft.name,
        // Provenance of the back-test set (held-out vs in-distribution) travels WITH the
        // cases so skilleval and any reviewer can see whether the uplift number is honest.
        eval_provenance: evalOpts?.provenance ?? {
          source: "in-distribution",
          note: "LLM-authored evals (no held-out split was available).",
        },
        evals: evalsToWrite.map((e, i) => ({
          id: i + 1,
          prompt: e.prompt,
          expected_output: e.expected_output,
          expectations: e.expectations,
          files: [],
          checks: e.checks,
        })),
      },
      null,
      2
    ),
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
        // Execution hint (replaces the old duplicated agent.md): an orchestrator reads this
        // to decide whether to run the skill in its own context and at which model tier.
        // Isolated = no depends_on prerequisite; chained skills need orchestration instead.
        execution: { isolated: isIsolated(draft), recommended_model: "sonnet" },
        related_skills: draft.related_skills,
        citations: draft.citations,
        // How the Gate 2-B back-test set was built: held-out (tasks the skill never saw —
        // a real generalisation test) or in-distribution fallback. The skill was drafted
        // ONLY from provenance.train_episode_ids; evals come from held_out_episode_ids.
        eval_provenance: evalOpts?.provenance ?? null,
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
