// cowork.ts — Claude Cowork (desktop) log adapter.
//
// VERIFIED FROM DOCS (claude.com/docs/cowork/3p/data-storage):
//   Base dir:  Windows  %LOCALAPPDATA%\Claude-3p\        macOS  ~/Library/Application Support/Claude-3p/
//   Cowork conversation history lives under `local-agent-mode-sessions/`, one
//   `local_<uuid>.json` file (a single JSON, NOT JSONL) plus a working dir per session,
//   scoped by account/org. (There is also a per-session `audit.jsonl` of tool/permission
//   events — useful later for signals, but it is NOT the conversation transcript.)
//
// STATUS: the FOLDER layout above is documented and implemented here; the INTERNAL schema
// of `local_<uuid>.json` is NOT documented. `mapCoworkConversation()` below is a tolerant
// best-effort mapper that needs ONE real sample to finalise. It never throws — on an
// unrecognised shape it warns and returns []. Drop a real `local_<uuid>.json` in and point
// COWORK_SESSIONS_ROOT at it (or run on Windows) to validate/lock the mapping.
//
// Override the root for testing on any OS:  COWORK_SESSIONS_ROOT=/path/to/local-agent-mode-sessions

import { homedir, platform } from "os";
import { join, basename } from "path";
import { readdir, stat } from "fs/promises";
import type { SessionInfo, RawEvent } from "../core/types.ts";
import type { DiscoverOpts } from "./source.ts";

// Resolve the Cowork sessions root for the current OS (or the explicit override).
function coworkSessionsRoot(): string | null {
  const override = process.env.COWORK_SESSIONS_ROOT;
  if (override) return override;
  const os = platform();
  if (os === "win32") {
    const lad = process.env.LOCALAPPDATA;
    if (!lad) return null;
    return join(lad, "Claude-3p", "local-agent-mode-sessions");
  }
  if (os === "darwin") {
    return join(homedir(), "Library", "Application Support", "Claude-3p", "local-agent-mode-sessions");
  }
  // Linux: Cowork is not distributed for Linux — only via override (e.g. mounted logs).
  return null;
}

export async function discoverCoworkSessions(opts?: DiscoverOpts): Promise<SessionInfo[]> {
  const root = coworkSessionsRoot();
  if (!root) {
    console.warn(
      "[cowork] no sessions root (Cowork ships on Windows/macOS; on Linux set COWORK_SESSIONS_ROOT)."
    );
    return [];
  }

  // Sessions may be nested (scoped by account/org). Walk for `local_<uuid>.json` files.
  const files: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 4) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p, depth + 1);
      else if (/^local_.*\.json$/i.test(e.name)) files.push(p);
    }
  }
  await walk(root, 0);

  const sessions: SessionInfo[] = [];
  for (const jsonPath of files) {
    let st;
    try {
      st = await stat(jsonPath);
    } catch {
      continue;
    }
    const sessionId = basename(jsonPath).replace(/^local_/, "").replace(/\.json$/i, "");
    const ts = st.mtime.toISOString();
    sessions.push({
      sessionId,
      project: "cowork", // refined from the working dir once the schema is known
      projectDir: root,
      cwd: "",
      jsonlPath: jsonPath, // reused field: the path the reader will load
      subagentsDir: null,
      startedAt: ts,
      completedAt: ts,
    });
  }

  let result = sessions;
  if (opts?.since) result = result.filter((s) => s.completedAt && s.completedAt >= opts.since!);
  result.sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0));
  if (opts?.limit !== undefined && opts.limit >= 0) result = result.slice(0, opts.limit);
  return result;
}

export async function readCoworkEvents(session: SessionInfo): Promise<RawEvent[]> {
  let raw: any;
  try {
    raw = JSON.parse(await Bun.file(session.jsonlPath).text());
  } catch (e) {
    console.warn(`[cowork] cannot parse ${session.jsonlPath}: ${(e as Error).message}`);
    return [];
  }
  return mapCoworkConversation(raw, session.sessionId);
}

// Tolerant mapper: Cowork stores ONE JSON per session. We don't have the official schema,
// so we look for a conversation/messages array under several plausible keys and map each
// {role, content} into the RawEvent shape the rest of the pipeline already understands
// (type:"user"/"assistant", message:{role,content}). Replace/lock this once a real sample
// confirms the exact field names.
export function mapCoworkConversation(raw: any, sessionId: string): RawEvent[] {
  const arr =
    (Array.isArray(raw) && raw) ||
    raw?.messages ||
    raw?.conversation ||
    raw?.events ||
    raw?.turns ||
    raw?.history ||
    null;
  if (!Array.isArray(arr)) {
    console.warn(
      `[cowork] unrecognised conversation schema in session ${sessionId} — ` +
        `no messages/conversation/events/turns array found. Provide a real sample to finalise the mapper.`
    );
    return [];
  }
  const out: RawEvent[] = [];
  for (const m of arr) {
    if (!m || typeof m !== "object") continue;
    const role = m.role || m.sender || m.author;
    const type = role === "assistant" || role === "model" ? "assistant" : "user";
    const content = m.content ?? m.text ?? m.message ?? "";
    out.push({
      type,
      uuid: typeof m.id === "string" ? m.id : `${sessionId}#${out.length}`,
      timestamp: typeof m.timestamp === "string" ? m.timestamp : m.created_at,
      message: { role: role ?? type, content },
      sessionId,
    } as RawEvent);
  }
  return out;
}
