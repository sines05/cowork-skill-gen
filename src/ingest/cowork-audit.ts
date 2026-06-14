// cowork-audit.ts — reader for Cowork's per-session `audit.jsonl`.
//
// Cowork writes, alongside each session, an append-only `…/<sessionId>/audit.jsonl`
// (HMAC-chained) of "tool invocations, permission decisions, file operations"
// (verified from claude.com/docs/cowork/3p/data-storage). This is NOT the conversation
// transcript (that's `local_<uuid>.json` — see cowork.ts), but it is a clean, structured
// signal source: which tools ran, what was allowed/denied, which files were touched.
//
// STATUS: the audit EVENT schema is not published, so `summarizeAudit()` is a TOLERANT
// mapper (like mapCoworkConversation) — it sniffs several plausible field names and never
// throws. Lock it against one real `audit.jsonl`. Integration point: the Cowork source can
// call `loadAuditSummary(sessionDir)` and feed the result into signals/features per episode.

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

// Tolerant field sniffers — Cowork's exact keys are unknown, so accept the common shapes.
function pick<T = string>(o: any, keys: string[]): T | undefined {
  for (const k of keys) if (o && o[k] != null) return o[k];
  return undefined;
}

function eventKind(e: any): string {
  return String(
    pick(e, ["type", "kind", "event", "action", "category"]) ?? ""
  ).toLowerCase();
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
    const kind = eventKind(e);

    // tool invocation
    const tool = pick(e, ["tool", "tool_name", "toolName", "name"]);
    if (tool && (kind.includes("tool") || kind.includes("invoc") || !kind)) {
      if (tools.length === 0 || tools[tools.length - 1] !== tool) tools.push(String(tool));
    }

    // permission decision
    const decision = String(pick(e, ["decision", "permission", "result", "outcome"]) ?? "").toLowerCase();
    if (kind.includes("permission") || decision) {
      if (/deny|denied|reject|block/.test(decision)) denials++;
      else if (/allow|approved|grant|accept/.test(decision)) allows++;
    }

    // file operation
    const fileOp = String(pick(e, ["operation", "op", "fileOp", "action"]) ?? "").toLowerCase();
    const path = pick(e, ["path", "file", "file_path", "filePath", "target"]);
    if (path && (kind.includes("file") || fileOp)) {
      const p = String(path);
      if (/write|create|modif|edit|append/.test(fileOp)) written.add(p);
      else if (/delete|remov|unlink/.test(fileOp)) deleted.add(p);
      else if (/read|open|stat/.test(fileOp)) read.add(p);
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

// Load + summarize the audit.jsonl that sits next to a Cowork session, if present.
// `sessionDir` is the `…/<sessionId>/` directory. Returns null when absent/unreadable.
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
