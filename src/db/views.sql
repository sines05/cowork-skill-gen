-- BI-friendly VIEWS over the analysis schema. These flatten the normalized tables
-- into wide, self-describing tables so a BI tool (Metabase/Superset) can build charts
-- by drag-and-drop, without anyone hand-writing JOINs. Re-runnable (DROP + CREATE).

DROP VIEW IF EXISTS v_episode_full;
CREATE VIEW v_episode_full AS
SELECT
  e.episode_id,
  e.session_id,
  s.project,
  COALESCE(s.source, 'local')           AS source_machine,
  e.idx                                  AS episode_idx,
  e.first_prompt,
  e.n_turns,
  e.n_corrections,
  e.n_interruptions,
  e.n_approvals,
  e.n_images,
  e.used_subagents,
  (e.n_corrections + e.n_interruptions)  AS friction,
  l.task_type,
  l.task_difficulty,
  l.outcome,
  l.outcome_confidence,
  CASE WHEN l.outcome = 'success' THEN 1 ELSE 0 END AS is_success,
  f.n_tool_calls,
  f.n_files_read,
  f.n_files_edited,
  f.n_test_runs,
  f.duration_s,
  f.idle_s,
  f.tokens,
  e.started_at,
  e.ended_at
FROM episodes e
LEFT JOIN sessions s          ON s.session_id = e.session_id
LEFT JOIN episode_labels l    ON l.episode_id = e.episode_id
LEFT JOIN episode_features f  ON f.episode_id = e.episode_id;

-- Per task_type rollup (the leadership "which work succeeds" view). qa_only excluded
-- from the success-rate denominator (it's a question, not a task attempt).
DROP VIEW IF EXISTS v_task_type_summary;
CREATE VIEW v_task_type_summary AS
SELECT
  COALESCE(l.task_type, 'unjudged')                      AS task_type,
  COUNT(*)                                               AS episodes,
  COUNT(DISTINCT e.session_id)                           AS sessions,
  SUM(CASE WHEN l.outcome IN ('success','partial','failed','abandoned') THEN 1 ELSE 0 END) AS judged,
  SUM(CASE WHEN l.outcome = 'success' THEN 1 ELSE 0 END) AS successes,
  ROUND(100.0 * SUM(CASE WHEN l.outcome = 'success' THEN 1 ELSE 0 END)
        / NULLIF(SUM(CASE WHEN l.outcome IN ('success','partial','failed','abandoned') THEN 1 ELSE 0 END), 0), 0)
                                                          AS success_pct,
  ROUND(AVG(e.n_corrections + e.n_interruptions), 2)     AS avg_friction
FROM episodes e
LEFT JOIN episode_labels l ON l.episode_id = e.episode_id
GROUP BY COALESCE(l.task_type, 'unjudged')
ORDER BY episodes DESC;

-- Outcome distribution (for a single bar/pie card).
DROP VIEW IF EXISTS v_outcome_distribution;
CREATE VIEW v_outcome_distribution AS
SELECT outcome, COUNT(*) AS n
FROM episode_labels
GROUP BY outcome
ORDER BY n DESC;

-- Calibration: judge vs human (the trust view). One row per reviewed episode.
DROP VIEW IF EXISTS v_calibration;
CREATE VIEW v_calibration AS
SELECT
  c.episode_id,
  c.stratum,
  l.outcome        AS judge_outcome,
  c.human_outcome,
  c.agrees,
  c.human_notes,
  e.first_prompt,
  s.project
FROM calibration c
LEFT JOIN episode_labels l ON l.episode_id = c.episode_id
LEFT JOIN episodes e       ON e.episode_id = c.episode_id
LEFT JOIN sessions s       ON s.session_id = e.session_id;

-- Generated skills (the output view).
DROP VIEW IF EXISTS v_skill_drafts;
CREATE VIEW v_skill_drafts AS
SELECT name, cluster_id, artifact_type, gate_status, confidence,
       substr(description, 1, 160) AS description, generated_at
FROM skill_drafts
ORDER BY confidence DESC;
