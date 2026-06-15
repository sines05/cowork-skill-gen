// judge.debate.ts — multi-perspective adversarial judge ENSEMBLE.
//
// Why this exists (leadership rec): a single LLM judge is not trustworthy enough for the
// stage where "wrong → everything downstream is thrown away". Instead:
//
//   wave 1: N PERSPECTIVES examine the log through different lenses
//           (productivity, accuracy, operating-cost)
//   rounds: a CRITIQUE pass refutes the wave-1 findings, then a REFUTE pass defends/revises
//           them — repeated up to maxRounds OR until the critiques CONVERGE (stabilize)
//   final:  a CONSOLIDATOR synthesizes the converged view + the dissent from every round
//           into the canonical JudgeLabel (validated by the SAME validator as judge.ts)
//
// Cost-aware + model-tiered: perspectives/critique/refute can run on a cheaper "wide" model;
// the consolidator uses the best model. All rounds are returned for persistence (audit trail).

import { runClaudeP, runApi, getModel, parseAndValidate } from "./judge.ts";
import { modelTier } from "./runner.ts";
import { sha256 } from "../core/util.ts";
import type {
  JudgeLabel,
  JudgeMeta,
  JudgePerspective,
  PerspectiveFinding,
  DebateRound,
  DebateResult,
} from "../core/types.ts";
import { LABEL_SCHEMA_VERSION, type Outcome } from "../core/types.ts";

type Adapter = "claude" | "api";

const OUTCOMES: Outcome[] = ["success", "partial", "failed", "abandoned", "qa_only"];

// The lenses. Each examines the SAME log but optimizes for a different objective, so a
// finding only survives if it holds up across perspectives + the adversarial rounds.
const PERSPECTIVES: { key: JudgePerspective; lens: string }[] = [
  {
    key: "productivity",
    lens:
      "TIME & THROUGHPUT. Did the user reach their goal efficiently? Weigh wasted turns, " +
      "retries, back-and-forth, idle gaps, abandoned mid-task. Fast+done is good; many " +
      "corrections to limp to an answer is friction.",
  },
  {
    key: "accuracy",
    lens:
      "CORRECTNESS. Did the work ACTUALLY achieve the stated goal with VERIFIED output " +
      "(tests passed, file produced, claim checked)? Be skeptical of unverified 'done' " +
      "claims and of plausible-but-unconfirmed results. Penalize silent partial completion.",
  },
  {
    key: "cost",
    lens:
      "OPERATING COST. Tool calls, tokens, rework, and abandoned effort relative to the " +
      "value delivered. A cheap clean result is good; heavy spend for a partial/abandoned " +
      "outcome is bad even if it 'eventually' worked.",
  },
];

// ── tolerant JSON extraction (object OR array) ────────────────────────────────
function firstJson(raw: string): any {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const oi = s.indexOf("{");
  const ai = s.indexOf("[");
  const start = oi === -1 ? ai : ai === -1 ? oi : Math.min(oi, ai);
  if (start === -1) throw new Error("no JSON found in response");
  const open = s[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return JSON.parse(s.slice(start, i + 1));
    }
  }
  throw new Error("unbalanced JSON in response");
}

function makeCaller(adapter: Adapter) {
  return (prompt: string, model: string) =>
    adapter === "api" ? runApi(prompt, { model }) : runClaudeP(prompt, { model });
}

// ── Wave 1: one perspective examines the episode ──────────────────────────────
async function runPerspective(
  call: (p: string, m: string) => Promise<string>,
  model: string,
  rendered: string,
  p: { key: JudgePerspective; lens: string }
): Promise<PerspectiveFinding> {
  const prompt =
    `You are judging ONE work episode through a SINGLE lens.\n\nLENS — ${p.key}: ${p.lens}\n\n` +
    `Read the episode and report what THIS lens sees. Be concrete and cite evidence from the log.\n\n` +
    `--- EPISODE ---\n${rendered}\n\n` +
    `Return ONLY this JSON:\n` +
    `{"outcome_view":"success|partial|failed|abandoned|qa_only","confidence":0.0,` +
    `"key_findings":["..."],"concerns":["..."]}`;
  const out = await call(prompt, model);
  const o = firstJson(out);
  const outcome_view: Outcome = OUTCOMES.includes(o?.outcome_view) ? o.outcome_view : "partial";
  const confidence =
    typeof o?.confidence === "number" && o.confidence >= 0 && o.confidence <= 1 ? o.confidence : 0.5;
  return {
    perspective: p.key,
    outcome_view,
    confidence,
    key_findings: Array.isArray(o?.key_findings) ? o.key_findings.map(String).slice(0, 12) : [],
    concerns: Array.isArray(o?.concerns) ? o.concerns.map(String).slice(0, 12) : [],
  };
}

// ── Critique: challenge the current findings ──────────────────────────────────
async function runCritique(
  call: (p: string, m: string) => Promise<string>,
  model: string,
  rendered: string,
  findings: PerspectiveFinding[]
): Promise<DebateRound["critiques"]> {
  const prompt =
    `You are an adversarial reviewer. Below are findings from multiple perspectives on one ` +
    `work episode. Challenge any finding that is unsupported by the log, over/under-states the ` +
    `outcome, conflates effort with success, or contradicts another perspective. Do NOT invent ` +
    `agreement — only raise REAL issues; if a finding is solid, skip it.\n\n` +
    `--- EPISODE ---\n${rendered}\n\n--- FINDINGS ---\n${JSON.stringify(findings)}\n\n` +
    `Return ONLY this JSON:\n` +
    `{"critiques":[{"target":"<short quote/ref of the claim>","issue":"<why it's wrong/weak>",` +
    `"severity":"strong|medium|weak"}]}`;
  const out = await call(prompt, model);
  const o = firstJson(out);
  const arr = Array.isArray(o?.critiques) ? o.critiques : [];
  return arr
    .filter((c: any) => c && typeof c.issue === "string")
    .map((c: any) => ({
      target: String(c.target ?? ""),
      issue: String(c.issue),
      severity: ["strong", "medium", "weak"].includes(c.severity) ? c.severity : "medium",
    }))
    .slice(0, 20);
}

// ── Refute: defend or revise each challenged claim ────────────────────────────
async function runRefute(
  call: (p: string, m: string) => Promise<string>,
  model: string,
  rendered: string,
  findings: PerspectiveFinding[],
  critiques: DebateRound["critiques"]
): Promise<DebateRound["refutations"]> {
  const prompt =
    `You defend or revise findings against an adversarial critique, using ONLY the log as ground ` +
    `truth. For each critique decide: "upheld" (original finding stands), "revised" (partially ` +
    `correct — state the corrected claim), or "withdrawn" (critique is right, drop the finding). ` +
    `Be honest; the goal is the truth, not winning.\n\n` +
    `--- EPISODE ---\n${rendered}\n\n--- FINDINGS ---\n${JSON.stringify(findings)}\n\n` +
    `--- CRITIQUES ---\n${JSON.stringify(critiques)}\n\n` +
    `Return ONLY this JSON:\n` +
    `{"refutations":[{"claim":"<the finding/critique at issue>","verdict":"upheld|revised|withdrawn",` +
    `"note":"<evidence-grounded reasoning>"}]}`;
  const out = await call(prompt, model);
  const o = firstJson(out);
  const arr = Array.isArray(o?.refutations) ? o.refutations : [];
  return arr
    .filter((r: any) => r && ["upheld", "revised", "withdrawn"].includes(r.verdict))
    .map((r: any) => ({
      claim: String(r.claim ?? ""),
      verdict: r.verdict,
      note: String(r.note ?? ""),
    }))
    .slice(0, 20);
}

// ── Consolidator: synthesize the canonical JudgeLabel ─────────────────────────
async function consolidate(
  call: (p: string, m: string) => Promise<string>,
  model: string,
  rendered: string,
  episodeId: string,
  perspectives: PerspectiveFinding[],
  rounds: DebateRound[]
): Promise<JudgeLabel> {
  const prompt =
    `You are the CONSOLIDATOR. Multiple perspectives judged one work episode, then debated ` +
    `adversarially. Synthesize the CONVERGED truth — favor claims that survived the critique/` +
    `refute rounds; down-weight withdrawn ones. Where perspectives disagree, resolve using the ` +
    `log as ground truth and reflect residual uncertainty in outcome_confidence.\n\n` +
    `--- EPISODE ---\n${rendered}\n\n` +
    `--- PERSPECTIVES ---\n${JSON.stringify(perspectives)}\n\n` +
    `--- DEBATE ROUNDS ---\n${JSON.stringify(rounds)}\n\n` +
    `EPISODE_ID: ${episodeId}\n\n` +
    `Return ONLY this JSON object (all fields required):\n` +
    `{"task_type":"<short>","task_difficulty":"trivial|moderate|hard",` +
    `"outcome":"success|partial|failed|abandoned|qa_only","outcome_confidence":0.0,` +
    `"workflow_pattern":["..."],"good_practices":["..."],` +
    `"friction_points":[{"what":"...","evidence":"..."}],"root_cause":"...",` +
    `"outcome_evidence":["..."],` +
    `"skill_opportunity":{"worth_codifying":true,"type":"skill|script|sop|none","rationale":"..."}}`;
  const out = await call(prompt, model);
  return parseAndValidate(out, episodeId); // same validation as the single-judge path
}

// ── Debate cache key ──────────────────────────────────────────────────────────
// The single-judge path keys its cache on sha256(judge.md). The debate path has no
// single prompt file — its "prompt" is the SET of lens texts + the critique/refute/
// consolidate templates + the round budget. Hashing a bare literal ("debate") meant
// editing any lens or template silently REUSED stale labels. We instead hash the actual
// material: the perspective lenses AND the source of every prompt-building function, so
// ANY wording change invalidates the cache (conservative — over-invalidates, never under).
// maxRounds is folded in via the same Math.max default the judge applies, so the pipeline
// (which builds the key before judging) and the judge agree on the hash.
export function debateCacheHash(maxRoundsOpt?: number): string {
  const maxRounds = Math.max(1, maxRoundsOpt ?? 2);
  const material = JSON.stringify({
    perspectives: PERSPECTIVES,
    maxRounds,
    schema: LABEL_SCHEMA_VERSION,
    // Function sources capture the exact prompt wording without a manual version bump.
    fns: [runPerspective, runCritique, runRefute, consolidate].map((f) => f.toString()),
  });
  return "debate:" + sha256(material).slice(0, 24);
}

// Stable signature of a round's material (non-weak) critiques — used to detect convergence.
function critiqueSignature(critiques: DebateRound["critiques"]): string {
  return critiques
    .filter((c) => c.severity !== "weak")
    .map((c) => `${c.severity}:${c.issue.toLowerCase().trim().slice(0, 80)}`)
    .sort()
    .join("|");
}

export interface DebateOpts {
  model?: string; // default model (consolidator falls back to this)
  perspectiveModel?: string; // cheaper "wide" model for perspectives/critique/refute
  consolidatorModel?: string; // best model for the final synthesis
  adapter?: Adapter;
  maxRounds?: number; // default 2
}

// Judge ONE episode via the debate ensemble. Returns the canonical label + meta + the
// full debate transcript (for persistence). Throws only if the consolidator can't produce
// a valid label after the debate.
export async function judgeEpisodeDebate(
  rendered: string,
  episodeId: string,
  opts?: DebateOpts
): Promise<{ label: JudgeLabel; meta: JudgeMeta; debate: DebateResult }> {
  // Model tiering: perspectives/critique/refute (wide fan-out) run cheap; the consolidator
  // (the call whose label is persisted + cache-keyed) runs on the best model.
  const wideModel = opts?.perspectiveModel || modelTier("cheap");
  const consModel = opts?.consolidatorModel || opts?.model || modelTier("best");
  const adapter: Adapter = opts?.adapter ?? "claude";
  const maxRounds = Math.max(1, opts?.maxRounds ?? 2);
  const call = makeCaller(adapter);

  // Wave 1 — perspectives in parallel.
  const perspectives = await Promise.all(
    PERSPECTIVES.map((p) => runPerspective(call, wideModel, rendered, p))
  );

  // Adversarial rounds — critique then refute, until the material critiques stabilize.
  const rounds: DebateRound[] = [];
  let prevSig = "";
  let converged = false;
  for (let r = 1; r <= maxRounds; r++) {
    const critiques = await runCritique(call, wideModel, rendered, perspectives);
    const sig = critiqueSignature(critiques);
    // Converged if there are no material critiques, or this round repeats the last one.
    if (sig === "" || sig === prevSig) {
      rounds.push({ round: r, critiques, refutations: [] });
      converged = true;
      break;
    }
    const refutations = await runRefute(call, wideModel, rendered, perspectives, critiques);
    rounds.push({ round: r, critiques, refutations });
    prevSig = sig;
    // If every material critique was withdrawn (i.e. findings held), we've converged.
    if (refutations.length > 0 && refutations.every((x) => x.verdict !== "revised")) {
      converged = true;
      break;
    }
  }

  const label = await consolidate(call, consModel, rendered, episodeId, perspectives, rounds);

  const meta: JudgeMeta = {
    model: consModel,
    // Content-addressed (not a bare "debate" literal) so editing any lens/template
    // invalidates the cache. Must match the pipeline's pre-judge key for the same maxRounds.
    judge_prompt_hash: debateCacheHash(opts?.maxRounds),
    label_schema_version: LABEL_SCHEMA_VERSION,
    cli_version: "", // stamped by the caller if needed
    judged_at: new Date().toISOString(),
  };

  const debate: DebateResult = {
    episode_id: episodeId,
    perspectives,
    rounds,
    converged,
    n_rounds: rounds.length,
    consolidator_model: consModel,
  };

  return { label, meta, debate };
}
