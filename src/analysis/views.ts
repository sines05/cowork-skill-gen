// views.ts — (re)create the BI-friendly SQL views over analysis.db and fold the WAL
// into the main file so a BI tool (Metabase) can read it via a read-only mount.
//
//   bun run views                 # ./analysis.db
//   bun run views --db other.db
//
// Run this before pointing Metabase/Superset at the DB. Re-runnable.

import { Database } from "bun:sqlite";
import { readFileSync, existsSync } from "fs";
import { defaultDbPath } from "../core/paths.ts";
import { loadLedgerIntoDb } from "../db/llm_ledger.ts";

const SCHEMA_VIEWS = `${import.meta.dir}/../db/views.sql`;

function parseDbPath(argv: string[]): string {
  const i = argv.indexOf("--db");
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : defaultDbPath;
}

function ensureSourceColumn(db: Database): void {
  // v_episode_full references sessions.source; merge.ts adds it, but a single-machine
  // DB won't have it. Add it (nullable) so the views compile everywhere.
  const cols = db.query(`PRAGMA table_info(sessions)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "source")) {
    db.exec(`ALTER TABLE sessions ADD COLUMN source TEXT`);
  }
}

function main() {
  const dbPath = parseDbPath(process.argv.slice(2));
  if (!existsSync(dbPath)) {
    console.error(`[views] no DB at ${dbPath}. Run the pipeline first.`);
    process.exit(2);
  }
  const db = new Database(dbPath); // read-write: we create views + checkpoint
  ensureSourceColumn(db);

  // Fold the LLM spend ledger into the llm_calls table so the cost/token views have data.
  const loaded = loadLedgerIntoDb(db);
  if (loaded > 0) console.log(`[views] loaded ${loaded} new LLM call(s) from the ledger`);

  const sql = readFileSync(SCHEMA_VIEWS, "utf8");
  db.exec(sql);

  // Fold WAL into the main file so a read-only mount sees all data.
  try {
    db.exec(`PRAGMA wal_checkpoint(TRUNCATE)`);
  } catch {
    /* not in WAL mode — fine */
  }

  const views = db
    .query(`SELECT name FROM sqlite_master WHERE type='view' ORDER BY name`)
    .all() as { name: string }[];
  console.log(`[views] created ${views.length} view(s) in ${dbPath}:`);
  for (const v of views) {
    let n = 0;
    try {
      n = (db.query(`SELECT COUNT(*) c FROM ${v.name}`).get() as any).c;
    } catch {
      /* ignore count errors */
    }
    console.log(`  ${v.name.padEnd(24)} ${n} row(s)`);
  }
  db.close();
}

main();
