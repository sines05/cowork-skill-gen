// skillgen.ts — Skill-generation phase (Cổng Go/Kill 2, draft side).
//
// Consumes the miner's output (clusters + ranked candidates + the judge's distilled
// per-episode evidence) and drafts a spec-compliant **Agent Skill** for each cluster
// the miner deemed worth codifying. Pipeline per cluster:
//
//   assemble evidence (DB) → redact → LLM draft (prompts/skillgen.md) → validate
//   → Gate 2-A static checks → write skill folder + evals + persist
//
// Output conforms to the official Agent Skills spec (agentskills.io/specification):
//   out/skills/<name>/
//     SKILL.md            (YAML frontmatter: name ≤64 [a-z0-9-], description ≤1024, …)
//     scripts/<file>      (optional, for the mechanical/hybrid part)
//     references/<file>   (optional, progressive-disclosure detail)
//     evals/evals.json    (2-3 test cases — handoff to the Gate 2-B back-test)
//     meta.json           (provenance: cluster, citations, gate result, confidence)
//
// Design choices (see BRAINSTORM.md §4-5,8): grounded LLM draft (not a hardcoded
// template, not free-form), pattern-level citation, redact-first, tiered gate (static
// here; back-test deferred to skilleval.ts), cost-gated + cache-keyed like the judge.
//
// CLI:
//   bun run src/skillgen.ts [--db p] [--out dir] [--limit N] [--no-llm] [--yes]
//                           [--runner ccs|claude] [--ccs-profile name] [--model M]
//   --no-llm  assembles + prints the evidence per cluster for $0 (inspect what the
//             LLM will see), writes nothing.

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { mine } from "../analysis/mine.ts";
import { runClaudeP, runApi, getModel } from "../llm/judge.ts";
import { sha256 } from "../core/util.ts";
import { configureRunner, describeRunner, type RunnerName } from "../llm/runner.ts";
import {
  openDb,
  upsertSkillDraft,
  isSkillDrafted,
  type SkillDraftRecord,
} from "../db/db.ts";
import { readFileSync } from "fs";
import { promptsDir, outDir } from "../core/paths.ts";
import { assembleEvidence, type Evidence } from "./skillgen.evidence.ts";
import {
  validateDraft,
  extractJsonObject,
  type Draft,
} from "./skillgen.draft.ts";
import { gate2A } from "./skillgen.gate.ts";
import { writeSkillFolder } from "./skillgen.write.ts";

const SKILLGEN_PROMPT_PATH = join(promptsDir, "skillgen.md");
const DEFAULT_OUT_DIR = join(outDir, "skills");
const COST_PER_DRAFT_USD = 0.3; // rough; only used for the confirmation gate
const CONFIRM_COST_THRESHOLD_USD = 3;

// ── Flags ───────────────────────────────────────────────────────────────────
interface Flags {
  dbPath?: string;
  outDir: string;
  limit?: number;
  minFrequency?: number;
  noLlm: boolean;
  yes: boolean;
  runner?: RunnerName;
  ccsProfile?: string;
  model?: string;
}

function parseFlags(argv: string[]): Flags {
  const f: Flags = { outDir: DEFAULT_OUT_DIR, noLlm: false, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--db": f.dbPath = next(); break;
      case "--out": f.outDir = next()!; break;
      case "--limit": f.limit = Number(next()); break;
      case "--min-frequency": f.minFrequency = Number(next()); break;
      case "--no-llm": f.noLlm = true; break;
      case "--yes": case "-y": f.yes = true; break;
      case "--model": f.model = next(); break;
      case "--runner": {
        const v = next();
        if (v !== "ccs" && v !== "claude") {
          console.error(`[skillgen] --runner must be ccs|claude (got ${v})`);
          process.exit(2);
        }
        f.runner = v;
        break;
      }
      case "--ccs-profile": f.ccsProfile = next(); break;
      default:
        if (a.startsWith("--")) console.warn(`[skillgen] unknown flag ignored: ${a}`);
    }
  }
  return f;
}

function log(m: string) {
  console.log(`[skillgen] ${m}`);
}

// ── LLM draft ────────────────────────────────────────────────────────────────
let _promptCache: string | null = null;
function readSkillgenPrompt(): string {
  if (_promptCache === null) _promptCache = readFileSync(SKILLGEN_PROMPT_PATH, "utf8");
  return _promptCache;
}

function buildPrompt(ev: Evidence): string {
  return (
    readSkillgenPrompt() +
    "\n\n--- CLUSTER EVIDENCE ---\n" +
    JSON.stringify(ev, null, 2) +
    "\n\nReturn ONLY the JSON object."
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const db = openDb(flags.dbPath);
  configureRunner({ runner: flags.runner, ccsProfile: flags.ccsProfile });
  const model = getModel({ model: flags.model });
  const promptHash = sha256(readSkillgenPrompt());

  log(`runner: ${describeRunner()} · model: ${model}`);
  log("mining clusters…");
  const { clusters, candidates } = await mine(db);
  const membersById = new Map(clusters.map((c) => [c.clusterId, c.memberEpisodeIds]));

  // Worth-codifying = the miner voted an intervention other than "none". With
  // --min-frequency N, OVERRIDE that gate and draft any cluster with ≥N episodes —
  // useful on a thin corpus to surface LEADS for human review (drafts are stamped with
  // gate status + confidence + a "review before use" footer, so this doesn't overclaim).
  let worth =
    flags.minFrequency !== undefined && Number.isFinite(flags.minFrequency)
      ? candidates.filter((c) => c.frequency >= flags.minFrequency!)
      : candidates.filter((c) => c.recommended_intervention !== "none");
  worth.sort((a, b) => b.frequency - a.frequency);
  if (flags.limit !== undefined && Number.isFinite(flags.limit)) {
    worth = worth.slice(0, flags.limit);
  }

  if (worth.length === 0) {
    const why =
      flags.minFrequency !== undefined
        ? `no cluster has ≥${flags.minFrequency} episodes.`
        : `no cluster is worth codifying yet (need recommended_intervention != none). ` +
          `Judge more episodes or pass --min-frequency N to draft leads.`;
    log(`${why} (Total clusters: ${candidates.length}.)`);
    db.close();
    return;
  }
  log(`${worth.length} cluster(s) worth codifying: ${worth.map((c) => c.label).join(", ")}`);

  // Cost gate (LLM path only).
  if (!flags.noLlm && !flags.yes) {
    const est = worth.length * COST_PER_DRAFT_USD;
    if (est > CONFIRM_COST_THRESHOLD_USD) {
      const ans = prompt(`[skillgen] draft ${worth.length} skills (~$${est.toFixed(0)})? [y/N] `);
      if (!ans || !/^y(es)?$/i.test(ans.trim())) { log("aborted at cost gate."); db.close(); return; }
    }
  }

  mkdirSync(flags.outDir, { recursive: true });
  const generatedAt = new Date().toISOString();
  const manifest: any[] = [];
  let drafted = 0, skipped = 0, rejected = 0, errors = 0;

  for (const cand of worth) {
    const members = membersById.get(cand.cluster_id) ?? [];
    const { evidence, redactedCount } = await assembleEvidence(db, cand, members);
    const evidenceHash = sha256(JSON.stringify(evidence));

    if (flags.noLlm) {
      console.log(`\n===== ${cand.label} (${cand.cluster_id}) =====`);
      console.log(JSON.stringify(evidence, null, 2));
      console.log(`[redacted ${redactedCount} item(s) from evidence]`);
      continue;
    }

    // Cache: skip clusters whose evidence+prompt+model are unchanged.
    if (isSkillDrafted(db, { clusterId: cand.cluster_id, evidenceHash, promptHash, model })) {
      skipped++;
      log(`· cached: ${cand.label}`);
      continue;
    }

    if (redactedCount > 0) log(`  redacted ${redactedCount} sensitive item(s) from ${cand.label} evidence`);

    let draft: Draft;
    try {
      // Windows/headless: --runner api uses the HTTP Messages API (no `claude` CLI).
      const callLlm = flags.runner === "api" ? runApi : runClaudeP;
      const raw = await callLlm(buildPrompt(evidence), { model });
      const jsonStr = extractJsonObject(raw);
      if (!jsonStr) throw new Error("no JSON object in model response");
      draft = validateDraft(JSON.parse(jsonStr), cand);
    } catch (e) {
      errors++;
      log(`  ! draft failed for ${cand.label}: ${(e as Error).message}`);
      continue;
    }

    const gate = gate2A(draft, evidence, members);

    let outPath = "";
    if (gate.status === "reject") {
      rejected++;
      outPath = writeSkillFolder(join(flags.outDir, "_rejected"), draft, evidence, gate, generatedAt);
      log(`  ✗ ${draft.name}: REJECT — ${gate.issues.filter((i) => i.startsWith("REJECT")).join("; ")}`);
    } else {
      drafted++;
      outPath = writeSkillFolder(flags.outDir, draft, evidence, gate, generatedAt);
      log(`  ✓ ${draft.name} [${draft.artifact_type}] gate=${gate.status}${gate.issues.length ? ` (${gate.issues.length} note)` : ""}`);
    }

    const rec: SkillDraftRecord = {
      clusterId: cand.cluster_id,
      name: draft.name,
      artifactType: draft.artifact_type,
      description: draft.description,
      compatibility: draft.compatibility,
      body: draft.skill_body_markdown,
      citations: draft.citations,
      evals: draft.evals,
      gateStatus: gate.status,
      gateIssues: gate.issues,
      confidence: draft.confidence,
      evidenceHash,
      promptHash,
      model,
      generatedAt,
      outPath,
    };
    try { upsertSkillDraft(db, rec); } catch (e) { log(`  (persist warn: ${(e as Error).message})`); }

    manifest.push({
      name: draft.name,
      cluster_id: cand.cluster_id,
      artifact_type: draft.artifact_type,
      gate_status: gate.status,
      issues: gate.issues,
      confidence: draft.confidence,
      path: outPath,
    });
  }

  if (!flags.noLlm) {
    writeFileSync(
      join(flags.outDir, "manifest.json"),
      JSON.stringify({ generated_at: generatedAt, model, skills: manifest }, null, 2),
      "utf8"
    );
    log(
      `done. drafted=${drafted} rejected=${rejected} cached=${skipped} errors=${errors} → ${flags.outDir}`
    );
  }
  db.close();
}

main().catch((e) => {
  console.error("[skillgen] fatal:", e);
  process.exit(1);
});
