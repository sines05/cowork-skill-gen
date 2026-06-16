// discover.ts — enumerate REAL top-level Claude Code coding sessions.
// Excludes nested subagent forks, the bare -Users-alice-Documents bucket,
// and the local-agent-mode / observer buckets (not real coding sessions).
import { homedir } from "os";
import { join, basename } from "path";
import { readdir, stat } from "fs/promises";
import { existsSync } from "fs";
import type { SessionInfo, RawEvent } from "../core/types.ts";
import { readEvents } from "../core/util.ts";

// Where session logs live. Defaults to Claude Code's `~/.claude/projects`, but is
// configurable via MINER_PROJECTS_ROOT so a different source (e.g. exported Cowork
// app logs converted to the same RawEvent .jsonl format) can be pointed at without
// code changes. This is the first seam toward a pluggable source adapter (see
// docs/DATA_FORMAT.md) — the parsing contract is RawEvent in types.ts.
const PROJECTS_ROOT =
  process.env.MINER_PROJECTS_ROOT || join(homedir(), ".claude", "projects");

// The encoded form of the user's HOME dir, e.g. "/home/son" -> "-home-son" (Linux)
// or "/Users/alice" -> "-Users-alice" (macOS). Sessions launched straight from the
// home dir land in this bare bucket and are scratch/misc, not real project work.
// Computed at runtime instead of hardcoded so the miner is portable across machines
// (the old code hardcoded one author's macOS path "-Users-alice-Documents").
const ENCODED_HOME = homedir().replace(/\//g, "-");

// Extra bucket substrings to exclude, supplied via env (comma-separated). Lets an
// operator drop noise buckets without code changes — e.g. MINER_EXCLUDE_BUCKETS=scratch,tmp.
const EXTRA_EXCLUDES = (process.env.MINER_EXCLUDE_BUCKETS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// Set MINER_INCLUDE_HOME=1 to KEEP the bare home bucket (default: exclude it).
const INCLUDE_HOME = process.env.MINER_INCLUDE_HOME === "1";

// Project-dir buckets that are NOT real coding sessions. Portable (no hardcoded
// usernames/paths); tunable via MINER_EXCLUDE_BUCKETS / MINER_INCLUDE_HOME.
function isExcludedBucket(projectDir: string): boolean {
  // bare HOME bucket (no project segment) — matched dynamically, not hardcoded.
  if (!INCLUDE_HOME && projectDir === ENCODED_HOME) return true;
  const lower = projectDir.toLowerCase();
  // observer / local-agent-mode / agent-mode sessions
  if (lower.includes("local-agent-mode-sessions")) return true;
  if (lower.includes("agent-mode")) return true;
  if (lower.includes("observer")) return true;
  // the analyzer's own project — its sessions are meta-work (building this miner),
  // not coding workflows worth mining; excluding avoids self-referential noise.
  if (lower.includes("cowork-logs-analysis")) return true;
  // operator-supplied extra excludes
  if (EXTRA_EXCLUDES.some((sub) => lower.includes(sub))) return true;
  return false;
}

// Decode an encoded project dir name into a best-effort cwd path.
// (Only used as a fallback; the real cwd comes from the first event.)
function decodeProjectDir(projectDir: string): string {
  // "-Users-alice-Documents-usth-tennis-tracking-system" -> "/Users/..."
  return projectDir.replace(/-/g, "/");
}

// Human-readable project name = last path segment of the (decoded) cwd.
function projectNameFromCwd(cwd: string): string {
  const trimmed = cwd.replace(/\/+$/, "");
  const seg = basename(trimmed);
  return seg || trimmed || "unknown";
}

// Pull cwd + first/last timestamps from a session's events.
function sessionTimespan(events: RawEvent[]): {
  cwd: string;
  startedAt: string;
  completedAt: string;
} {
  let cwd = "";
  const tsList: string[] = [];
  for (const ev of events) {
    if (!cwd && typeof ev.cwd === "string" && ev.cwd) cwd = ev.cwd;
    if (typeof ev.timestamp === "string" && ev.timestamp) tsList.push(ev.timestamp);
  }
  return {
    cwd,
    startedAt: tsList.length ? tsList[0] : "",
    completedAt: tsList.length ? tsList[tsList.length - 1] : "",
  };
}

export async function discoverSessions(opts?: {
  project?: string;
  session?: string;
  since?: string;
  limit?: number;
}): Promise<SessionInfo[]> {
  const sessions: SessionInfo[] = [];

  let projectDirs: string[] = [];
  try {
    const entries = await readdir(PROJECTS_ROOT, { withFileTypes: true });
    projectDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }

  for (const projectDir of projectDirs) {
    if (isExcludedBucket(projectDir)) continue;
    const dirPath = join(PROJECTS_ROOT, projectDir);

    let files: string[];
    try {
      files = await readdir(dirPath);
    } catch {
      continue;
    }

    for (const file of files) {
      // Only top-level <sessionId>.jsonl files; subagent forks live under
      // <sessionId>/subagents/ and are never directly enumerated here.
      if (!file.endsWith(".jsonl")) continue;
      const jsonlPath = join(dirPath, file);

      // Defensive: skip if this path is somehow nested under a subagents dir.
      if (jsonlPath.includes(`${"/subagents/"}`)) continue;

      let st;
      try {
        st = await stat(jsonlPath);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;

      const sessionId = file.slice(0, -".jsonl".length);

      let events: RawEvent[];
      try {
        events = await readEvents(jsonlPath);
      } catch {
        continue;
      }
      if (events.length === 0) continue;

      const { cwd: cwdFromEvents, startedAt, completedAt } = sessionTimespan(events);
      const cwd = cwdFromEvents || decodeProjectDir(projectDir);
      const project = projectNameFromCwd(cwd);

      // sibling <sessionId>/subagents dir, if present
      const subDir = join(dirPath, sessionId, "subagents");
      const subagentsDir = existsSync(subDir) ? subDir : null;

      sessions.push({
        sessionId,
        project,
        projectDir,
        cwd,
        jsonlPath,
        subagentsDir,
        startedAt,
        completedAt,
      });
    }
  }

  // Filters
  let result = sessions;
  if (opts?.project) {
    const needle = opts.project.toLowerCase();
    result = result.filter((s) => s.project.toLowerCase().includes(needle));
  }
  if (opts?.session) {
    // Isolate ONE session: exact sessionId, or a prefix (the CLI prints an 8-char short id).
    const needle = opts.session.toLowerCase();
    result = result.filter((s) => s.sessionId.toLowerCase().startsWith(needle));
  }
  if (opts?.since) {
    const since = opts.since;
    result = result.filter((s) => s.completedAt && s.completedAt >= since);
  }

  // Sort by startedAt ascending (empty timestamps sort first/stable).
  result.sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0));

  if (opts?.limit !== undefined && opts.limit >= 0) {
    result = result.slice(0, opts.limit);
  }
  return result;
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (import.meta.main) {
  const args = process.argv.slice(2);
  const opts: { project?: string; session?: string; since?: string; limit?: number } = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--project") opts.project = args[++i];
    else if (a === "--session") opts.session = args[++i];
    else if (a === "--since") opts.since = args[++i];
    else if (a === "--limit") opts.limit = Number(args[++i]);
  }

  const sessions = await discoverSessions(opts);
  for (const s of sessions) {
    let size = 0;
    try {
      size = (await stat(s.jsonlPath)).size;
    } catch {
      /* ignore */
    }
    const sizeKb = (size / 1024).toFixed(0).padStart(7);
    const shortId = s.sessionId.slice(0, 8);
    const proj = s.project.slice(0, 30).padEnd(30);
    const started = (s.startedAt || "—").slice(0, 19).padEnd(19);
    console.log(`${proj}  ${shortId}  ${started}  ${sizeKb} KB`);
  }
  console.log(`\nTotal: ${sessions.length} sessions`);
}
