// redact.test.ts — the project's #1 privacy gate. These tests pin the deterministic
// behaviour the rest of the pipeline trusts: secrets/PII/paths are replaced by typed
// placeholders, the value-only credential mask preserves structure, and the redaction
// COUNT is returned so callers can log it (no silent redaction).

import { describe, expect, it } from "bun:test";
import { redactDeep, redactText } from "./redact.ts";

describe("redactText — structured secrets", () => {
  it("redacts an Anthropic key as anthropic-key", () => {
    const r = redactText("key is sk-ant-" + "A".repeat(30) + " ok");
    expect(r.text).toContain("«REDACTED:anthropic-key»");
    expect(r.text).not.toContain("sk-ant-AAAA");
    expect(r.nRedacted).toBe(1);
  });

  it("redacts an AWS access key", () => {
    const r = redactText("AKIAIOSFODNN7EXAMPLE");
    expect(r.text).toBe("«REDACTED:aws-access-key»");
  });

  it("redacts a GitHub token", () => {
    const r = redactText("token ghp_0123456789abcdef0123 here");
    expect(r.text).toContain("«REDACTED:github-token»");
  });

  it("redacts a JWT", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
      "eyJzdWIiOiIxMjM0NTY3ODkwIn0." +
      "SflKxwRJSMeKKF2QT4fwpMeJf36abc";
    expect(redactText(jwt).text).toContain("«REDACTED:jwt»");
  });

  it("redacts a PEM private key block", () => {
    const pem =
      "-----BEGIN PRIVATE KEY-----\nMIIBVwIBADANBgkq\n-----END PRIVATE KEY-----";
    const r = redactText(pem);
    expect(r.text).toBe("«REDACTED:private-key»");
  });

  it("redacts credentials embedded in a URL and keeps the host", () => {
    const r = redactText("clone https://admin:s3cr3t@github.com/x.git now");
    expect(r.text).toContain("«REDACTED:url-credentials»");
    expect(r.text).toContain("github.com/x.git");
    expect(r.text).not.toContain("s3cr3t");
  });
});

describe("redactText — credential assignments (value-only mask)", () => {
  it("masks the VALUE but keeps the key name + separator", () => {
    const r = redactText("password=hunter2");
    expect(r.text).toBe("password=«REDACTED:credential»");
    expect(r.text).not.toContain("hunter2");
  });

  it("handles JSON-style quoted secrets", () => {
    const r = redactText("api_key: 'abcd1234efgh'");
    expect(r.text).toContain("api_key:");
    expect(r.text).toContain("«REDACTED:credential»");
    expect(r.text).not.toContain("abcd1234efgh");
  });
});

describe("redactText — PII and paths", () => {
  it("redacts email addresses", () => {
    expect(redactText("ping me at alice@example.com").text).toContain(
      "«REDACTED:email»"
    );
  });

  it("redacts SSN-like numbers", () => {
    expect(redactText("ssn 123-45-6789").text).toContain("«REDACTED:ssn-like»");
  });

  it("generalises another user's home path (env-independent /Users)", () => {
    const r = redactText("see /Users/bob/secret.txt for details");
    expect(r.text).toContain("«HOME:other»");
    expect(r.text).not.toContain("/Users/bob");
    expect(r.nRedacted).toBeGreaterThanOrEqual(1);
  });
});

describe("redactText — contract", () => {
  it("returns empty text + zero count for null/undefined", () => {
    expect(redactText(null)).toEqual({ text: "", nRedacted: 0 });
    expect(redactText(undefined)).toEqual({ text: "", nRedacted: 0 });
  });

  it("is a no-op (0 redactions) on clean text", () => {
    const r = redactText("just a normal sentence about cats");
    expect(r.nRedacted).toBe(0);
    expect(r.text).toBe("just a normal sentence about cats");
  });
});

describe("redactDeep", () => {
  it("walks nested structures, redacts strings, preserves non-strings, sums count", () => {
    const { value, nRedacted } = redactDeep({
      a: "email me at x@y.com",
      b: ["sk-ant-" + "A".repeat(25)],
      c: 42,
      d: true,
    });
    expect(value.a).toContain("«REDACTED:email»");
    expect(value.b[0]).toContain("«REDACTED:anthropic-key»");
    expect(value.c).toBe(42);
    expect(value.d).toBe(true);
    expect(nRedacted).toBe(2);
  });
});
