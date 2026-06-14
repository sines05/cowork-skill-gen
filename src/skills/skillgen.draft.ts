// skillgen.draft.ts — Draft shape, validation, coercion, and JSON extraction.
//
// The LLM returns a JSON object; this module parses it tolerantly (fences/prose),
// validates + coerces it into a spec-compliant Draft, and exposes the helpers
// (coerceName, sanitizeFilename, asStrArr, NAME_RE) shared with the gate.

import { slugify } from "../analysis/mine.ts";
import type { RankedCandidate } from "../core/types.ts";

// ── Draft validation + coercion ──────────────────────────────────────────────
export interface ScriptEntry { filename: string; language: string; code: string; }
export interface RefEntry { filename: string; markdown: string; }
export interface EvalCase { name: string; prompt: string; assertions: string[]; }
export interface Draft {
  name: string;
  description: string;
  compatibility: string | null;
  artifact_type: "skill" | "script" | "sop";
  skill_body_markdown: string;
  references: RefEntry[];
  scripts: ScriptEntry[];
  evals: EvalCase[];
  citations: string[];
  guardrails: string[];
  anti_patterns: string[];
  confidence: number;
}

export const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Balanced-brace JSON extractor (tolerates fences / surrounding prose).
export function extractJsonObject(raw: string): string | null {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return null;
}

export function coerceName(raw: any, fallbackLabel: string): string {
  let n = typeof raw === "string" ? raw.toLowerCase().trim() : "";
  if (!NAME_RE.test(n) || n.length > 64) {
    // Derive a safe name from the cluster label (slugify already enforces the charset).
    n = slugify(fallbackLabel).slice(0, 64).replace(/-+$/g, "");
  }
  if (!NAME_RE.test(n)) n = "mined-skill";
  return n.slice(0, 64);
}

export function asStrArr(x: any): string[] {
  return Array.isArray(x) ? x.filter((e) => typeof e === "string") : [];
}

export function validateDraft(obj: any, cand: RankedCandidate): Draft {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw new Error("draft is not a JSON object");
  }
  const name = coerceName(obj.name, cand.label);

  let description = typeof obj.description === "string" ? obj.description.trim() : "";
  if (!description) throw new Error("description missing/empty");
  if (description.length > 1024) description = description.slice(0, 1021) + "…";

  let compatibility: string | null =
    typeof obj.compatibility === "string" && obj.compatibility.trim()
      ? obj.compatibility.trim().slice(0, 500)
      : null;

  const artifact_type =
    obj.artifact_type === "script" || obj.artifact_type === "sop" ? obj.artifact_type : "skill";

  const skill_body_markdown =
    typeof obj.skill_body_markdown === "string" ? obj.skill_body_markdown.trim() : "";
  if (!skill_body_markdown) throw new Error("skill_body_markdown missing/empty");

  const references: RefEntry[] = Array.isArray(obj.references)
    ? obj.references
        .filter((r: any) => r && typeof r.filename === "string" && typeof r.markdown === "string")
        .map((r: any) => ({ filename: sanitizeFilename(r.filename), markdown: String(r.markdown) }))
    : [];

  const scripts: ScriptEntry[] = Array.isArray(obj.scripts)
    ? obj.scripts
        .filter((s: any) => s && typeof s.filename === "string" && typeof s.code === "string")
        .map((s: any) => ({
          filename: sanitizeFilename(s.filename),
          language: typeof s.language === "string" ? s.language : "bash",
          code: String(s.code),
        }))
    : [];

  const evals: EvalCase[] = Array.isArray(obj.evals)
    ? obj.evals
        .filter((e: any) => e && typeof e.prompt === "string")
        .map((e: any, i: number) => ({
          name: typeof e.name === "string" && e.name.trim() ? e.name.trim() : `case-${i + 1}`,
          prompt: String(e.prompt),
          assertions: asStrArr(e.assertions),
        }))
    : [];

  const confidence =
    typeof obj.confidence === "number" && obj.confidence >= 0 && obj.confidence <= 1
      ? obj.confidence
      : 0.3;

  return {
    name,
    description,
    compatibility,
    artifact_type,
    skill_body_markdown,
    references,
    scripts,
    evals,
    citations: asStrArr(obj.citations),
    guardrails: asStrArr(obj.guardrails),
    anti_patterns: asStrArr(obj.anti_patterns),
    confidence,
  };
}

export function sanitizeFilename(f: string): string {
  // keep one path segment, safe charset
  const base = f.split(/[\\/]/).pop() || "file";
  return base.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64) || "file";
}
