// skillhook.ts — Claude Code PostToolUse hook entrypoint (the quality gate).
//
// Wired in .claude/settings.json on Write|Edit. The harness pipes the tool event as JSON on
// stdin; we extract the edited file path and, IF it is a SKILL.md, run the deterministic
// quality check on that skill. On a real FAIL we exit 2 — the harness blocks the action and
// feeds the reasons back to the agent, so a low-quality skill can't be written silently.
// Any non-SKILL.md edit, or unreadable input, exits 0 (no-op) — the hook never gets in the way.

import { dirname } from "path";
import { checkSkill } from "./skillcheck.ts";

async function readStdin(): Promise<string> {
  try {
    return await new Response(Bun.stdin.stream()).text();
  } catch {
    return "";
  }
}

const raw = await readStdin();
let filePath = "";
try {
  const evt = JSON.parse(raw);
  filePath = evt?.tool_input?.file_path || evt?.tool_input?.path || "";
} catch {
  process.exit(0); // no parseable event → nothing to gate
}

if (!/SKILL\.md$/i.test(filePath)) process.exit(0); // only gate skill files

const { name, findings } = checkSkill(dirname(filePath));
const fails = findings.filter((f) => f.level === "FAIL");
if (fails.length === 0) process.exit(0);

// Block: surface the reasons on stderr (the harness shows these to the agent).
console.error(`[skillcheck] BLOCKED ${name} — ${fails.length} quality failure(s):`);
for (const f of fails) console.error(`  ✗ ${f.msg}`);
process.exit(2);
