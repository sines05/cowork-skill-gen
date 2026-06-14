// skillgen.gate.ts — Gate 2-A: static checks (cheap, no LLM).
//
// Frontmatter validity, grounding-by-citation, non-triviality, anti-hardcode /
// leakage re-scan of the GENERATED artifact, safety guardrails, and style flags.

import { redactText } from "../core/redact.ts";
import { NAME_RE, type Draft } from "./skillgen.draft.ts";
import type { Evidence } from "./skillgen.evidence.ts";

// ── Gate 2-A: static checks (cheap, no LLM) ──────────────────────────────────
export type GateStatus = "pass" | "warn" | "reject";
export interface GateResult { status: GateStatus; issues: string[]; }

export function gate2A(draft: Draft, ev: Evidence, members: string[]): GateResult {
  const issues: string[] = [];
  let reject = false;
  let warn = false;

  // 1. Frontmatter validity (spec).
  if (!NAME_RE.test(draft.name) || draft.name.length > 64) {
    issues.push("REJECT: name violates spec ([a-z0-9-], ≤64)"); reject = true;
  }
  if (!draft.description || draft.description.length > 1024) {
    issues.push("REJECT: description empty or >1024"); reject = true;
  }
  if (draft.compatibility && draft.compatibility.length > 500) {
    issues.push("WARN: compatibility >500 (truncated)"); warn = true;
  }

  // 2. Grounding: ≥1 citation must resolve to a real exemplar/friction/pattern.
  const memberSet = new Set(members);
  const frictionBlob = ev.recurring_friction.map(([w]) => w).join(" | ").toLowerCase();
  const patternBlob = [...ev.success_patterns, ...ev.fail_patterns]
    .map(([p]) => p).join(" | ").toLowerCase();
  const grounded = draft.citations.some((c) => {
    const t = c.trim();
    if (memberSet.has(t)) return true;
    if (/^[0-9a-f-]+#\d+$/i.test(t) && memberSet.has(t)) return true;
    if (t.toLowerCase().startsWith("friction:")) {
      const v = t.slice("friction:".length).trim().toLowerCase().slice(0, 20);
      return v.length > 0 && frictionBlob.includes(v);
    }
    if (t.toLowerCase().startsWith("pattern:")) {
      const v = t.slice("pattern:".length).trim().toLowerCase().slice(0, 8);
      return v.length > 0 && patternBlob.includes(v);
    }
    return false;
  });
  if (!grounded) { issues.push("REJECT: no citation grounds the skill in cluster evidence"); reject = true; }

  // 3. Non-triviality: a real procedure, not a one-step platitude.
  const steps = (ev.dominant_pattern ?? "").split(">").map((s) => s.trim()).filter(Boolean);
  if (steps.length < 2 && draft.skill_body_markdown.length < 400) {
    issues.push("REJECT: trivial — single-step pattern and a tiny body (no procedure to codify)");
    reject = true;
  }

  // 4. Anti-hardcode / leakage. Re-scan the GENERATED body+scripts; the LLM could echo
  // a literal even though evidence was redacted.
  const blob = draft.skill_body_markdown + "\n" + draft.scripts.map((s) => s.code).join("\n");
  const r = redactText(blob);
  if (r.nRedacted > 0) {
    // A secret/credential in generated output is a hard fail; a personal path is a warn.
    if (/«REDACTED:(anthropic-key|api-key|aws|github-token|slack-token|jwt|private-key|credential)/.test(r.text)) {
      issues.push("REJECT: generated artifact contains secret-like content"); reject = true;
    } else {
      issues.push(`WARN: ${r.nRedacted} personal-path/PII literal(s) in artifact (scrubbed on write)`);
      warn = true;
    }
  }
  if (/\b([A-Za-z]:\\|\/home\/|\/Users\/|\/root\/)/.test(blob)) {
    issues.push("WARN: absolute filesystem path in artifact — should be generalised"); warn = true;
  }

  // 5. Safety: dangerous ops must be wrapped by a guardrail.
  const guardBlob = draft.guardrails.join(" ").toLowerCase();
  const danger = [
    [/rm\s+-rf|rm\s+-fr/i, "rm -rf"],
    [/curl[^\n|]*\|\s*(sudo\s+)?(ba)?sh/i, "curl|sh"],
    [/git\s+push\s+.*--force|push\s+-f\b/i, "force-push"],
    [/\bdrop\s+(table|database)\b/i, "DROP"],
    [/mkfs|dd\s+if=|:\(\)\s*\{/i, "destructive"],
  ] as [RegExp, string][];
  for (const [re, lbl] of danger) {
    if (re.test(blob) && !guardBlob.includes(lbl.split(" ")[0].toLowerCase())) {
      issues.push(`WARN: dangerous op '${lbl}' not covered by a guardrail`); warn = true;
    }
  }
  if (/\b(malware|exploit|reverse\s+shell|keylogger|backdoor)\b/i.test(blob)) {
    issues.push("REJECT: artifact references malware/exploit content"); reject = true;
  }

  // 6. Style yellow-flag (Anthropic): heavy all-caps directives.
  const caps = (draft.skill_body_markdown.match(/\b(ALWAYS|NEVER|MUST|DO NOT)\b/g) ?? []).length;
  if (caps > 2) { issues.push(`WARN: ${caps} all-caps directives (prefer explaining why)`); warn = true; }

  const status: GateStatus = reject ? "reject" : warn ? "warn" : "pass";
  return { status, issues };
}
