// source.ts — pluggable log SOURCE abstraction.
//
// The miner was born reading Claude Code CLI transcripts (`~/.claude/projects/<dir>/
// <sessionId>.jsonl`). The real target is **Claude Cowork** logs, which live elsewhere
// and in a different on-disk shape (Windows `%LOCALAPPDATA%\Claude-3p\…`,
// `local_<uuid>.json`). Rather than hardcode one layout, every reader goes through a
// `SessionSource`: discover sessions + read one session's events as `RawEvent[]`. The
// rest of the pipeline (classify → judge → skillgen) is source-agnostic.
//
// Select the source with `--source <name>` / `MINER_SOURCE` (default: claude-code).

import type { SessionInfo, RawEvent } from "../core/types.ts";
import { readEvents } from "../core/util.ts";
import { discoverSessions } from "./discover.ts";
import { discoverCoworkSessions, readCoworkEvents } from "./cowork.ts";

export interface DiscoverOpts {
  project?: string;
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

// Claude Cowork desktop logs (Windows). Adapter is a documented stub until a real
// `local_<uuid>.json` sample fixes the conversation schema — see cowork.ts.
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
