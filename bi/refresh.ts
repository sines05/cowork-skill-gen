// refresh.ts — prepare a Metabase-ready SNAPSHOT of the analysis DB.
//
// BI tools read a snapshot, not the live operational DB. This (1) (re)creates the BI
// views, (2) folds the WAL into the main file, then (3) copies analysis.db into
// bi/data/ — a writable mount Metabase can open (SQLite must create a journal even to
// read, so a read-only mount fails with SQLITE_READONLY_DIRECTORY).
//
//   bun run bi/refresh.ts          # ./analysis.db → bi/data/analysis.db
//   MINER_DB=other.db bun run bi/refresh.ts

import { Database } from "bun:sqlite";
import { readFileSync, copyFileSync, mkdirSync, existsSync, chmodSync } from "fs";
import { join } from "path";
import { defaultDbPath } from "../src/core/paths.ts";

const VIEWS_SQL = `${import.meta.dir}/../src/db/views.sql`;
const DATA_DIR = `${import.meta.dir}/data`;

const src = process.env.MINER_DB || defaultDbPath;
if (!existsSync(src)) {
  console.error(`[refresh] no DB at ${src}. Run the pipeline first.`);
  process.exit(2);
}

const db = new Database(src);
// v_episode_full references sessions.source; ensure it exists on single-machine DBs.
const cols = db.query(`PRAGMA table_info(sessions)`).all() as { name: string }[];
if (!cols.some((c) => c.name === "source")) {
  db.exec(`ALTER TABLE sessions ADD COLUMN source TEXT`);
}
db.exec(readFileSync(VIEWS_SQL, "utf8"));
try {
  db.exec(`PRAGMA wal_checkpoint(TRUNCATE)`);
} catch {
  /* not WAL — fine */
}
db.close();

mkdirSync(DATA_DIR, { recursive: true });
const dest = join(DATA_DIR, "analysis.db");
copyFileSync(src, dest);
// Metabase runs as a different uid (2000) than the host; SQLite must create a journal
// in this dir to open the file, so make the snapshot dir + file group/other-writable.
try {
  chmodSync(DATA_DIR, 0o777);
  chmodSync(dest, 0o666);
} catch {
  /* best-effort */
}
console.log(`[refresh] BI views applied + WAL folded; snapshot → ${dest}`);
console.log(`[refresh] now: bun run bi:up && bun run bi:provision`);
