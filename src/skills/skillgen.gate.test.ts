// skillgen.gate.test.ts — Gate 2-A, the cheap no-LLM trust gate. The single most
// important behaviour: even though evidence was redacted, the LLM can echo a literal
// secret into the GENERATED artifact, so the gate re-scans its own output and HARD
// REJECTS secret-like content. The rest pins frontmatter/grounding/non-triviality/
// safety/style rules.

import { describe, expect, it } from "bun:test";
import { gate2A } from "./skillgen.gate.ts";
import type { Draft } from "./skillgen.draft.ts";
import type { Evidence } from "./skillgen.evidence.ts";

const MEMBERS = ["sess-1#0"];

function baseDraft(over: Partial<Draft> = {}): Draft {
  return {
    name: "fix-flaky-tests",
    description: "Stabilise flaky integration tests",
    compatibility: null,
    artifact_type: "skill",
    skill_body_markdown: "Isolate the test, reproduce with a seed, then quarantine it.",
    references: [],
    scripts: [],
    assets: [],
    related_skills: [],
    evals: [],
    citations: ["sess-1#0"], // grounds in MEMBERS
    guardrails: [],
    anti_patterns: [],
    confidence: 0.6,
    ...over,
  };
}

function baseEv(over: Partial<Evidence> = {}): Evidence {
  return {
    cluster_id: "c1",
    label: "flaky tests",
    recommended_intervention: "skill",
    dominant_pattern: "reproduce > isolate > quarantine", // 3 steps -> non-trivial
    has_stable_pattern: true,
    success_rate: 0.8,
    n_judged: 5,
    frequency: 6,
    n_sessions: 4,
    risk_flags: [],
    success_patterns: [["reproduce>isolate", 3]],
    fail_patterns: [],
    recurring_friction: [["flaky test reruns", 4]],
    good_practices: [],
    root_causes: [],
    exemplars: [],
    ...over,
  };
}

describe("gate2A — happy path", () => {
  it("passes a well-formed, grounded, non-trivial draft", () => {
    const r = gate2A(baseDraft(), baseEv(), MEMBERS);
    expect(r.status).toBe("pass");
    expect(r.issues).toEqual([]);
  });
});

describe("gate2A — security re-scan of generated artifact (the crown jewel)", () => {
  it("HARD REJECTS when the body echoes a secret literal", () => {
    const r = gate2A(
      baseDraft({ skill_body_markdown: "run with key sk-ant-" + "A".repeat(30) }),
      baseEv(),
      MEMBERS
    );
    expect(r.status).toBe("reject");
    expect(r.issues.some((i) => i.includes("secret-like"))).toBe(true);
  });

  it("WARNS (not reject) on a leaked personal path", () => {
    const r = gate2A(
      baseDraft({ skill_body_markdown: "see /Users/bob/repo for the fixture" }),
      baseEv(),
      MEMBERS
    );
    expect(r.status).toBe("warn");
  });
});

describe("gate2A — frontmatter / grounding / non-triviality", () => {
  it("rejects a spec-invalid name", () => {
    const r = gate2A(baseDraft({ name: "Invalid Name" }), baseEv(), MEMBERS);
    expect(r.status).toBe("reject");
    expect(r.issues.some((i) => i.includes("name violates spec"))).toBe(true);
  });

  it("rejects an empty description", () => {
    const r = gate2A(baseDraft({ description: "" }), baseEv(), MEMBERS);
    expect(r.status).toBe("reject");
  });

  it("rejects when no citation grounds the skill in cluster evidence", () => {
    const r = gate2A(baseDraft({ citations: ["nonexistent"] }), baseEv(), MEMBERS);
    expect(r.status).toBe("reject");
    expect(r.issues.some((i) => i.includes("no citation grounds"))).toBe(true);
  });

  it("grounds via a friction: citation prefix", () => {
    const r = gate2A(
      baseDraft({ citations: ["friction:flaky test reruns"] }),
      baseEv(),
      MEMBERS
    );
    expect(r.status).toBe("pass");
  });

  it("rejects a trivial single-step skill with a tiny body", () => {
    const r = gate2A(
      baseDraft({ skill_body_markdown: "just rerun it" }),
      baseEv({ dominant_pattern: "rerun" }), // 1 step
      MEMBERS
    );
    expect(r.status).toBe("reject");
    expect(r.issues.some((i) => i.includes("trivial"))).toBe(true);
  });
});

describe("gate2A — safety / style", () => {
  it("warns on a dangerous op not covered by a guardrail", () => {
    const r = gate2A(
      baseDraft({ skill_body_markdown: "cleanup: rm -rf build then rebuild the project" }),
      baseEv(),
      MEMBERS
    );
    expect(r.status).toBe("warn");
    expect(r.issues.some((i) => i.includes("rm -rf"))).toBe(true);
  });

  it("rejects artifacts referencing malware/exploit content", () => {
    const r = gate2A(
      baseDraft({ skill_body_markdown: "deploy a reverse shell to the host machine" }),
      baseEv(),
      MEMBERS
    );
    expect(r.status).toBe("reject");
  });

  it("warns on heavy all-caps directives", () => {
    const r = gate2A(
      baseDraft({
        skill_body_markdown:
          "ALWAYS reproduce first. NEVER skip isolation. You MUST quarantine. DO NOT merge.",
      }),
      baseEv(),
      MEMBERS
    );
    expect(r.status).toBe("warn");
    expect(r.issues.some((i) => i.includes("all-caps"))).toBe(true);
  });
});
