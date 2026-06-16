// paths.ts — robust project-root resolution so file-reads survive the
// domain-based directory layout. Walks UP from this module's directory to the
// nearest ancestor containing a package.json, then derives common paths.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

function findProjectRoot(start: string): string {
  let dir = start;
  while (true) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      // Reached filesystem root without finding package.json — fall back to start.
      return start;
    }
    dir = parent;
  }
}

export const PROJECT_ROOT: string = findProjectRoot(import.meta.dir);
export const promptsDir: string = join(PROJECT_ROOT, "prompts");
export const outDir: string = join(PROJECT_ROOT, "out");
// Default analysis DB. Overridable with MINER_DB so you can keep corpora SEPARATE
// (e.g. MINER_DB=cowork.db for Cowork sessions vs analysis.db for Claude Code) — every
// tool that opens the default DB (pipeline/skillgen/views/refresh) then targets the same
// file. An explicit --db flag still wins over this.
export const defaultDbPath: string =
  process.env.MINER_DB && process.env.MINER_DB.trim()
    ? (process.env.MINER_DB.includes("/") || process.env.MINER_DB.includes("\\")
        ? process.env.MINER_DB.trim()
        : join(PROJECT_ROOT, process.env.MINER_DB.trim()))
    : join(PROJECT_ROOT, "analysis.db");

// Default skills OUTPUT dir. MINER_SKILLS_OUT overrides (mirrors MINER_DB) so a one-session
// run via the fixed `bun run all` chain can isolate its drafted skills away from the committed
// out/skills snapshot. Both skillgen (writes) and skillcheck (reads) resolve through THIS so
// they always agree on where the skills are. A bare name is rooted at PROJECT_ROOT; a path
// (contains / or \) is used as-is. An explicit --out flag still wins over this.
export const skillsOutDir: string =
  process.env.MINER_SKILLS_OUT && process.env.MINER_SKILLS_OUT.trim()
    ? (process.env.MINER_SKILLS_OUT.includes("/") || process.env.MINER_SKILLS_OUT.includes("\\")
        ? process.env.MINER_SKILLS_OUT.trim()
        : join(PROJECT_ROOT, process.env.MINER_SKILLS_OUT.trim()))
    : join(outDir, "skills");
