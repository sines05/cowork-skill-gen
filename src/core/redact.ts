// redact.ts — strip secrets / credentials / PII / personal paths from text BEFORE
// it reaches an LLM or is written to any artifact. Privacy Risk #1 in the eval report:
// API keys and passwords leaked verbatim into the "clean handoff" file, and machine
// paths / usernames leaked into reports.
//
// Design: redact-FIRST, on the machine, deterministic (pure regex), never throws.
// Each pattern replaces the match with a typed placeholder like «REDACTED:aws-key» so
// the shape of the data survives (the judge/skill-gen still sees "a key was here")
// without the secret itself. Returns the count so callers can LOG how much was hidden
// (no silent redaction — the eval report flagged silent behaviour as a trust problem).
//
// This is the single source of truth for redaction; render/report/skillgen all call it.

import { homedir } from "os";

export interface RedactResult {
  text: string;
  nRedacted: number;
}

// Each rule: a global regex + the placeholder tag. Order matters — more specific
// (structured secrets) run before broad ones (generic key=value) so a token is tagged
// by its true type. All regexes are global (replace-all).
interface Rule {
  re: RegExp;
  tag: string;
}

// Home dir of the current machine, encoded for path matching. Computed at runtime so
// we don't hardcode a username (the old code leaked "/Users/alice/..." into reports).
const HOME = homedir();

function buildRules(): Rule[] {
  const rules: Rule[] = [
    // ── High-confidence structured secrets ───────────────────────────────────
    { re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, tag: "anthropic-key" },
    { re: /\bsk-[A-Za-z0-9]{20,}\b/g, tag: "api-key" },
    { re: /\bAKIA[0-9A-Z]{12,}\b/g, tag: "aws-access-key" },
    { re: /\bASIA[0-9A-Z]{12,}\b/g, tag: "aws-temp-key" },
    { re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, tag: "github-token" },
    { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, tag: "slack-token" },
    { re: /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, tag: "jwt" },
    {
      re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g,
      tag: "private-key",
    },
    // ── Credentials embedded in URLs (user:pass@host) ────────────────────────
    { re: /\b([a-z][a-z0-9+.-]*):\/\/[^\s:/@]+:[^\s:/@]+@/gi, tag: "url-credentials" },
    // ── key=value / "password": "..." style assignments ──────────────────────
    // Captures common secret-bearing keys and redacts the VALUE only.
    {
      re: /\b(pass(?:word|wd)?|secret|token|api[_-]?key|auth|access[_-]?token|bearer|client[_-]?secret)\b(\s*[:=]\s*|["']\s*:\s*["']?)([^\s"',;]{4,})/gi,
      tag: "credential",
    },
    // ── PII ──────────────────────────────────────────────────────────────────
    { re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, tag: "email" },
    { re: /\b\d{3}-\d{2}-\d{4}\b/g, tag: "ssn-like" },
  ];
  return rules;
}

const RULES = buildRules();

// Apply credential-key redaction carefully: we keep the key name + separator and only
// mask the value, so structure ("password: «REDACTED:credential»") stays readable.
function redactCredentialAssignments(text: string): { text: string; n: number } {
  let n = 0;
  // key  <sep>  <optional opening quote>  VALUE  <optional closing quote>
  // sep is `=`/`:` (env/yaml) or `":` (JSON). The opening/closing quotes are consumed
  // (not captured) so `password="hunter2"` and `"token": "abc"` both mask cleanly.
  const re =
    /\b(pass(?:word|wd)?|secret|token|api[_-]?key|auth|access[_-]?token|bearer|client[_-]?secret)\b(\s*[:=]\s*|"\s*:\s*)["']?([^\s"',;]{3,})["']?/gi;
  const out = text.replace(re, (_m, key, sep) => {
    n++;
    return `${key}${sep}«REDACTED:credential»`;
  });
  return { text: out, n };
}

/**
 * Redact secrets/PII/personal paths from a string.
 * Replaces each match with «REDACTED:tag». Returns the new text + how many redactions.
 */
export function redactText(input: string | null | undefined): RedactResult {
  if (!input) return { text: input ?? "", nRedacted: 0 };
  let text = String(input);
  let nRedacted = 0;

  // Structured + PII rules (skip the generic credential rule here — handled below so
  // we can preserve the key name).
  for (const { re, tag } of RULES) {
    if (tag === "credential") continue;
    text = text.replace(re, () => {
      nRedacted++;
      return `«REDACTED:${tag}»`;
    });
  }

  // Credential key=value assignments (value-only mask).
  const cred = redactCredentialAssignments(text);
  text = cred.text;
  nRedacted += cred.n;

  // Personal home path → «HOME» (do last; least sensitive, avoids breaking earlier
  // matches). Generalises any /home/<user> or /Users/<user> too, not just THIS home.
  const homeRe = new RegExp(escapeRe(HOME), "g");
  text = text.replace(homeRe, () => {
    nRedacted++;
    return "«HOME»";
  });
  // Generic other-user home paths.
  text = text.replace(/\/(?:home|Users)\/[A-Za-z0-9._-]+/g, (m) => {
    if (m === "«HOME»") return m;
    nRedacted++;
    return "«HOME:other»";
  });

  return { text, nRedacted };
}

// Deep-redact every string inside a JSON-serialisable value (arrays/objects/strings).
// Returns a new structure; counts total redactions. Used to scrub assembled evidence
// objects before they go to the LLM or to disk.
export function redactDeep(value: any): { value: any; nRedacted: number } {
  let total = 0;
  const walk = (v: any): any => {
    if (typeof v === "string") {
      const r = redactText(v);
      total += r.nRedacted;
      return r.text;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, any> = {};
      for (const [k, val] of Object.entries(v)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  const redacted = walk(value);
  return { value: redacted, nRedacted: total };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── CLI: redact stdin or a file, print result + count to stderr ───────────────
// Usage: bun run src/redact.ts <file>   |   echo "..." | bun run src/redact.ts
if (import.meta.main) {
  const path = process.argv[2];
  const input = path
    ? await Bun.file(path).text()
    : await new Response(Bun.stdin.stream()).text();
  const { text, nRedacted } = redactText(input);
  process.stdout.write(text);
  console.error(`\n[redact] ${nRedacted} item(s) redacted`);
}
