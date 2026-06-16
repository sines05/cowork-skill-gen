// cowork.ts — Claude Cowork ("local agent mode") log adapter.
//
// VERIFIED EMPIRICALLY on Windows 11 (2026-06-15) — see docs/COWORK_STORAGE.md. The earlier
// version of this file guessed at the layout from docs and was WRONG on three counts; the
// real, observed shape is:
//
//   Root (MSIX Store build):
//     %LOCALAPPDATA%\Packages\Claude_<pubhash>\LocalCache\Roaming\Claude\local-agent-mode-sessions
//   Per session:
//     <root>\<groupId>\<conversationId>\
//       ├── local_<taskId>.json     ← session METADATA (title, model, cwd, account, timestamps)
//       └── local_<taskId>\
//           └── audit.jsonl         ← the VERBATIM TRANSCRIPT (stream-json + HMAC), one JSON/line
//
// So: the transcript is `audit.jsonl` (NOT `local_<taskId>.json`, which is just metadata), and
// each line is the Agent-SDK "stream-json" event shape — close to, but not identical to, the
// Claude Code CLI `.jsonl` shape this pipeline was built on (`session_id` vs `sessionId`,
// `tool_use_result` vs `toolUseResult`, `_audit_timestamp` instead of `timestamp`, plus an
// `_audit_hmac` per line). `normalizeAuditEvent()` maps each line into the canonical RawEvent
// so the rest of the pipeline (classify → segment → signals → judge) runs unchanged.
//
// Override the root for testing on any OS:
//   COWORK_SESSIONS_ROOT=/path/to/local-agent-mode-sessions

import { homedir, platform } from "os";
import { join, basename, dirname } from "path";
import { readdir, stat } from "fs/promises";
import { existsSync, readdirSync } from "fs";
import type { SessionInfo, RawEvent } from "../core/types.ts";
import { readEvents } from "../core/util.ts";
import type { DiscoverOpts } from "./source.ts";

// ── Root resolution ───────────────────────────────────────────────────────────
// Returns every candidate `local-agent-mode-sessions` root for this OS, most-likely first.
// The MSIX package family name carries a publisher hash (`Claude_pzs8sxrjxfjjc` on the
// surveyed machine) that can differ per build, so we GLOB `Packages\Claude_*` rather than
// hardcode it. `COWORK_SESSIONS_ROOT` overrides everything (CI / Linux / mounted logs).
function coworkRoots(): string[] {
  const override = process.env.COWORK_SESSIONS_ROOT;
  if (override) return [override];

  const os = platform();
  const roots: string[] = [];
  const LADM = "local-agent-mode-sessions";

  if (os === "win32") {
    const lad = process.env.LOCALAPPDATA;
    if (lad) {
      // MSIX Store build: %LOCALAPPDATA%\Packages\Claude_<hash>\LocalCache\Roaming\Claude\…
      const pkgsDir = join(lad, "Packages");
      try {
        for (const name of readdirSync(pkgsDir)) {
          if (/^Claude_/i.test(name)) {
            roots.push(join(pkgsDir, name, "LocalCache", "Roaming", "Claude", LADM));
          }
        }
      } catch {
        /* Packages dir unreadable — fall through to other candidates */
      }
      // Documented (older) location used by some 3p builds.
      roots.push(join(lad, "Claude-3p", LADM));
    }
    // Non-MSIX installer keeps data under Roaming.
    const appdata = process.env.APPDATA;
    if (appdata) roots.push(join(appdata, "Claude", LADM));
  } else if (os === "darwin") {
    const base = join(homedir(), "Library", "Application Support");
    roots.push(join(base, "Claude", LADM));
    roots.push(join(base, "Claude-3p", LADM));
  }
  // Linux: Cowork is not distributed for Linux — reachable only via COWORK_SESSIONS_ROOT.
  return roots;
}

// The first candidate root that actually exists on this machine, or null. Exposed so a
// setup helper can auto-fill COWORK_LOGS (the deep `Packages\Claude_<hash>\…` path) instead
// of making the user hunt for it by hand.
export function firstExistingCoworkRoot(): string | null {
  for (const r of coworkRoots()) {
    try {
      if (existsSync(r)) return r;
    } catch {
      /* ignore */
    }
  }
  return null;
}

// Directory names never worth descending into while hunting for `audit.jsonl`.
const PRUNE_DIRS = new Set([
  ".claude", "outputs", "node_modules", ".git", "Cache", "skills-plugin", "blob_storage",
]);

// Walk a root collecting every `audit.jsonl` whose parent dir is a `local_<taskId>` session
// dir. Depth-bounded and prune-listed so we never crawl the agent's output artifacts.
async function findAuditFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 6) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (PRUNE_DIRS.has(e.name)) continue;
        await walk(join(dir, e.name), depth + 1);
      } else if (e.name === "audit.jsonl" && /^local_/i.test(basename(dir))) {
        found.push(join(dir, e.name));
      }
    }
  }
  await walk(root, 0);
  return found;
}

// ── Metadata ──────────────────────────────────────────────────────────────────
interface CoworkMeta {
  title: string;
  cwd: string;
  model: string;
  email: string;
  startedAt: string;
  completedAt: string;
}

function epochMsToIso(ms: unknown): string {
  const n = typeof ms === "number" ? ms : Number(ms);
  if (!Number.isFinite(n) || n <= 0) return "";
  try {
    return new Date(n).toISOString();
  } catch {
    return "";
  }
}

// Read the sibling `local_<taskId>.json` for a session's `local_<taskId>/audit.jsonl`.
// Tolerant: any missing field degrades to a sensible default, never throws.
async function readCoworkMeta(sessionDir: string, fallbackMtimeIso: string): Promise<CoworkMeta> {
  const metaPath = `${sessionDir}.json`; // sibling file, not inside the dir
  let m: any = {};
  try {
    if (existsSync(metaPath)) m = JSON.parse(await Bun.file(metaPath).text());
  } catch {
    /* unreadable/corrupt metadata — use defaults below */
  }
  const startedAt = epochMsToIso(m.createdAt) || fallbackMtimeIso;
  const completedAt = epochMsToIso(m.lastActivityAt) || fallbackMtimeIso;
  return {
    title: typeof m.title === "string" && m.title.trim() ? m.title.trim() : "",
    cwd: typeof m.cwd === "string" ? m.cwd : "",
    model: typeof m.model === "string" ? m.model : "",
    email: typeof m.emailAddress === "string" ? m.emailAddress : "",
    startedAt,
    completedAt,
  };
}

// ── Discovery ───────────────────────────────────────────────────────────────
export async function discoverCoworkSessions(opts?: DiscoverOpts): Promise<SessionInfo[]> {
  const roots = coworkRoots().filter((r) => existsSync(r));
  if (roots.length === 0) {
    console.warn(
      "[cowork] no local-agent-mode-sessions root found " +
        "(Cowork ships on Windows/macOS; on Linux/CI set COWORK_SESSIONS_ROOT)."
    );
    return [];
  }

  const sessions: SessionInfo[] = [];
  for (const root of roots) {
    const auditFiles = await findAuditFiles(root);
    for (const auditPath of auditFiles) {
      const sessionDir = dirname(auditPath); // …\local_<taskId>
      let mtimeIso = "";
      try {
        mtimeIso = (await stat(auditPath)).mtime.toISOString();
      } catch {
        continue;
      }
      const taskId = basename(sessionDir).replace(/^local_/i, "");
      const meta = await readCoworkMeta(sessionDir, mtimeIso);
      const project = meta.title || `cowork-${taskId.slice(0, 8)}`;
      sessions.push({
        sessionId: taskId,
        project,
        projectDir: basename(dirname(sessionDir)), // conversationId
        cwd: meta.cwd,
        jsonlPath: auditPath, // reused field: the path read() will load (the transcript)
        subagentsDir: null,
        startedAt: meta.startedAt,
        completedAt: meta.completedAt,
        accountEmail: meta.email, // Cowork-only provenance (see SessionInfo)
        model: meta.model,
      });
    }
  }

  // Filters — mirror discoverSessions() semantics.
  let result = sessions;
  if (opts?.project) {
    const needle = opts.project.toLowerCase();
    result = result.filter((s) => s.project.toLowerCase().includes(needle));
  }
  if (opts?.session) {
    // Isolate ONE session: exact taskId, or a prefix (logs print an 8-char short id).
    const needle = opts.session.toLowerCase();
    result = result.filter((s) => s.sessionId.toLowerCase().startsWith(needle));
  }
  if (opts?.since) {
    const since = opts.since;
    result = result.filter((s) => s.completedAt && s.completedAt >= since);
  }
  result.sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0));
  if (opts?.limit !== undefined && opts.limit >= 0) result = result.slice(0, opts.limit);
  return result;
}

// ── Reading + normalization ───────────────────────────────────────────────────
export async function readCoworkEvents(session: SessionInfo): Promise<RawEvent[]> {
  // readEvents tolerates malformed lines and reads UTF-8 (Vietnamese content is common).
  const raw = await readEvents(session.jsonlPath);
  const out: RawEvent[] = [];
  for (const e of raw) {
    const ev = normalizeAuditEvent(e, session);
    if (ev) out.push(ev);
  }
  return out;
}

// Map ONE Cowork stream-json audit line into the canonical RawEvent the pipeline expects.
// Verified field mapping (docs/COWORK_STORAGE.md §2b):
//   session_id          → sessionId (we override with the canonical taskId for stable joins)
//   parent_tool_use_id  → parentUuid
//   _audit_timestamp    → timestamp (human/assistant lines carry ONLY this)
//   tool_use_result     → toolUseResult (so isHumanTurn() excludes tool-result user events)
//   _audit_hmac         → auditHmac (provenance / tamper-evidence for compliance)
// `message.content` (assistant tool_use parts, user tool_result parts) is already in the
// exact shape util.ts / signals.ts read, so it passes through untouched.
export function normalizeAuditEvent(e: any, session: SessionInfo): RawEvent | null {
  if (!e || typeof e !== "object" || typeof e.type !== "string") return null;

  const timestamp =
    (typeof e.timestamp === "string" && e.timestamp) ||
    (typeof e._audit_timestamp === "string" && e._audit_timestamp) ||
    "";

  const ev: RawEvent = {
    type: e.type,
    uuid: typeof e.uuid === "string" ? e.uuid : undefined,
    parentUuid: e.parent_tool_use_id ?? null,
    timestamp,
    sessionId: session.sessionId,
    cwd: session.cwd,
    message: e.message,
  };

  // Tool-result user events: surface the result so isHumanTurn() excludes them AND
  // signals.ts can read tool output (e.g. Bash stdout/stderr, pass/fail).
  if (e.tool_use_result !== undefined) ev.toolUseResult = e.tool_use_result;
  if (typeof e._audit_hmac === "string") (ev as any).auditHmac = e._audit_hmac;
  if (typeof e.client_platform === "string") (ev as any).clientPlatform = e.client_platform;

  // system events carry their own subtype + cwd (system/init has the real cwd).
  if (e.type === "system") {
    if (typeof e.subtype === "string") ev.subtype = e.subtype;
    if (typeof e.cwd === "string" && e.cwd) ev.cwd = e.cwd;
  }

  // The terminal `result` line is a goldmine of productivity metrics — preserve them.
  if (e.type === "result") {
    if (typeof e.subtype === "string") ev.subtype = e.subtype;
    if (typeof e.duration_ms === "number") ev.durationMs = e.duration_ms;
    if (typeof e.num_turns === "number") (ev as any).numTurns = e.num_turns;
    if (typeof e.total_cost_usd === "number") (ev as any).totalCostUsd = e.total_cost_usd;
    if (typeof e.result === "string") ev.content = e.result; // final answer text
    if (Array.isArray(e.permission_denials)) {
      (ev as any).permissionDenials = e.permission_denials.length;
    }
  }

  return ev;
}
