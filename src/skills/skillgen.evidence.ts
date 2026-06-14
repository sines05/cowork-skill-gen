// skillgen.evidence.ts — Evidence assembly (DB → a compact, redacted evidence object).
//
// Pulls the cluster contrast + per-episode labels from the DB, aggregates good
// practices / root causes / exemplars, then redacts the whole object before it
// ever reaches the LLM (redact-first).

import { Database } from "bun:sqlite";
import { clusterContrast } from "../analysis/mine.ts";
import { redactDeep } from "../core/redact.ts";
import type { RankedCandidate } from "../core/types.ts";

// ── Evidence assembly (DB → a compact, redacted evidence object) ──────────────
export interface Evidence {
  cluster_id: string;
  label: string;
  recommended_intervention: string;
  dominant_pattern: string | null;
  has_stable_pattern: boolean;
  success_rate: number;
  n_judged: number;
  frequency: number;
  n_sessions: number;
  risk_flags: string[];
  success_patterns: [string, number][];
  fail_patterns: [string, number][];
  recurring_friction: [string, number][];
  good_practices: string[];
  root_causes: string[];
  exemplars: { episode_id: string; outcome: string | null; first_prompt: string }[];
}

export function safeArr(json: string | null | undefined): any[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export async function assembleEvidence(
  db: Database,
  cand: RankedCandidate,
  members: string[]
): Promise<{ evidence: Evidence; redactedCount: number }> {
  const contrast = await clusterContrast(db, members);

  // Per-episode label rows for the cluster.
  const placeholders = members.map(() => "?").join(",");
  const rows = members.length
    ? (db
        .query(
          `SELECT l.episode_id, l.outcome, l.good_practices_json, l.friction_points_json,
                  l.root_cause, e.first_prompt
           FROM episode_labels l JOIN episodes e ON e.episode_id = l.episode_id
           WHERE l.episode_id IN (${placeholders})`
        )
        .all(...members) as any[])
    : [];

  // Aggregate good practices (dedup, cap), root causes from non-success episodes.
  const gpCounts = new Map<string, number>();
  const rcSet: string[] = [];
  for (const r of rows) {
    for (const gp of safeArr(r.good_practices_json)) {
      if (typeof gp === "string" && gp.trim()) {
        const k = gp.trim();
        gpCounts.set(k, (gpCounts.get(k) ?? 0) + 1);
      }
    }
    if (r.outcome !== "success" && typeof r.root_cause === "string" && r.root_cause.trim()
        && r.root_cause.trim().toLowerCase() !== "none") {
      rcSet.push(r.root_cause.trim());
    }
  }
  const good_practices = [...gpCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([k]) => k);
  const root_causes = [...new Set(rcSet)].slice(0, 8);

  // Exemplars: a good (success, shortest prompt as a proxy for clean) + a bad.
  const good = rows
    .filter((r) => r.outcome === "success")
    .sort((a, b) => (a.first_prompt?.length ?? 0) - (b.first_prompt?.length ?? 0))[0];
  const bad = rows
    .filter((r) => r.outcome === "failed" || r.outcome === "partial" || r.outcome === "abandoned")
    .sort((a, b) => (b.first_prompt?.length ?? 0) - (a.first_prompt?.length ?? 0))[0];
  const exemplars = [good, bad]
    .filter(Boolean)
    .map((r) => ({
      episode_id: r.episode_id,
      outcome: r.outcome,
      first_prompt: (r.first_prompt ?? "").slice(0, 300),
    }));

  const evidenceRaw: Evidence = {
    cluster_id: cand.cluster_id,
    label: cand.label,
    recommended_intervention: cand.recommended_intervention,
    dominant_pattern: cand.dominant_pattern,
    has_stable_pattern: cand.has_stable_pattern,
    success_rate: cand.success_rate,
    n_judged: cand.n_judged ?? 0,
    frequency: cand.frequency,
    n_sessions: cand.n_sessions,
    risk_flags: cand.risk_flags,
    success_patterns: contrast.successPatterns.slice(0, 5),
    fail_patterns: contrast.failPatterns.slice(0, 5),
    recurring_friction: contrast.recurringFriction.slice(0, 8),
    good_practices,
    root_causes,
    exemplars,
  };

  // Redact-first: scrub secrets/PII/paths before the evidence ever reaches the LLM.
  const { value, nRedacted } = redactDeep(evidenceRaw);
  return { evidence: value as Evidence, redactedCount: nRedacted };
}
