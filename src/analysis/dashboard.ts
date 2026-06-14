// dashboard.ts — OFFLINE FALLBACK dashboard (out/dashboard.html).
//
// NOTE: the PRIMARY leadership dashboard is Metabase — see `bi/` (a real BI tool with
// self-serve charts, auth, scheduled reports). This static file is the fallback for the
// air-gapped / single-`.exe` case where you can't run a BI server: a self-contained HTML
// snapshot — inline <style>, hand-built inline-SVG charts, NO external CDN/JS/server, so
// it opens offline in any browser (single-.exe Windows fleet + privacy/no-egress).
//
// Read-only DB access. Reuses corpusTotals' SQL (from report.ts) and mine() for
// the deterministic task clusters. ALL dynamic text is HTML-escaped (labels,
// skill names, cluster labels come from an LLM and may contain < & " etc.).
//
// Sections (in order): header+caveat, corpus overview cards, outcome-distribution
// SVG bar chart, task-clusters table, generated-skills table, risk-flag footer.
//
// Export: dashboard(db, opts?).
import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { RankedCandidate } from "../core/types.ts";
import { mine } from "./mine.ts";
import { outDir as DEFAULT_OUT_DIR } from "../core/paths.ts";

// ── HTML escaping ──────────────────────────────────────────────────────────────
// Escapes everything that could break out of text or attribute context. Applied
// to EVERY dynamic value (LLM-authored labels/skill names may contain < & " ').
function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(s: string | null | undefined, n = 140): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`;
}

// ── Corpus totals (SQL reused from report.ts corpusTotals) ─────────────────────
function corpusTotals(db: Database): {
  nSessions: number;
  nEpisodes: number;
  nJudged: number;
  overallSuccess: number;
} {
  const nSessions =
    (db.query(`SELECT COUNT(*) AS c FROM sessions`).get() as any)?.c ?? 0;
  const nEpisodes =
    (db.query(`SELECT COUNT(*) AS c FROM episodes`).get() as any)?.c ?? 0;
  const nJudged =
    (
      db
        .query(
          `SELECT COUNT(*) AS c FROM episode_labels
           WHERE outcome IN ('success','partial','failed','abandoned')`
        )
        .get() as any
    )?.c ?? 0;
  const nSuccess =
    (
      db
        .query(`SELECT COUNT(*) AS c FROM episode_labels WHERE outcome='success'`)
        .get() as any
    )?.c ?? 0;
  return {
    nSessions,
    nEpisodes,
    nJudged,
    overallSuccess: nJudged > 0 ? nSuccess / nJudged : 0,
  };
}

// Outcome distribution counts (includes qa_only, which is excluded elsewhere).
const OUTCOME_ORDER = [
  "success",
  "partial",
  "failed",
  "abandoned",
  "qa_only",
] as const;
const OUTCOME_COLORS: Record<string, string> = {
  success: "#2e9e5b",
  partial: "#caa23a",
  failed: "#c0392b",
  abandoned: "#7f8c8d",
  qa_only: "#3a6ea5",
};

function outcomeCounts(db: Database): Record<string, number> {
  const rows = db
    .query(
      `SELECT outcome AS outcome, COUNT(*) AS c
       FROM episode_labels
       WHERE outcome IS NOT NULL
       GROUP BY outcome`
    )
    .all() as Array<{ outcome: string | null; c: number }>;
  const counts: Record<string, number> = {};
  for (const o of OUTCOME_ORDER) counts[o] = 0;
  for (const r of rows) {
    if (r.outcome && r.outcome in counts) counts[r.outcome] = r.c;
  }
  return counts;
}

// ── Skill drafts ───────────────────────────────────────────────────────────────
interface SkillDraftRow {
  name: string | null;
  artifact_type: string | null;
  gate_status: string | null;
  confidence: number | null;
  description: string | null;
}
function loadSkillDrafts(db: Database): SkillDraftRow[] {
  return db
    .query(
      `SELECT name, artifact_type, gate_status, confidence, description
       FROM skill_drafts
       ORDER BY confidence DESC NULLS LAST, name ASC`
    )
    .all() as SkillDraftRow[];
}

// ── inline-SVG horizontal bar chart (no libs) ──────────────────────────────────
function svgBarChart(counts: Record<string, number>): string {
  const rows = OUTCOME_ORDER.map((o) => ({
    label: o,
    value: counts[o] ?? 0,
    color: OUTCOME_COLORS[o] ?? "#888",
  }));
  const max = Math.max(1, ...rows.map((r) => r.value));

  // Layout (px). Hand-computed; no external scale lib.
  const rowH = 34;
  const gap = 10;
  const labelW = 96;
  const countW = 56;
  const barMaxW = 360;
  const padX = 12;
  const padY = 16;
  const chartW = padX * 2 + labelW + barMaxW + countW;
  const chartH = padY * 2 + rows.length * rowH + (rows.length - 1) * gap;

  const parts: string[] = [];
  parts.push(
    `<svg viewBox="0 0 ${chartW} ${chartH}" width="100%" ` +
      `style="max-width:${chartW}px" role="img" ` +
      `aria-label="Outcome distribution bar chart">`
  );
  rows.forEach((r, i) => {
    const y = padY + i * (rowH + gap);
    const barW = max > 0 ? (r.value / max) * barMaxW : 0;
    const barX = padX + labelW;
    const textY = y + rowH / 2 + 4;
    // label (right-aligned), bar track, bar, count
    parts.push(
      `<text x="${padX + labelW - 8}" y="${textY}" text-anchor="end" ` +
        `class="svg-label">${esc(r.label)}</text>`
    );
    parts.push(
      `<rect x="${barX}" y="${y}" width="${barMaxW}" height="${rowH}" ` +
        `rx="4" class="svg-track"/>`
    );
    parts.push(
      `<rect x="${barX}" y="${y}" width="${barW.toFixed(1)}" height="${rowH}" ` +
        `rx="4" fill="${r.color}"/>`
    );
    parts.push(
      `<text x="${barX + Math.max(barW, 4) + 8}" y="${textY}" ` +
        `class="svg-count">${esc(r.value)}</text>`
    );
  });
  parts.push(`</svg>`);
  return parts.join("\n");
}

// ── card + table builders ──────────────────────────────────────────────────────
function card(label: string, value: string): string {
  return (
    `<div class="card"><div class="card-value">${esc(value)}</div>` +
    `<div class="card-label">${esc(label)}</div></div>`
  );
}

function clusterRows(candidates: RankedCandidate[]): string {
  if (candidates.length === 0) {
    return `<tr><td colspan="10" class="empty">No task clusters found.</td></tr>`;
  }
  return candidates
    .map((c) => {
      const smoothed =
        c.success_rate_smoothed != null ? pct(c.success_rate_smoothed) : "—";
      const lowConf = c.low_confidence
        ? `<span class="badge badge-low">low conf</span>`
        : "";
      const risks = c.risk_flags.length
        ? c.risk_flags.map((f) => `<span class="flag">${esc(f)}</span>`).join(" ")
        : `<span class="muted">—</span>`;
      const rec =
        c.recommended_intervention && c.recommended_intervention !== "none"
          ? `<span class="badge badge-rec">${esc(c.recommended_intervention)}</span>`
          : `<span class="muted">none</span>`;
      return (
        `<tr>` +
        `<td>${esc(c.label)} ${lowConf}</td>` +
        `<td class="num">${esc(c.frequency)}</td>` +
        `<td class="num">${esc(c.n_sessions)}</td>` +
        `<td class="num">${esc(pct(c.success_rate))}</td>` +
        `<td class="num muted">${esc(smoothed)}</td>` +
        `<td class="num">${esc(c.median_friction)}</td>` +
        `<td class="num">${c.has_stable_pattern ? "yes" : "no"}</td>` +
        `<td>${rec}</td>` +
        `<td>${risks}</td>` +
        `</tr>`
      );
    })
    .join("\n");
}

function skillRows(drafts: SkillDraftRow[]): string {
  if (drafts.length === 0) {
    return `<tr><td colspan="5" class="empty">none generated yet</td></tr>`;
  }
  return drafts
    .map((d) => {
      const gate = d.gate_status ?? "—";
      const gateClass =
        gate === "pass"
          ? "gate-pass"
          : gate === "reject"
            ? "gate-reject"
            : gate === "warn"
              ? "gate-warn"
              : "muted";
      const conf =
        typeof d.confidence === "number" ? d.confidence.toFixed(2) : "—";
      return (
        `<tr>` +
        `<td>${esc(d.name ?? "—")}</td>` +
        `<td>${esc(d.artifact_type ?? "—")}</td>` +
        `<td><span class="badge ${gateClass}">${esc(gate)}</span></td>` +
        `<td class="num">${esc(conf)}</td>` +
        `<td>${esc(truncate(d.description, 160))}</td>` +
        `</tr>`
      );
    })
    .join("\n");
}

// ── styles (inline; no external stylesheet) ────────────────────────────────────
const STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0; padding: 32px;
  font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: #1c2530; background: #f4f6f8;
}
.wrap { max-width: 1080px; margin: 0 auto; }
h1 { font-size: 26px; margin: 0 0 4px; }
h2 { font-size: 18px; margin: 36px 0 12px; padding-bottom: 6px; border-bottom: 2px solid #e1e6ea; }
.meta { color: #5a6b7b; font-size: 13px; }
.caveat {
  margin: 16px 0 0; padding: 12px 14px; border-radius: 8px;
  background: #fff7e6; border: 1px solid #f0d79a; color: #6b4e12; font-size: 13.5px;
}
.cards { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 8px; }
.card {
  flex: 1 1 160px; background: #fff; border: 1px solid #e1e6ea; border-radius: 10px;
  padding: 18px; box-shadow: 0 1px 2px rgba(0,0,0,0.03);
}
.card-value { font-size: 30px; font-weight: 700; color: #16324f; }
.card-label { color: #5a6b7b; font-size: 13px; margin-top: 2px; }
.panel { background: #fff; border: 1px solid #e1e6ea; border-radius: 10px; padding: 18px; }
.svg-label { font-size: 13px; fill: #34465a; font-family: inherit; }
.svg-count { font-size: 13px; fill: #1c2530; font-weight: 600; font-family: inherit; }
.svg-track { fill: #eef1f4; }
table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e1e6ea; border-radius: 10px; overflow: hidden; }
th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid #eef1f4; font-size: 13.5px; vertical-align: top; }
th { background: #f0f3f6; color: #34465a; font-weight: 600; white-space: nowrap; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
tr:last-child td { border-bottom: none; }
.empty { color: #8595a4; font-style: italic; text-align: center; padding: 18px; }
.muted { color: #97a4b1; }
.badge { display: inline-block; padding: 1px 7px; border-radius: 10px; font-size: 11.5px; font-weight: 600; }
.badge-low { background: #fdecea; color: #b03a2e; }
.badge-rec { background: #e8f1fb; color: #1d5d9b; }
.gate-pass { background: #e4f4ea; color: #1e7a44; }
.gate-warn { background: #fdf3d6; color: #8a6d1a; }
.gate-reject { background: #fdecea; color: #b03a2e; }
.flag { display: inline-block; background: #fdecea; color: #9b3326; padding: 1px 7px; border-radius: 6px; font-size: 11.5px; margin: 1px 2px 1px 0; }
footer { margin-top: 36px; padding-top: 16px; border-top: 1px solid #e1e6ea; color: #5a6b7b; font-size: 13px; }
footer .flag { margin: 2px; }
`;

// ── main ────────────────────────────────────────────────────────────────────────
export async function dashboard(
  db: Database,
  opts?: { outDir?: string }
): Promise<string> {
  const outDirPath = opts?.outDir ?? DEFAULT_OUT_DIR;
  mkdirSync(outDirPath, { recursive: true });

  const totals = corpusTotals(db);
  const counts = outcomeCounts(db);
  const { candidates } = await mine(db);
  const drafts = loadSkillDrafts(db);
  const generatedAt = new Date().toISOString();

  // Footer: aggregate risk-flag counts across clusters.
  const riskTally = new Map<string, number>();
  for (const c of candidates) {
    for (const f of c.risk_flags) riskTally.set(f, (riskTally.get(f) ?? 0) + 1);
  }
  const totalRiskFlags = [...riskTally.values()].reduce((a, b) => a + b, 0);
  const riskFooter =
    riskTally.size === 0
      ? `<span class="muted">No risk flags raised across ${esc(candidates.length)} cluster(s).</span>`
      : [...riskTally.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([f, n]) => `<span class="flag">${esc(f)} ×${esc(n)}</span>`)
          .join(" ");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cowork Workflow Miner — Dashboard</title>
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">

  <h1>Cowork Workflow Miner — Leadership Dashboard</h1>
  <div class="meta">Generated: ${esc(generatedAt)}</div>
  <div class="caveat">
    Exemplar-driven, not statistical; outcomes are LLM-judged. Utilization/compliance
    dashboards require telemetry not collected here.
  </div>

  <h2>Corpus overview</h2>
  <div class="cards">
    ${card("Sessions", String(totals.nSessions))}
    ${card("Episodes", String(totals.nEpisodes))}
    ${card("Judged episodes", String(totals.nJudged))}
    ${card("Overall success", pct(totals.overallSuccess))}
  </div>

  <h2>Outcome distribution</h2>
  <div class="panel">
    ${svgBarChart(counts)}
  </div>

  <h2>Task clusters</h2>
  <table>
    <thead>
      <tr>
        <th>Label</th>
        <th class="num">Freq</th>
        <th class="num">Sessions</th>
        <th class="num">Success%</th>
        <th class="num">Smoothed%</th>
        <th class="num">Median friction</th>
        <th>Stable pattern</th>
        <th>Recommended intervention</th>
        <th>Risk flags</th>
      </tr>
    </thead>
    <tbody>
      ${clusterRows(candidates)}
    </tbody>
  </table>

  <h2>Generated skills</h2>
  <table>
    <thead>
      <tr>
        <th>Name</th>
        <th>Artifact type</th>
        <th>Gate status</th>
        <th class="num">Confidence</th>
        <th>Description</th>
      </tr>
    </thead>
    <tbody>
      ${skillRows(drafts)}
    </tbody>
  </table>

  <footer>
    <strong>Risk flags across clusters:</strong>
    ${totalRiskFlags} total across ${esc(riskTally.size)} flag type(s).<br>
    ${riskFooter}
  </footer>

</div>
</body>
</html>
`;

  const outPath = join(outDirPath, "dashboard.html");
  writeFileSync(outPath, html, "utf8");
  return outPath;
}

// ── CLI ───────────────────────────────────────────────────────────────────────
if (import.meta.main) {
  const { openDb } = await import("../db/db.ts");
  const db = openDb();
  const outPath = await dashboard(db);
  console.log(`Wrote:`);
  console.log(`  ${outPath}`);
  db.close();
}
