// skillgen.heldout.ts — train/held-out split + independent eval construction.
//
// WHY: the back-test (Gate 2-B) is only meaningful if the eval cases are tasks the
// skill was NOT built from. Previously evals were authored by the same LLM call that
// drafted the skill, from the same exemplars — "teaching-to-the-test": the skill passes
// because it is reproducing the very examples it learned from, which says nothing about
// whether it GENERALISES.
//
// The fix is a hold-out split. We partition a cluster's member episodes into:
//   • TRAIN    — the only episodes the skill-draft LLM sees (evidence/exemplars).
//   • HELD-OUT — kept hidden from drafting; their REAL task prompts become the eval cases.
//
// A skill that helps on held-out tasks (which it never saw) shows real generalisation;
// one that only passes train is overfit. The split is DETERMINISTIC (hash-ordered) so
// re-runs are reproducible and the cache key stays stable.

import { Database } from "bun:sqlite";
import { sha256 } from "../core/util.ts";
import { redactText } from "../core/redact.ts";
import { safeArr } from "./skillgen.evidence.ts";
import type { EvalCase } from "./skillgen.draft.ts";

// Fraction of a cluster reserved for held-out evaluation.
const HELDOUT_FRACTION = 0.3;
// At most this many held-out eval cases (keeps back-test cost bounded).
const MAX_HELDOUT_CASES = 5;

export interface MemberSplit {
  train: string[];
  heldOut: string[];
}

// Deterministic train/held-out partition of a cluster's member episode ids.
// Ordered by sha256(id) so the assignment is stable across runs (no RNG) yet not
// correlated with episode order. A cluster too small to spare an episode (n < 2)
// yields an empty held-out set — the caller then falls back to in-distribution evals
// and MUST flag the back-test as such (honest provenance).
export function splitMembers(members: string[]): MemberSplit {
  const sorted = [...new Set(members)].sort((a, b) =>
    sha256(a).localeCompare(sha256(b))
  );
  if (sorted.length < 2) return { train: sorted, heldOut: [] };
  const nHeld = Math.max(1, Math.floor(sorted.length * HELDOUT_FRACTION));
  const heldOut = sorted.slice(0, nHeld);
  const train = sorted.slice(nHeld);
  // Never starve training — if rounding took everything, give up on held-out.
  if (train.length === 0) return { train: sorted, heldOut: [] };
  return { train, heldOut };
}

// Build eval cases from HELD-OUT episodes: the case prompt is the episode's REAL first
// human turn (redacted), and the LLM-graded expectations are that episode's own observed
// good_practices (or the cluster fallback when an episode has none). These are independent
// of the drafted skill — the skill never saw these episodes — so passing them is evidence
// of transfer, not memorisation. Prefer successful held-out episodes (they define what a
// good outcome looks like); fall back to any held-out episode if no success exists.
export function buildHeldOutEvals(
  db: Database,
  heldOut: string[],
  fallbackExpectations: string[]
): EvalCase[] {
  if (heldOut.length === 0) return [];
  const ph = heldOut.map(() => "?").join(",");
  const rows = db
    .query(
      `SELECT l.episode_id, l.outcome, l.good_practices_json, e.first_prompt
       FROM episode_labels l JOIN episodes e ON e.episode_id = l.episode_id
       WHERE l.episode_id IN (${ph})`
    )
    .all(...heldOut) as any[];

  // Successful held-out episodes first (they anchor "what good looks like").
  const ordered = [
    ...rows.filter((r) => r.outcome === "success"),
    ...rows.filter((r) => r.outcome !== "success"),
  ];

  const cases: EvalCase[] = [];
  for (const r of ordered) {
    const prompt = redactText(String(r.first_prompt ?? "").trim()).text;
    if (!prompt) continue; // image-only / empty opener — can't form a task prompt
    const gp = safeArr(r.good_practices_json).filter(
      (x) => typeof x === "string" && x.trim()
    );
    const expectations = (gp.length ? gp : fallbackExpectations)
      .map((s) => String(s))
      .slice(0, 5);
    cases.push({
      name: `heldout-${String(r.episode_id).replace(/[^a-z0-9]+/gi, "-")}`,
      prompt,
      expected_output:
        "Plan reaches the held-out task's goal using the cluster's observed successful workflow.",
      expectations,
      // Deterministic golden arm: a substantive plan (not a one-liner). Generic ON PURPOSE
      // — golden checks must not encode the skill's own wording, or both arms tilt unfairly.
      checks: [{ kind: "min_length", value: "200" }],
    });
    if (cases.length >= MAX_HELDOUT_CASES) break;
  }
  return cases;
}

// Provenance recorded in meta.json so an operator KNOWS whether the back-test was honest
// (held-out) or fell back to in-distribution evals on a too-thin cluster.
export interface EvalProvenance {
  source: "held-out" | "in-distribution";
  n_train: number;
  n_held_out: number;
  held_out_episode_ids: string[];
  train_episode_ids: string[];
  note: string;
}
