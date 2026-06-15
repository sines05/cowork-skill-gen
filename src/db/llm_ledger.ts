// llm_ledger.ts — fold the append-only LLM spend ledger into the llm_calls DB table.
//
// The LLM call sites (judge/skillgen/skilleval/classify/mine) run in separate processes,
// so they record spend to an append-only JSONL ledger (out/telemetry/llm_calls.jsonl) via
// runner.recordLlmCall — not the DB. This loader reads that ledger into the llm_calls table
// so the BI views can roll it up. Idempotent: call_id = sha256(line), INSERT OR IGNORE, so
// re-running after more calls only adds the new ones.
//
// Called by both `bun run views` and `bun run bi:refresh` (the two BI-prep entry points)
// right before the views are (re)built.

import type { Database } from "bun:sqlite";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { outDir } from "../core/paths.ts";
import { sha256 } from "../core/util.ts";

const DDL = `
CREATE TABLE IF NOT EXISTS llm_calls (
  call_id                TEXT PRIMARY KEY,
  at                     TEXT,
  phase                  TEXT,
  runner                 TEXT,
  model                  TEXT,
  input_tokens           INTEGER,
  output_tokens          INTEGER,
  cache_read_tokens      INTEGER,
  cache_creation_tokens  INTEGER,
  cost_usd               REAL,
  duration_ms            INTEGER,
  ok                     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_llm_calls_phase ON llm_calls(phase);
CREATE INDEX IF NOT EXISTS idx_llm_calls_at ON llm_calls(at);
`;

export function defaultLedgerPath(): string {
  return join(outDir, "telemetry", "llm_calls.jsonl");
}

// Returns the number of NEW rows inserted (already-loaded lines are skipped).
export function loadLedgerIntoDb(db: Database, ledgerPath = defaultLedgerPath()): number {
  db.exec(DDL); // safe even if schema.sql already created it
  if (!existsSync(ledgerPath)) return 0;

  const raw = readFileSync(ledgerPath, "utf8");
  const insert = db.prepare(`
    INSERT OR IGNORE INTO llm_calls
      (call_id, at, phase, runner, model, input_tokens, output_tokens,
       cache_read_tokens, cache_creation_tokens, cost_usd, duration_ms, ok)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  let inserted = 0;
  const tx = db.transaction((lines: string[]) => {
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let r: any;
      try { r = JSON.parse(trimmed); } catch { continue; } // skip a corrupt line, keep the rest
      const res = insert.run(
        sha256(trimmed),
        r.at ?? null,
        r.phase ?? "other",
        r.runner ?? null,
        r.model ?? null,
        r.input_tokens ?? 0,
        r.output_tokens ?? 0,
        r.cache_read_tokens ?? 0,
        r.cache_creation_tokens ?? 0,
        r.cost_usd ?? 0,
        r.duration_ms ?? 0,
        r.ok === 0 ? 0 : 1
      );
      // bun:sqlite run() returns {changes}; count real inserts (ignored dupes → changes 0)
      if ((res as any)?.changes) inserted += (res as any).changes;
    }
  });
  tx(raw.split("\n"));
  return inserted;
}
