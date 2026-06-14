// cowork-audit.ts — summarize Cowork's per-session `audit.jsonl`.
//
// IMPORTANT (corrected 2026-06-15 against real logs — docs/COWORK_STORAGE.md):
// `audit.jsonl` IS the verbatim conversation transcript (stream-json events, one JSON per
// line, each HMAC-signed via `_audit_hmac`). It is the SAME file cowork.ts ingests as the
// session transcript — not a separate tool-only log. This module is an auxiliary roll-up:
// given the (raw or normalized) audit events, it produces a compact per-session AuditSummary
// — tool sequence, file touches, permission denials — handy for signals/features or a quick
// CLI smoke. The conversation itself flows through the normal pipeline via cowork.ts.
//
// Tool/file facts live in the assistant `tool_use` parts and the terminal `result` line,
// verified shapes:
//   assistant.message.content[] : { type:"tool_use", name, input:{ file_path|path|command, … } }
//   result                      : { permission_denials: [...] }

import { join } from "path";
import { readEvents } from "../core/util.ts";
import type { RawEvent } from "../core/types.ts";

export interface AuditSummary {
  nEvents: number;
  toolSequence: string; // compact arrow string of tool names, collapsed repeats
  nToolCalls: number;
  permissionDenials: number;
  permissionAllows: number;
  filesRead: string[];
  filesWritten: string[];
  filesDeleted: string[];
}

// Tool name → rough file-operation class, for the file-touch roll-up.
const READ_TOOLS = new Set(["Read", "Glob", "Grep", "NotebookRead"]);
const WRITE_TOOLS = new Set(["Write", "Edit", "NotebookEdit", "MultiEdit"]);

function toolUseParts(e: any): Array<{ name: string; input: any }> {
  const c = e?.message?.content;
  if (!Array.isArray(c)) return [];
  return c
    .filter((p: any) => p && p.type === "tool_use" && typeof p.name === "string")
    .map((p: any) => ({ name: p.name as string, input: p.input ?? {} }));
}

export function summarizeAudit(events: RawEvent[]): AuditSummary {
  const tools: string[] = [];
  let denials = 0;
  let allows = 0;
  const read = new Set<string>();
  const written = new Set<string>();
  const deleted = new Set<string>();

  for (const e of events as any[]) {
    if (!e || typeof e !== "object") continue;

    // Tool invocations come from assistant tool_use parts.
    if (e.type === "assistant") {
      for (const { name, input } of toolUseParts(e)) {
        if (tools.length === 0 || tools[tools.length - 1] !== name) tools.push(name);
        const path = input?.file_path ?? input?.path;
        if (typeof path === "string" && path) {
          if (WRITE_TOOLS.has(name)) written.add(path);
          else if (READ_TOOLS.has(name)) read.add(path);
        }
        // Bash deletions are best-effort from the command text.
        if (name === "Bash" && typeof input?.command === "string") {
          for (const m of input.command.matchAll(/\brm\s+(?:-\w+\s+)*([^\s;|&]+)/g)) {
            deleted.add(m[1]!);
          }
        }
      }
    }

    // Permission decisions: the terminal `result` line carries the denial list; allows are
    // approximated by successful tool results (every tool_result that isn't an error).
    if (e.type === "result" && Array.isArray(e.permission_denials)) {
      denials += e.permission_denials.length;
    }
    if (e.type === "user") {
      const parts = Array.isArray(e?.message?.content) ? e.message.content : [];
      for (const p of parts) {
        if (p && p.type === "tool_result") {
          if (p.is_error) denials++;
          else allows++;
        }
      }
    }
  }

  return {
    nEvents: events.length,
    toolSequence: tools.slice(0, 40).join(">"),
    nToolCalls: tools.length,
    permissionDenials: denials,
    permissionAllows: allows,
    filesRead: [...read],
    filesWritten: [...written],
    filesDeleted: [...deleted],
  };
}

// Load + summarize the audit.jsonl for a Cowork session dir (`…/local_<taskId>/`).
// Returns null when absent/unreadable. (cowork.ts already ingests the same file as the
// transcript; this is for optional per-session signal enrichment.)
export async function loadAuditSummary(sessionDir: string): Promise<AuditSummary | null> {
  const path = join(sessionDir, "audit.jsonl");
  try {
    const events = await readEvents(path); // JSONL parser, skips bad lines, never throws
    if (events.length === 0) return null;
    return summarizeAudit(events);
  } catch {
    return null;
  }
}

// ── CLI smoke: summarize an audit.jsonl ───────────────────────────────────────
// Usage: bun run src/ingest/cowork-audit.ts <path/to/audit.jsonl>
if (import.meta.main) {
  const p = process.argv[2];
  if (!p) {
    console.error("usage: bun run src/ingest/cowork-audit.ts <audit.jsonl>");
    process.exit(2);
  }
  const events = await readEvents(p);
  console.log(JSON.stringify(summarizeAudit(events), null, 2));
}
