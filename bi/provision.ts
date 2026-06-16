// provision.ts — config-as-code setup for Metabase (instead of clicking the wizard).
// Creates the admin user on first run, registers the SQLite analysis DB as a data
// source, syncs the schema, and verifies the BI views are visible.
//
//   bun run bi/provision.ts            # uses http://localhost:3000
//   MB_URL=... MB_EMAIL=... MB_PASSWORD=... bun run bi/provision.ts
//
// Idempotent: re-running logs in and ensures the data source + sync exist.

const BASE = (process.env.MB_URL || "http://localhost:3000").replace(/\/+$/, "");
const EMAIL = process.env.MB_EMAIL || "admin@cowork.local";
const PASSWORD = process.env.MB_PASSWORD || "Cowork-admin-1";
const DB_NAME = "Cowork Analysis";
const DB_PATH = process.env.MB_DB_PATH || "/data/analysis.db";

async function j(method: string, path: string, body?: unknown, session?: string) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(session ? { "X-Metabase-Session": session } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

// Native-SQL cards (no field-id wrangling) + grid layout (24-col Metabase grid).
// Laid out in clearly separated bands so the dashboard reads top-to-bottom:
//   row 0  — Overview KPIs        (4 scalars)
//   row 3  — Cost & tokens KPIs   (4 scalars)  ← the pipeline's OWN spend
//   row 6  — Cost & tokens charts (by phase / model / day)
//   row 18 — Outcomes             (distribution + success by task)
//   row 24 — Output               (episodes by project + generated skills)
const DASH_NAME = "Cowork — Leadership";
const CARDS = [
  // ── Overview KPIs ───────────────────────────────────────────────────────────
  { key: "episodes", name: "Total episodes", display: "scalar", col: 0, row: 0, w: 6, h: 3,
    sql: "SELECT COUNT(*) AS episodes FROM v_episode_full" },
  { key: "judged", name: "Judged episodes", display: "scalar", col: 6, row: 0, w: 6, h: 3,
    sql: "SELECT COUNT(*) AS judged FROM v_episode_full WHERE outcome IN ('success','partial','failed','abandoned')" },
  { key: "success", name: "Overall success %", display: "scalar", col: 12, row: 0, w: 6, h: 3,
    sql: "SELECT ROUND(100.0*SUM(is_success)/NULLIF(SUM(CASE WHEN outcome IN ('success','partial','failed','abandoned') THEN 1 ELSE 0 END),0),0) AS success_pct FROM v_episode_full" },
  { key: "agree", name: "Judge↔human agreement %", display: "scalar", col: 18, row: 0, w: 6, h: 3,
    sql: "SELECT ROUND(100.0*SUM(CASE WHEN agrees=1 THEN 1 ELSE 0 END)/NULLIF(COUNT(*),0),0) AS agreement_pct FROM v_calibration" },

  // ── Cost & tokens KPIs (pipeline's own LLM spend) ────────────────────────────
  { key: "spend", name: "LLM spend ($)", display: "scalar", col: 0, row: 3, w: 6, h: 3,
    sql: "SELECT cost_usd FROM v_llm_cost_total" },
  { key: "tokens", name: "Total tokens (in+out)", display: "scalar", col: 6, row: 3, w: 6, h: 3,
    sql: "SELECT total_tokens FROM v_llm_cost_total" },
  { key: "calls", name: "LLM calls", display: "scalar", col: 12, row: 3, w: 6, h: 3,
    sql: "SELECT calls FROM v_llm_cost_total" },
  { key: "workload", name: "Session tokens analyzed", display: "scalar", col: 18, row: 3, w: 6, h: 3,
    sql: "SELECT COALESCE(SUM(session_tokens),0) AS session_tokens FROM v_workload_tokens" },

  // ── Cost & tokens charts ─────────────────────────────────────────────────────
  { key: "cost_phase", name: "Cost by phase ($)", display: "bar", col: 0, row: 6, w: 12, h: 6,
    sql: "SELECT phase, cost_usd FROM v_llm_cost_by_phase" },
  { key: "cost_model", name: "Cost by model ($)", display: "pie", col: 12, row: 6, w: 12, h: 6,
    sql: "SELECT model, cost_usd FROM v_llm_cost_by_model" },
  { key: "cost_day", name: "Cost over time ($/day)", display: "line", col: 0, row: 12, w: 12, h: 6,
    sql: "SELECT day, cost_usd FROM v_llm_cost_by_day" },
  { key: "tok_phase", name: "Tokens by phase", display: "bar", col: 12, row: 12, w: 12, h: 6,
    sql: "SELECT phase, total_tokens FROM v_llm_cost_by_phase" },

  // ── Outcomes ──────────────────────────────────────────────────────────────────
  { key: "outcome", name: "Outcome distribution", display: "pie", col: 0, row: 18, w: 8, h: 6,
    sql: "SELECT outcome, n FROM v_outcome_distribution" },
  { key: "bytask", name: "Success % by task type", display: "row", col: 8, row: 18, w: 16, h: 6,
    sql: "SELECT task_type, success_pct FROM v_task_type_summary WHERE judged > 0 ORDER BY success_pct DESC LIMIT 15" },

  // ── Output ──────────────────────────────────────────────────────────────────
  { key: "byproject", name: "Episodes by project", display: "bar", col: 0, row: 24, w: 12, h: 6,
    sql: "SELECT project, COUNT(*) AS episodes FROM v_episode_full GROUP BY project ORDER BY episodes DESC" },
  { key: "skills", name: "Generated skills", display: "table", col: 12, row: 24, w: 12, h: 6,
    sql: "SELECT name, artifact_type, gate_status, confidence FROM v_skill_drafts" },

  // ── Back-test (Gate 2-B): does the skill actually help? ───────────────────────
  { key: "eval_uplift", name: "Skill back-test — LLM uplift (with − without)", display: "bar", col: 0, row: 30, w: 12, h: 6,
    sql: "SELECT skill, llm_uplift FROM v_skill_telemetry ORDER BY llm_uplift DESC" },
  { key: "eval_table", name: "Back-test detail (with vs no-skill)", display: "table", col: 12, row: 30, w: 12, h: 6,
    sql: "SELECT skill, n_cases, with_llm_pass || '/' || llm_total AS with_skill, base_llm_pass || '/' || llm_total AS no_skill, llm_uplift AS llm_uplift, golden_uplift FROM v_skill_telemetry" },
];

// Build (find-or-create) the cards + dashboard. Idempotent: re-running reuses cards by
// name and re-applies the layout, so it won't pile up duplicates.
async function buildDashboard(session: string, dbId: number) {
  const existing = (await j("GET", "/api/card", undefined, session)).data;
  const byName = new Map<string, number>(
    Array.isArray(existing) ? existing.map((c: any) => [c.name, c.id]) : []
  );
  const idByKey: Record<string, number> = {};
  for (const c of CARDS) {
    const query = { database: dbId, type: "native", native: { query: c.sql } };
    let id = byName.get(c.name);
    if (!id) {
      const r = await j("POST", "/api/card", {
        name: c.name, display: c.display, dataset_query: query, visualization_settings: {},
      }, session);
      if (!r.ok) { console.log(`  card '${c.name}' failed: ${JSON.stringify(r.data).slice(0, 120)}`); continue; }
      id = r.data.id;
    } else {
      // Re-point an existing card at the CURRENT data source + SQL. Without this, a card
      // created against a previous data-source id (e.g. after re-adding the DB → new id)
      // keeps querying the stale source and renders empty — exactly the "no cost shows up"
      // symptom even though the data is present.
      await j("PUT", `/api/card/${id}`, {
        name: c.name, display: c.display, dataset_query: query,
      }, session);
    }
    if (id) idByKey[c.key] = id;
  }

  const dashes = (await j("GET", "/api/dashboard", undefined, session)).data;
  let dash = Array.isArray(dashes) ? dashes.find((d: any) => d.name === DASH_NAME) : null;
  if (!dash) {
    const r = await j("POST", "/api/dashboard", {
      name: DASH_NAME, description: "Auto-generated by cowork-skill-factory",
    }, session);
    if (!r.ok) throw new Error(`create dashboard failed: ${JSON.stringify(r.data).slice(0, 140)}`);
    dash = r.data;
  }

  const dashcards = CARDS.filter((c) => idByKey[c.key]).map((c, i) => ({
    id: -(i + 1), card_id: idByKey[c.key], row: c.row, col: c.col, size_x: c.w, size_y: c.h,
    series: [], parameter_mappings: [], visualization_settings: {},
  }));
  const put = await j("PUT", `/api/dashboard/${dash.id}`, { dashcards }, session);
  if (!put.ok) console.log(`  dashboard layout failed: ${JSON.stringify(put.data).slice(0, 160)}`);
  console.log(`[provision] dashboard "${DASH_NAME}" → ${BASE}/dashboard/${dash.id}  (${dashcards.length} cards)`);
}

async function main() {
  // 1) Acquire a session. LOGIN-FIRST (robust): if the admin already exists we just log
  // in; only a truly fresh install (login fails + setup-token present) runs /api/setup.
  // We do NOT create the data source inline in /api/setup — it's added separately below,
  // after the writable snapshot mount is in place.
  let session: string;
  const login = await j("POST", "/api/session", { username: EMAIL, password: PASSWORD });
  if (login.ok && login.data?.id) {
    session = login.data.id;
    console.log("[provision] logged in (admin exists)");
  } else {
    const props = await j("GET", "/api/session/properties");
    const token = props.data?.["setup-token"];
    if (!token) {
      throw new Error(`cannot log in (status ${login.status}) and no setup-token available`);
    }
    console.log("[provision] fresh Metabase — creating admin via /api/setup");
    const r = await j("POST", "/api/setup", {
      token,
      user: {
        first_name: "Cowork",
        last_name: "Admin",
        email: EMAIL,
        password: PASSWORD,
        site_name: "Cowork Skill Factory",
      },
      prefs: { site_name: "Cowork Skill Factory", allow_tracking: false },
    });
    if (!r.ok) throw new Error(`/api/setup failed (${r.status}): ${JSON.stringify(r.data).slice(0, 200)}`);
    session = typeof r.data === "string" ? r.data : r.data?.id;
  }

  // 2) Ensure the SQLite data source exists.
  const dbs = await j("GET", "/api/database", undefined, session);
  const list = Array.isArray(dbs.data) ? dbs.data : dbs.data?.data ?? [];
  let db = list.find((d: any) => d.name === DB_NAME);
  if (!db) {
    console.log("[provision] adding SQLite data source");
    const r = await j("POST", "/api/database", {
      engine: "sqlite", name: DB_NAME, details: { db: DB_PATH },
    }, session);
    if (!r.ok) throw new Error(`add database failed (${r.status}): ${JSON.stringify(r.data).slice(0, 160)}`);
    db = r.data;
  }

  // 3) Sync the schema so the views become queryable.
  await j("POST", `/api/database/${db.id}/sync_schema`, {}, session);
  // give the sync a moment
  await new Promise((r) => setTimeout(r, 4000));

  // 4) Verify the BI views are visible.
  const meta = await j("GET", `/api/database/${db.id}/metadata`, undefined, session);
  const tables: string[] = (meta.data?.tables ?? []).map((t: any) => t.name);
  const want = ["v_episode_full", "v_task_type_summary", "v_outcome_distribution", "v_calibration", "v_skill_drafts",
    "v_skill_telemetry",
    "v_llm_cost_total", "v_llm_cost_by_phase", "v_llm_cost_by_model", "v_llm_cost_by_day", "v_workload_tokens"];
  const seen = want.filter((v) => tables.includes(v));
  console.log(`[provision] data source id=${db.id}; tables visible: ${tables.length}`);
  console.log(`[provision] BI views found: ${seen.length}/${want.length} — ${seen.join(", ") || "(none yet; re-run after sync)"}`);

  // 5) Auto-build the leadership dashboard (cards + layout) via API.
  await buildDashboard(session, db.id);

  console.log(`[provision] ✅ Metabase ready at ${BASE}  (login: ${EMAIL} / ${PASSWORD})`);
}

main().catch((e) => {
  console.error("[provision] error:", (e as Error).message);
  process.exit(1);
});
