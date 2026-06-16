// source.ts — pluggable log SOURCE abstraction.
//
// The miner was born reading Claude Code CLI transcripts (`~/.claude/projects/<dir>/
// <sessionId>.jsonl`). The real target is **Claude Cowork** logs, which live elsewhere
// and in a different on-disk shape (Windows MSIX package →
// `…\Packages\Claude_<hash>\LocalCache\Roaming\Claude\local-agent-mode-sessions\…\audit.jsonl`,
// the Agent-SDK stream-json shape; see docs/COWORK_STORAGE.md). Rather than hardcode one
// layout, every reader goes through a `SessionSource`: discover sessions + read one
// session's events as `RawEvent[]`, normalized to the canonical shape. The rest of the
// pipeline (classify → judge → skillgen) is source-agnostic.
//
// Select the source with `--source <name>` / `MINER_SOURCE` (default: claude-code).

import type { SessionInfo, RawEvent } from "../core/types.ts";
import { readEvents } from "../core/util.ts";
import { discoverSessions } from "./discover.ts";
import { discoverCoworkSessions, readCoworkEvents } from "./cowork.ts";

export interface DiscoverOpts {
  project?: string;
  session?: string; // sessionId — exact match or prefix (e.g. the 8-char short id from logs)
  since?: string;
  limit?: number;
}

export interface SessionSource {
  readonly name: string;
  discover(opts?: DiscoverOpts): Promise<SessionInfo[]>;
  read(session: SessionInfo): Promise<RawEvent[]>;
}

// Claude Code CLI transcripts (the original, fully-implemented source).
export const claudeCodeSource: SessionSource = {
  name: "claude-code",
  discover: (opts) => discoverSessions(opts),
  read: (session) => readEvents(session.jsonlPath),
};

// Claude Cowork desktop logs (Windows/macOS). Reads each session's `audit.jsonl`
// transcript and normalizes the stream-json events to RawEvent — verified against real
// logs, see cowork.ts / docs/COWORK_STORAGE.md.
export const coworkSource: SessionSource = {
  name: "cowork",
  discover: (opts) => discoverCoworkSessions(opts),
  read: (session) => readCoworkEvents(session),
};

const SOURCES: Record<string, SessionSource> = {
  "claude-code": claudeCodeSource,
  cowork: coworkSource,
};

export function getSource(name?: string): SessionSource {
  const n = (name ?? process.env.MINER_SOURCE ?? "claude-code").toLowerCase();
  const src = SOURCES[n];
  if (!src) {
    throw new Error(`unknown source "${n}" (known: ${Object.keys(SOURCES).join(", ")})`);
  }
  return src;
}
