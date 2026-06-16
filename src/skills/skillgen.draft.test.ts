// skillgen.draft.test.ts — tolerant JSON extraction, name/filename coercion, and
// validation/coercion of the LLM's draft. sanitizeFilename is a real security seam:
// a model-supplied "../../etc/passwd" must never escape one path segment.

import { describe, expect, it } from "bun:test";
import {
  asStrArr,
  coerceName,
  extractJsonObject,
  sanitizeFilename,
  validateDraft,
} from "./skillgen.draft.ts";
import type { RankedCandidate } from "../core/types.ts";

const cand = { label: "fix flaky tests" } as RankedCandidate;

describe("extractJsonObject", () => {
  it("pulls JSON out of a fenced block", () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("pulls JSON out of surrounding prose", () => {
    expect(extractJsonObject('sure! {"a":1} done')).toBe('{"a":1}');
  });
  it("balances nested braces", () => {
    expect(extractJsonObject('{"a":{"b":2}}x')).toBe('{"a":{"b":2}}');
  });
  it("ignores braces inside strings", () => {
    expect(extractJsonObject('{"k":"a}b"}')).toBe('{"k":"a}b"}');
  });
  it("returns null when there is no object", () => {
    expect(extractJsonObject("no json here")).toBeNull();
  });
});

describe("coerceName", () => {
  it("keeps a spec-valid name (lowercasing)", () => {
    expect(coerceName("Good-Skill", "x")).toBe("good-skill");
  });
  it("falls back to a slug of the label when invalid", () => {
    expect(coerceName("Bad Name!", "fix flaky tests")).toBe("fix-flaky-tests");
  });
  it("falls back to slugify's own 'uncategorized' when name+label are both unusable", () => {
    // slugify never yields a NAME_RE-invalid string, so it returns "uncategorized"
    // (slugify's fallback) rather than coerceName's last-resort "mined-skill".
    expect(coerceName("", "!!!")).toBe("uncategorized");
  });
});

describe("sanitizeFilename (path-traversal defence)", () => {
  it("strips directory traversal to a single safe segment", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("..\\..\\windows\\system32\\cmd.exe")).toBe("cmd.exe");
  });
  it("replaces unsafe characters", () => {
    expect(sanitizeFilename("my file@v2.txt")).toBe("my_file_v2.txt");
  });
  it("never returns a path separator", () => {
    const out = sanitizeFilename("/abs/evil/name");
    expect(out).not.toContain("/");
    expect(out).toBe("name");
  });
});

describe("asStrArr", () => {
  it("keeps only strings", () => {
    expect(asStrArr(["a", 1, "b", null])).toEqual(["a", "b"]);
  });
  it("non-array -> []", () => {
    expect(asStrArr("nope")).toEqual([]);
    expect(asStrArr(undefined)).toEqual([]);
  });
});

describe("validateDraft", () => {
  const ok = {
    name: "fix-flaky-tests",
    description: "Stabilise flaky tests",
    skill_body_markdown: "## Steps\n1. isolate\n2. quarantine",
    citations: ["sess#0"],
  };

  it("throws on non-object", () => {
    expect(() => validateDraft(null, cand)).toThrow();
    expect(() => validateDraft([], cand)).toThrow();
  });
  it("throws when description missing", () => {
    expect(() => validateDraft({ ...ok, description: "" }, cand)).toThrow();
  });
  it("throws when skill body missing", () => {
    expect(() => validateDraft({ ...ok, skill_body_markdown: "" }, cand)).toThrow();
  });
  it("produces a spec-compliant draft from a valid object", () => {
    const d = validateDraft(ok, cand);
    expect(d.name).toBe("fix-flaky-tests");
    expect(d.artifact_type).toBe("skill");
    expect(Array.isArray(d.scripts)).toBe(true);
  });
  it("truncates an over-long (>1024) description with an ellipsis", () => {
    const d = validateDraft({ ...ok, description: "x".repeat(1100) }, cand);
    expect(d.description.length).toBeLessThanOrEqual(1022);
    expect(d.description.endsWith("…")).toBe(true);
  });
  it("clamps an out-of-range confidence to the 0.3 default", () => {
    expect(validateDraft({ ...ok, confidence: 5 }, cand).confidence).toBe(0.3);
    expect(validateDraft({ ...ok, confidence: 0.7 }, cand).confidence).toBe(0.7);
  });
  it("sanitizes filenames inside scripts", () => {
    const d = validateDraft(
      { ...ok, scripts: [{ filename: "../../evil.sh", language: "bash", code: "echo hi" }] },
      cand
    );
    expect(d.scripts[0].filename).toBe("evil.sh");
  });
});
