# Windows storage map — Cowork / Desktop / CLI (VERIFIED on real machine)

Empirically surveyed on Windows 11 (2026-06-15) by walking the filesystem. This complements
[`DATA_FORMAT.md`](./DATA_FORMAT.md) (which covers the **CLI** `~/.claude/projects/*.jsonl`
schema). The headline: **Cowork keeps a verbatim, HMAC-signed transcript on disk** that the
current capture (`discover.ts`) does **not** read yet.

## TL;DR

| Surface | Where the transcript lives | Format | Captured today? |
|---|---|---|---|
| **Claude Code (CLI)** | `C:\Users\<U>\.claude\projects\<encodedCwd>\<uuid>.jsonl` | CLI JSONL (see DATA_FORMAT.md) | ✅ yes |
| **Claude Cowork** ("local agent mode") | `…\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\local-agent-mode-sessions\<g>\<c>\local_<task>\audit.jsonl` | **stream-json + audit HMAC** | ❌ **no — new source** |
| **Claude Desktop** (normal chat) | `…\LocalCache\Roaming\Claude\IndexedDB\https_claude.ai_0.indexeddb.leveldb\` | LevelDB (binary, cloud-synced) | ❌ skip (not worth it) |

> ⚠️ `discover.ts` currently **excludes** the `local-agent-mode-sessions` bucket as noise.
> That exclusion is correct for the *CLI* `~/.claude/projects` tree (those are nested,
> duplicate observer dirs) but it means **real Cowork sessions are not captured at all**.
> Cowork's true transcript is the `audit.jsonl` in the packaged-app path above — a different
> root entirely.

## 1. Claude Code CLI (standalone)
```
C:\Users\<U>\.claude\
├── projects\<encodedCwd>\<sessionUuid>.jsonl   ← transcript (per DATA_FORMAT.md)
├── sessions\<n>.json , history.jsonl
└── settings.json , .credentials.json , plugins\ , shell-snapshots\ , file-history\
```
Encoding of `<encodedCwd>`: `C:\Users\Nguyen Son\cowork-skill-gen` → `C--Users-Nguyen-Son-cowork-skill-gen`.

## 2. Claude Cowork — the packaged (MSIX) app

Package family: `Claude_pzs8sxrjxfjjc`. MSIX redirects `%APPDATA%\Claude` into
`…\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\`. (Paths *inside* the JSON still
print as `C:\Users\<U>\AppData\Roaming\Claude\…` — the virtualized view.)

```
LocalCache\Roaming\Claude\
├── local-agent-mode-sessions\         ← COWORK lives here
│   ├── <groupId>\<conversationId>\
│   │   ├── local_<taskId>.json        ← session METADATA (not the transcript)
│   │   ├── cowork-*-cache.json        ← caches
│   │   └── local_<taskId>\
│   │       ├── audit.jsonl            ← ★ VERBATIM TRANSCRIPT (+ _audit_hmac) ★
│   │       ├── .audit-key             ← HMAC signing key
│   │       ├── outputs\               ← agent cwd; produced artifacts (.py/.xsd/.md/...)
│   │       └── .claude\               ← a per-task Claude Code home (.claude.json, sessions\)
│   └── skills-plugin\…                ← Anthropic skills injected (consolidate-memory, etc.)
├── claude-code\2.1.170\claude.exe     ← bundled CLI (Cowork runs Claude Code underneath)
├── claude-code-sessions\ , claude-code-vm\
└── IndexedDB\ , Local Storage\ , Cache\ , logs\ (Electron)
```

### 2a. `local_<taskId>.json` — session metadata (join key)
Useful fields: `sessionId, cliSessionId, cwd, model, title, createdAt, lastActivityAt,
permissionMode, accountName, emailAddress, systemPrompt, memoryEnabled, skillsEnabled,
pluginsEnabled, webFetchAllowedUrls, initialMessage, slashCommands`.
→ gives **identity (email), task title, model, wall-clock duration** for Utilization/Productivity.
Real sample: `title="Vinhomes market research"`, `model="claude-sonnet-4-6"`.

### 2b. `audit.jsonl` — the transcript (schema differs from CLI!)
One JSON object per line. This is the **Agent SDK stream-json** shape, NOT the CLI
`projects/*.jsonl` shape. Per-line audit envelope: `_audit_timestamp` (ISO) + `_audit_hmac`
(tamper-evident, signed with `.audit-key`).

Event `type` distribution in one real session: `system×27, assistant×20, user×17,
rate_limit_event×2, result×1`.

Field-name differences vs CLI (DATA_FORMAT.md) — a normalizer is required, not a drop-in:

| Concept | CLI `projects/*.jsonl` | Cowork `audit.jsonl` |
|---|---|---|
| session id | `sessionId` | `session_id` |
| threading | `parentUuid` | `parent_tool_use_id` |
| tool result payload | `toolUseResult` | `tool_use_result` |
| origin marker | (n/a) | `client_platform:"desktop_app"` |
| audit | (n/a) | `_audit_timestamp`, `_audit_hmac`, `request_id` |
| per-turn timing | `system/turn_duration` | `result.duration_ms / ttft_ms / num_turns` |

- `assistant.message.content[]` parts include `thinking` (`{type:"thinking",thinking,signature}`),
  `text`, and `tool_use`. `message.usage` has the token counts; `message.model` the model id.
- `user` tool-result events carry `tool_use_result` + `timestamp`.
- `system/init` enumerates the full Cowork tool surface (see §4).
- `result` (one per task) has `subtype, is_error, duration_ms, duration_api_ms, ttft_ms,
  num_turns, result` (final answer text). **Direct productivity metrics.**
- Content is **UTF-8** (Vietnamese). A console may show mojibake; the file is fine — read UTF-8.

## 3. Claude Desktop (normal chat) — skip
Chat history is in `IndexedDB\https_claude.ai_0.indexeddb.leveldb\*.{ldb,log}` + `Local
Storage\leveldb` — binary LevelDB, claude.ai content, cloud-synced, no local audit trail.
Parsing cost is high and Cowork+CLI already cover the behavior-mining use case. Out of scope.

## 4. Bonus: capabilities Cowork already ships (from `system/init`)
These reduce build scope — several things we assumed we'd build already exist:

| Capability | Tool / skill | Relevance |
|---|---|---|
| Read transcripts via API | MCP `session_info__read_transcript`, `list_sessions` | clean capture path **without** parsing files — call MCP inside Cowork |
| Scheduler | MCP `scheduled-tasks__{create,list,update}` | trigger meta-agent (the "Routines") — built-in |
| Memory consolidation | skill `anthropic-skills:consolidate-memory` | Anthropic's own memory-distill skill |
| Skill authoring | skill `skill-creator` | helps emit SKILL.md |
| Computer / browser control | MCP `computer-use__*`, `Claude_in_Chrome__*` | relevant to "capture non-AI actions" requirement |

## 5. Integration status in this repo
Implemented and verified end-to-end (2026-06-15) — `bun run pipeline.ts --source cowork`:
1. ✅ **Cowork discover path** — `src/ingest/cowork.ts` globs `…\Packages\Claude_*\LocalCache\Roaming\Claude\local-agent-mode-sessions\**\local_*\audit.jsonl` (package-hash-agnostic; `COWORK_SESSIONS_ROOT` overrides), pairing each with its `local_<task>.json` metadata (title→project, cwd, model, email, epoch-ms timestamps).
2. ✅ **`audit.jsonl` normalizer** — `normalizeAuditEvent()` maps stream-json → canonical RawEvent (`session_id`→`sessionId`, `tool_use_result`→`toolUseResult`, `_audit_timestamp`→`timestamp`, thread on `parent_tool_use_id`); `_audit_hmac` carried through as `auditHmac`.
3. ✅ **Productivity metrics** — `result.duration_ms / num_turns / total_cost_usd` preserved on the terminal event; `accountEmail` + `model` surfaced on `SessionInfo` for per-person utilization in BI.
4. ✅ **Verified** — 4 real sessions mined: human prompts (Vietnamese), MCP tool sequences (`mcp__Claude_in_Chrome__*`, `mcp__workspace__bash`), and durations all extracted; 0 errors.

### Still open (future work)
- [ ] **Persist `accountEmail`/`model`** into the `sessions` table + BI views (utilization per person) — currently surfaced on `SessionInfo` but not yet stored.
- [ ] **Evaluate `mcp__session_info__read_transcript`** as a layout-independent capture API (vs. reading files).
- [ ] Confirm `audit.jsonl` append cadence (real-time vs. flush-on-end) for near-real-time capture.
- [ ] HMAC verification recipe using `.audit-key` (if integrity proof is required).
- [ ] Path on a **non-MSIX** (.exe installer) Cowork build — package family name may differ (the resolver already also tries `%APPDATA%\Claude` and `Claude-3p`).

### Still to verify
- [ ] Does `audit.jsonl` append in real time, or flush at task end? (watch file length while running)
- [ ] HMAC verification recipe using `.audit-key` (if integrity proof is required)
- [ ] Path on a **non-MSIX** (.exe installer) Cowork build — package family name may differ
- [ ] Live call of `session_info__read_transcript` — output shape & coverage

## Quick-reference paths
```text
CLI transcript:    C:\Users\<U>\.claude\projects\<encodedCwd>\<uuid>.jsonl
Cowork metadata:   …\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\local-agent-mode-sessions\<g>\<c>\local_<task>.json
Cowork transcript: …\local-agent-mode-sessions\<g>\<c>\local_<task>\audit.jsonl
Desktop chat:      …\LocalCache\Roaming\Claude\IndexedDB\https_claude.ai_0.indexeddb.leveldb\   (LevelDB — skip)
```
