// classify.llm.ts — optional cheap `claude -p` batch pass over still-ambiguous
// new_task boundaries, used by classify.ts behind opts.classifyLlm.
import { join } from "path";
import type { TurnRole } from "../core/types.ts";
import { runnerEnv, resolveBin, modelTier } from "../llm/runner.ts";
import { promptsDir } from "../core/paths.ts";

// ── Optional LLM batch pass ───────────────────────────────────────────────────
export interface LlmCandidate {
  idx: number;
  text: string;
  gapSeconds: number;
  topicOverlap: number;
}

export async function runClassifyLlm(
  priorTask: string,
  candidates: LlmCandidate[],
  timeoutMs = 60000
): Promise<Map<number, TurnRole>> {
  const result = new Map<number, TurnRole>();
  if (candidates.length === 0) return result;

  let rubric = "";
  try {
    const promptPath = join(promptsDir, "classify.md");
    rubric = await Bun.file(promptPath).text();
  } catch {
    return result; // no rubric, skip silently
  }

  const payload = {
    priorTask,
    turns: candidates.map((c) => ({
      idx: c.idx,
      text: c.text.slice(0, 600),
      gapSeconds: Math.round(c.gapSeconds),
      topicOverlap: Number(c.topicOverlap.toFixed(2)),
    })),
  };
  const prompt = `${rubric}\n\n## INPUT\n${JSON.stringify(payload)}\n`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const proc = Bun.spawn(
      [resolveBin("claude"), "-p", "--output-format", "json", "--model", modelTier("cheap")],
      {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      signal: ctrl.signal,
      env: { ...process.env, ...(await runnerEnv()) },
    });
    proc.stdin.write(prompt);
    await proc.stdin.end();
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    clearTimeout(timer);

    const envelope = JSON.parse(out);
    const inner = typeof envelope?.result === "string" ? envelope.result : out;
    // tolerate code fences / surrounding prose: grab the first JSON array
    const match = inner.match(/\[[\s\S]*\]/);
    const arr = JSON.parse(match ? match[0] : inner);
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (
          item &&
          typeof item.idx === "number" &&
          (item.role === "new_task" ||
            item.role === "correction" ||
            item.role === "continuation")
        ) {
          result.set(item.idx, item.role as TurnRole);
        }
      }
    }
  } catch {
    clearTimeout(timer);
    // fall back to heuristic/signal labels — never throw
  }
  return result;
}
