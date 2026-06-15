// SQLite persistence layer (bun:sqlite). Open + migrate + idempotent upserts + judge cache check.
// All modules persist through these functions — do not write raw SQL elsewhere.
import { Database } from "bun:sqlite";
import { readFileSync } from "fs";
import type {
  SessionInfo,
  ClassifiedTurn,
  Episode,
  JudgeLabel,
  JudgeMeta,
  CalibrationRow,
  TaskCluster,
  DebateResult,
} from "../core/types.ts";
import { defaultDbPath } from "../core/paths.ts";
import { median } from "../core/util.ts";

export const DEFAULT_DB_PATH = defaultDbPath;

export function openDb(path: string = DEFAULT_DB_PATH): Database {
  const db = new Database(path, { create: true });
  db.exec("PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

export function migrate(db: Database): void {
  const ddl = readFileSync(`${import.meta.dir}/schema.sql`, "utf8");
  db.exec(ddl);
}

// ── Sessions ──────────────────────────────────────────────────────────────────
export function upsertSession(db: Database, s: SessionInfo, nEpisodes: number): void {
  db.query(
    `INSERT INTO sessions (session_id, project, path, started_at, completed_at, n_episodes)
     VALUES ($id, $project, $path, $start, $end, $n)
     ON CONFLICT(session_id) DO UPDATE SET
       project=excluded.project, path=excluded.path, started_at=excluded.started_at,
       completed_at=excluded.completed_at, n_episodes=excluded.n_episodes`
  ).run({
    $id: s.sessionId,
    $project: s.project,
    $path: s.jsonlPath,
    $start: s.startedAt,
    $end: s.completedAt,
    $n: nEpisodes,
  });
}

// ── Turns ─────────────────────────────────────────────────────────────────────
export function upsertTurn(db: Database, t: ClassifiedTurn): void {
  db.query(
    `INSERT INTO turns (turn_id, session_id, idx, role, char_len, n_images, ts, episode_id, classified_by, text_preview)
     VALUES ($id, $session, $idx, $role, $clen, $nimg, $ts, $ep, $by, $prev)
     ON CONFLICT(turn_id) DO UPDATE SET
       role=excluded.role, char_len=excluded.char_len, n_images=excluded.n_images,
       ts=excluded.ts, episode_id=excluded.episode_id, classified_by=excluded.classified_by,
       text_preview=excluded.text_preview`
  ).run({
    $id: `${t.sessionId}#t${t.idx}`,
    $session: t.sessionId,
    $idx: t.idx,
    $role: t.role,
    $clen: t.charLen,
    $nimg: t.nImages,
    $ts: t.ts,
    $ep: t.episodeId ?? null,
    $by: t.classifiedBy,
    $prev: t.text.slice(0, 200),
  });
}

// ── Episodes (+ features + evidence) ──────────────────────────────────────────
export function upsertEpisode(db: Database, e: Episode): void {
  db.query(
    `INSERT INTO episodes (episode_id, session_id, idx, task_key, start_turn, n_turns,
       n_corrections, n_interruptions, n_approvals, n_images, used_subagents,
       subagent_summary, first_prompt, started_at, ended_at, content_hash)
     VALUES ($id,$session,$idx,$tk,$start,$nturns,$ncorr,$nint,$napp,$nimg,$sub,
       $subsum,$fp,$sa,$ea,$ch)
     ON CONFLICT(episode_id) DO UPDATE SET
       idx=excluded.idx, task_key=excluded.task_key, start_turn=excluded.start_turn,
       n_turns=excluded.n_turns, n_corrections=excluded.n_corrections,
       n_interruptions=excluded.n_interruptions, n_approvals=excluded.n_approvals,
       n_images=excluded.n_images, used_subagents=excluded.used_subagents,
       subagent_summary=excluded.subagent_summary, first_prompt=excluded.first_prompt,
       started_at=excluded.started_at, ended_at=excluded.ended_at, content_hash=excluded.content_hash`
  ).run({
    $id: e.episodeId,
    $session: e.sessionId,
    $idx: e.idx,
    $tk: e.taskKey ?? null,
    $start: e.startTurnIdx,
    $nturns: e.nTurns,
    $ncorr: e.nCorrections,
    $nint: e.nInterruptions,
    $napp: e.nApprovals,
    $nimg: e.nImages,
    $sub: e.usedSubagents ? 1 : 0,
    $subsum: JSON.stringify(e.subagentSummaries ?? []),
    $fp: e.firstPrompt,
    $sa: e.startedAt,
    $ea: e.endedAt,
    $ch: e.contentHash,
  });

  // features
  const f = e.features;
  if (f) {
    db.query(
      `INSERT INTO episode_features (episode_id, n_tool_calls, tool_sequence, n_files_read,
         n_files_edited, n_test_runs, duration_s, idle_s, tokens)
       VALUES ($id,$ntc,$seq,$nr,$ne,$nt,$dur,$idle,$tok)
       ON CONFLICT(episode_id) DO UPDATE SET
         n_tool_calls=excluded.n_tool_calls, tool_sequence=excluded.tool_sequence,
         n_files_read=excluded.n_files_read, n_files_edited=excluded.n_files_edited,
         n_test_runs=excluded.n_test_runs, duration_s=excluded.duration_s,
         idle_s=excluded.idle_s, tokens=excluded.tokens`
    ).run({
      $id: e.episodeId,
      $ntc: f.nToolCalls,
      $seq: f.toolSequence,
      $nr: f.nFilesRead,
      $ne: f.nFilesEdited,
      $nt: f.nTestRuns,
      $dur: f.durationS,
      $idle: f.idleS,
      $tok: f.tokens,
    });
  }

  // evidence — replace-all for this episode (idempotent re-runs)
  db.query(`DELETE FROM episode_evidence WHERE episode_id = ?`).run(e.episodeId);
  const ins = db.query(
    `INSERT INTO episode_evidence (episode_id, signal, direction, weight, value, reason)
     VALUES ($id,$sig,$dir,$w,$val,$reason)`
  );
  for (const sig of e.signals ?? []) {
    ins.run({
      $id: e.episodeId,
      $sig: sig.signal,
      $dir: sig.direction,
      $w: sig.weight,
      $val: sig.value === null ? null : String(sig.value),
      $reason: sig.reason,
    });
  }
}

// Remove episodes (and their features/evidence/labels) for a session that are NOT
// in `keepEpisodeIds` — i.e. orphans left behind when a regrown transcript
// re-segments into fewer/different episodes. Surviving episodes keep their cached
// labels (we only delete what no longer exists), so re-runs don't re-spend on them.
export function pruneSessionEpisodes(
  db: Database,
  sessionId: string,
  keepEpisodeIds: string[]
): number {
  const existing = db
    .query(`SELECT episode_id FROM episodes WHERE session_id = ?`)
    .all(sessionId) as { episode_id: string }[];
  const keep = new Set(keepEpisodeIds);
  const orphans = existing.map((r) => r.episode_id).filter((id) => !keep.has(id));
  if (orphans.length === 0) return 0;
  const delFeat = db.query(`DELETE FROM episode_features WHERE episode_id = ?`);
  const delEvid = db.query(`DELETE FROM episode_evidence WHERE episode_id = ?`);
  const delLabel = db.query(`DELETE FROM episode_labels WHERE episode_id = ?`);
  const delEp = db.query(`DELETE FROM episodes WHERE episode_id = ?`);
  const delTurnLink = db.query(
    `UPDATE turns SET episode_id = NULL WHERE episode_id = ?`
  );
  const tx = db.transaction((ids: string[]) => {
    for (const id of ids) {
      delFeat.run(id);
      delEvid.run(id);
      delLabel.run(id);
      delTurnLink.run(id);
      delEp.run(id);
    }
  });
  tx(orphans);
  return orphans.length;
}

// ── Judge labels + cache ──────────────────────────────────────────────────────
export interface CacheKey {
  episodeId: string;
  contentHash: string;
  judgePromptHash: string;
  labelSchemaVersion: string;
  model: string;
  cliVersion: string;
}

// True iff a valid label already exists for this exact (content+prompt+schema+model+cli).
export function isJudged(db: Database, k: CacheKey): boolean {
  const row = db
    .query(
      `SELECT l.judge_prompt_hash, l.label_schema_version, l.model, l.cli_version, e.content_hash
       FROM episode_labels l JOIN episodes e ON e.episode_id = l.episode_id
       WHERE l.episode_id = ?`
    )
    .get(k.episodeId) as any;
  if (!row) return false;
  return (
    row.content_hash === k.contentHash &&
    row.judge_prompt_hash === k.judgePromptHash &&
    row.label_schema_version === k.labelSchemaVersion &&
    row.model === k.model &&
    row.cli_version === k.cliVersion
  );
}

export function upsertLabel(db: Database, label: JudgeLabel, meta: JudgeMeta): void {
  db.query(
    `INSERT INTO episode_labels (episode_id, task_type, task_difficulty, outcome,
       outcome_confidence, workflow_pattern_json, good_practices_json, friction_points_json,
       root_cause, outcome_evidence, skill_opportunity_json, judged_at, model,
       judge_prompt_hash, label_schema_version, cli_version)
     VALUES ($id,$tt,$td,$oc,$conf,$wp,$gp,$fp,$rc,$oe,$so,$ja,$model,$jph,$lsv,$cli)
     ON CONFLICT(episode_id) DO UPDATE SET
       task_type=excluded.task_type, task_difficulty=excluded.task_difficulty,
       outcome=excluded.outcome, outcome_confidence=excluded.outcome_confidence,
       workflow_pattern_json=excluded.workflow_pattern_json,
       good_practices_json=excluded.good_practices_json,
       friction_points_json=excluded.friction_points_json, root_cause=excluded.root_cause,
       outcome_evidence=excluded.outcome_evidence, skill_opportunity_json=excluded.skill_opportunity_json,
       judged_at=excluded.judged_at, model=excluded.model, judge_prompt_hash=excluded.judge_prompt_hash,
       label_schema_version=excluded.label_schema_version, cli_version=excluded.cli_version`
  ).run({
    $id: label.episode_id,
    $tt: label.task_type,
    $td: label.task_difficulty,
    $oc: label.outcome,
    $conf: label.outcome_confidence,
    $wp: JSON.stringify(label.workflow_pattern ?? []),
    $gp: JSON.stringify(label.good_practices ?? []),
    $fp: JSON.stringify(label.friction_points ?? []),
    $rc: label.root_cause,
    $oe: JSON.stringify(label.outcome_evidence ?? []),
    $so: JSON.stringify(label.skill_opportunity ?? {}),
    $ja: meta.judged_at,
    $model: meta.model,
    $jph: meta.judge_prompt_hash,
    $lsv: meta.label_schema_version,
    $cli: meta.cli_version,
  });
}

// ── Debate rounds (judge ensemble audit trail) ────────────────────────────────
export function upsertJudgeRounds(db: Database, d: DebateResult): void {
  db.query(
    `INSERT INTO episode_judge_rounds (episode_id, perspectives_json, rounds_json,
       n_rounds, converged, consolidator_model, created_at)
     VALUES ($id,$persp,$rounds,$nr,$conv,$model,$ca)
     ON CONFLICT(episode_id) DO UPDATE SET
       perspectives_json=excluded.perspectives_json, rounds_json=excluded.rounds_json,
       n_rounds=excluded.n_rounds, converged=excluded.converged,
       consolidator_model=excluded.consolidator_model, created_at=excluded.created_at`
  ).run({
    $id: d.episode_id,
    $persp: JSON.stringify(d.perspectives ?? []),
    $rounds: JSON.stringify(d.rounds ?? []),
    $nr: d.n_rounds,
    $conv: d.converged ? 1 : 0,
    $model: d.consolidator_model,
    $ca: new Date().toISOString(),
  });
}

// ── Calibration ───────────────────────────────────────────────────────────────
export function upsertCalibration(db: Database, c: CalibrationRow): void {
  db.query(
    `INSERT INTO calibration (episode_id, stratum, human_outcome, human_notes, agrees, checked_at)
     VALUES ($id,$st,$ho,$notes,$agrees,$ca)
     ON CONFLICT(episode_id) DO UPDATE SET
       stratum=excluded.stratum, human_outcome=excluded.human_outcome,
       human_notes=excluded.human_notes, agrees=excluded.agrees, checked_at=excluded.checked_at`
  ).run({
    $id: c.episodeId,
    $st: c.stratum,
    $ho: c.humanOutcome,
    $notes: c.humanNotes,
    $agrees: c.agrees === null ? null : c.agrees ? 1 : 0,
    $ca: c.checkedAt,
  });
}

// ── Skill drafts (skill-gen) ──────────────────────────────────────────────────
export interface SkillDraftRecord {
  clusterId: string;
  name: string;
  artifactType: string;
  description: string;
  compatibility: string | null;
  body: string;
  citations: string[];
  evals: unknown[];
  gateStatus: string;
  gateIssues: string[];
  confidence: number;
  evidenceHash: string;
  promptHash: string;
  model: string;
  generatedAt: string;
  outPath: string;
}

export function upsertSkillDraft(db: Database, r: SkillDraftRecord): void {
  db.query(
    `INSERT INTO skill_drafts (cluster_id, name, artifact_type, description, compatibility,
       body, citations_json, evals_json, gate_status, gate_issues_json, confidence,
       evidence_hash, prompt_hash, model, generated_at, out_path)
     VALUES ($cid,$name,$type,$desc,$compat,$body,$cit,$evals,$gs,$gi,$conf,$eh,$ph,$model,$ga,$op)
     ON CONFLICT(cluster_id) DO UPDATE SET
       name=excluded.name, artifact_type=excluded.artifact_type, description=excluded.description,
       compatibility=excluded.compatibility, body=excluded.body, citations_json=excluded.citations_json,
       evals_json=excluded.evals_json, gate_status=excluded.gate_status,
       gate_issues_json=excluded.gate_issues_json, confidence=excluded.confidence,
       evidence_hash=excluded.evidence_hash, prompt_hash=excluded.prompt_hash, model=excluded.model,
       generated_at=excluded.generated_at, out_path=excluded.out_path`
  ).run({
    $cid: r.clusterId,
    $name: r.name,
    $type: r.artifactType,
    $desc: r.description,
    $compat: r.compatibility,
    $body: r.body,
    $cit: JSON.stringify(r.citations ?? []),
    $evals: JSON.stringify(r.evals ?? []),
    $gs: r.gateStatus,
    $gi: JSON.stringify(r.gateIssues ?? []),
    $conf: r.confidence,
    $eh: r.evidenceHash,
    $ph: r.promptHash,
    $model: r.model,
    $ga: r.generatedAt,
    $op: r.outPath,
  });
}

// Cache check: a draft already exists for this cluster with identical evidence+prompt+model.
export function isSkillDrafted(
  db: Database,
  k: { clusterId: string; evidenceHash: string; promptHash: string; model: string }
): boolean {
  const row = db
    .query(
      `SELECT evidence_hash, prompt_hash, model FROM skill_drafts WHERE cluster_id = ?`
    )
    .get(k.clusterId) as any;
  if (!row) return false;
  return (
    row.evidence_hash === k.evidenceHash &&
    row.prompt_hash === k.promptHash &&
    row.model === k.model
  );
}

// ── Skill back-test telemetry ─────────────────────────────────────────────────
export interface SkillTelemetryRecord {
  skill: string;
  runner: string;
  model: string;
  mode: string; // dry | execute
  nCases: number;
  withLlmPass: number;
  baseLlmPass: number;
  llmTotal: number;
  withDetPass: number;
  baseDetPass: number;
  detTotal: number;
  createdAt: string;
}

export function upsertSkillTelemetry(db: Database, r: SkillTelemetryRecord): void {
  db.query(
    `INSERT INTO skill_telemetry (run_id, skill, runner, model, mode, n_cases,
       with_llm_pass, base_llm_pass, llm_total, with_det_pass, base_det_pass, det_total, created_at)
     VALUES ($rid,$skill,$runner,$model,$mode,$n,$wl,$bl,$lt,$wd,$bd,$dt,$ca)
     ON CONFLICT(run_id) DO UPDATE SET
       with_llm_pass=excluded.with_llm_pass, base_llm_pass=excluded.base_llm_pass,
       llm_total=excluded.llm_total, with_det_pass=excluded.with_det_pass,
       base_det_pass=excluded.base_det_pass, det_total=excluded.det_total`
  ).run({
    $rid: `${r.skill}@${r.createdAt}`,
    $skill: r.skill,
    $runner: r.runner,
    $model: r.model,
    $mode: r.mode,
    $n: r.nCases,
    $wl: r.withLlmPass,
    $bl: r.baseLlmPass,
    $lt: r.llmTotal,
    $wd: r.withDetPass,
    $bd: r.baseDetPass,
    $dt: r.detTotal,
    $ca: r.createdAt,
  });
}

// ── Shadow closed-loop (causal before/after on future tasks) ──────────────────

// Outcome stats for one task_type, optionally bounded by episode start time. Excludes
// qa_only from the success-rate denominator (consistent with the miner). Friction =
// median(n_corrections + n_interruptions). started_at is an ISO string, so lexical
// comparison is chronological.
export interface TaskTypeStats {
  n: number; // judged episodes in the window
  successRate: number; // success / (judged, excluding qa_only)
  medianFriction: number;
}

export function taskTypeStats(
  db: Database,
  taskType: string,
  window: { before?: string; after?: string } = {}
): TaskTypeStats {
  let where = "l.task_type = ?";
  const args: any[] = [taskType];
  if (window.before) { where += " AND e.started_at < ?"; args.push(window.before); }
  if (window.after) { where += " AND e.started_at >= ?"; args.push(window.after); }
  const rows = db
    .query(
      `SELECT l.outcome AS outcome,
              COALESCE(e.n_corrections,0) + COALESCE(e.n_interruptions,0) AS friction
       FROM episode_labels l JOIN episodes e ON e.episode_id = l.episode_id
       WHERE ${where}`
    )
    .all(...args) as { outcome: string; friction: number }[];
  const denom = rows.filter((r) => r.outcome !== "qa_only");
  const nSucc = denom.filter((r) => r.outcome === "success").length;
  return {
    n: rows.length,
    successRate: denom.length ? nSucc / denom.length : 0,
    medianFriction: median(rows.map((r) => Number(r.friction) || 0)),
  };
}

// The modal (most common) task_type among a set of episodes — used to derive which task
// family a skill's cluster represents, so we can match future episodes of the same family.
export function modalTaskType(db: Database, episodeIds: string[]): string | null {
  if (episodeIds.length === 0) return null;
  const ph = episodeIds.map(() => "?").join(",");
  const row = db
    .query(
      `SELECT task_type, COUNT(*) AS c FROM episode_labels
       WHERE episode_id IN (${ph}) AND task_type IS NOT NULL AND task_type <> ''
       GROUP BY task_type ORDER BY c DESC LIMIT 1`
    )
    .get(...episodeIds) as { task_type: string } | undefined;
  return row?.task_type ?? null;
}

export interface SkillDeployment {
  skill: string;
  clusterId: string | null;
  taskType: string;
  deployedAt: string;
  preN: number;
  preSuccessRate: number;
  preMedianFriction: number;
  note: string;
}

export function upsertSkillDeployment(db: Database, d: SkillDeployment): void {
  db.query(
    `INSERT INTO skill_deployments (skill, cluster_id, task_type, deployed_at,
       pre_n, pre_success_rate, pre_median_friction, note)
     VALUES ($s,$c,$tt,$da,$pn,$psr,$pmf,$note)
     ON CONFLICT(skill) DO UPDATE SET
       cluster_id=excluded.cluster_id, task_type=excluded.task_type, deployed_at=excluded.deployed_at,
       pre_n=excluded.pre_n, pre_success_rate=excluded.pre_success_rate,
       pre_median_friction=excluded.pre_median_friction, note=excluded.note`
  ).run({
    $s: d.skill, $c: d.clusterId, $tt: d.taskType, $da: d.deployedAt,
    $pn: d.preN, $psr: d.preSuccessRate, $pmf: d.preMedianFriction, $note: d.note,
  });
}

export function getSkillDeployment(db: Database, skill: string): SkillDeployment | null {
  const r = db
    .query(`SELECT * FROM skill_deployments WHERE skill = ?`)
    .get(skill) as any;
  if (!r) return null;
  return {
    skill: r.skill, clusterId: r.cluster_id, taskType: r.task_type, deployedAt: r.deployed_at,
    preN: r.pre_n, preSuccessRate: r.pre_success_rate, preMedianFriction: r.pre_median_friction,
    note: r.note ?? "",
  };
}

export interface ShadowObs {
  skill: string;
  observedAt: string;
  postN: number;
  postSuccessRate: number;
  postMedianFriction: number;
  deltaSuccessRate: number;
  deltaMedianFriction: number;
}

export function upsertShadowObs(db: Database, o: ShadowObs): void {
  db.query(
    `INSERT INTO skill_shadow_obs (obs_id, skill, observed_at, post_n, post_success_rate,
       post_median_friction, delta_success_rate, delta_median_friction)
     VALUES ($id,$s,$oa,$pn,$psr,$pmf,$dsr,$dmf)
     ON CONFLICT(obs_id) DO UPDATE SET
       post_n=excluded.post_n, post_success_rate=excluded.post_success_rate,
       post_median_friction=excluded.post_median_friction,
       delta_success_rate=excluded.delta_success_rate,
       delta_median_friction=excluded.delta_median_friction`
  ).run({
    $id: `${o.skill}@${o.observedAt}`, $s: o.skill, $oa: o.observedAt, $pn: o.postN,
    $psr: o.postSuccessRate, $pmf: o.postMedianFriction,
    $dsr: o.deltaSuccessRate, $dmf: o.deltaMedianFriction,
  });
}

// ── Clusters ──────────────────────────────────────────────────────────────────
export function getClusterMembers(db: Database, clusterId: string): string[] {
  const r = db
    .query(`SELECT member_episode_ids_json FROM task_clusters WHERE cluster_id = ?`)
    .get(clusterId) as { member_episode_ids_json?: string } | undefined;
  if (!r?.member_episode_ids_json) return [];
  try {
    const v = JSON.parse(r.member_episode_ids_json);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function upsertCluster(db: Database, c: TaskCluster): void {
  db.query(
    `INSERT INTO task_clusters (cluster_id, label, member_episode_ids_json)
     VALUES ($id,$label,$members)
     ON CONFLICT(cluster_id) DO UPDATE SET
       label=excluded.label, member_episode_ids_json=excluded.member_episode_ids_json`
  ).run({
    $id: c.clusterId,
    $label: c.label,
    $members: JSON.stringify(c.memberEpisodeIds),
  });
}
