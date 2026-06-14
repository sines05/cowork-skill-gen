// classify.overlap.ts — topic/keyword overlap machinery used by classify.ts.
// Unicode-aware tokenizer + containment scoring + assistant-window keywords.
import type { RawEvent } from "../core/types.ts";

// ── Topic / file overlap signals ──────────────────────────────────────────────
export const STOPWORDS = new Set([
  "the","a","an","and","or","but","to","of","in","on","for","with","is","it",
  "this","that","i","you","we","u","me","my","your","can","should","add","also",
  "do","it","let","make","update","use","using","need","want","will","be","are",
  "now","just","some","each","its","have","has","not","no","yes","go","ok","fix",
]);

export function keywordsOf(text: string): Set<string> {
  const out = new Set<string>();
  // Unicode-aware split: the old ASCII class /[^a-z0-9_./]+/ shredded Vietnamese
  // words at every diacritic ("kiểm tra hệ thống" kept only "tra"), so containment
  // never fired on non-English turns. \p{L}\p{N} keep accented letters intact while
  // still splitting on spaces/punctuation; toLowerCase handles Vietnamese casing.
  for (const w of text.toLowerCase().split(/[^\p{L}\p{N}_./]+/u)) {
    if (w.length < 3) continue;
    if (STOPWORDS.has(w)) continue;
    out.add(w);
  }
  return out;
}

// Containment of `turn` in `window`: fraction of the TURN's keywords that also
// appear in the in-progress episode window. Asymmetric on purpose — the episode
// window is large (accumulated assistant prose), so Jaccard would dilute to ~0.
// We care whether the turn's content is ABOUT the in-progress work.
export function containment(turn: Set<string>, window: Set<string>): number {
  if (turn.size === 0 || window.size === 0) return 0;
  let inter = 0;
  for (const x of turn) if (window.has(x)) inter++;
  return inter / turn.size;
}

// Collect file paths + tool keywords from assistant tool_use events in a window.
export function windowKeywords(events: RawEvent[], lo: number, hi: number): Set<string> {
  const out = new Set<string>();
  for (let i = lo; i < hi && i < events.length; i++) {
    const ev = events[i];
    if (ev.type === "assistant") {
      const content = ev.message?.content;
      if (Array.isArray(content)) {
        for (const part of content) {
          if (part?.type === "text" && typeof part.text === "string") {
            for (const k of keywordsOf(part.text)) out.add(k);
          } else if (part?.type === "tool_use") {
            const input = part.input || {};
            const fp: string | undefined = input.file_path || input.path;
            if (fp) {
              for (const seg of String(fp).split(/[/.]/)) {
                if (seg.length >= 3 && !STOPWORDS.has(seg.toLowerCase()))
                  out.add(seg.toLowerCase());
              }
            }
            if (typeof input.command === "string") {
              for (const k of keywordsOf(input.command)) out.add(k);
            }
          }
        }
      }
    }
  }
  return out;
}

export function tsToMs(ts: string | undefined): number {
  if (!ts) return NaN;
  const n = Date.parse(ts);
  return Number.isNaN(n) ? NaN : n;
}
