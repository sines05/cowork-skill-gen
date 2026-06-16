// classify.cues.test.ts — the multilingual (EN/VI) role heuristics. These pin the
// subtle disambiguations the comments warn about: "tiếp tục"/"continue" are PROCEED
// cues, NOT approval (mislabeling them inflates the explicit_user_approval success
// signal), and a paste must look like a log without carrying a request.

import { describe, expect, it } from "bun:test";
import {
  hasRequestCue,
  isApproval,
  isContinuationCue,
  isCorrection,
  isPaste,
  normalizeAck,
} from "./classify.cues.ts";

describe("normalizeAck", () => {
  it("lowercases and strips trailing punctuation/space", () => {
    expect(normalizeAck("OK! ")).toBe("ok");
    expect(normalizeAck("Yes.")).toBe("yes");
  });
});

describe("isApproval", () => {
  it("matches short EN acks", () => {
    expect(isApproval("ok")).toBe(true);
    expect(isApproval("perfect")).toBe(true);
    expect(isApproval("👍")).toBe(true);
  });
  it("matches short VI acks", () => {
    expect(isApproval("được")).toBe(true);
    expect(isApproval("đúng rồi")).toBe(true);
  });
  it("matches short multi-word acks where every word is an ack", () => {
    expect(isApproval("ok thanks")).toBe(true);
  });
  it("rejects empty and over-long turns", () => {
    expect(isApproval("")).toBe(false);
    expect(isApproval("x".repeat(41))).toBe(false);
  });
  it("does NOT treat proceed cues as approval", () => {
    // "go" was deliberately removed from APPROVAL_PHRASES — it's a proceed cue.
    expect(isApproval("ok go")).toBe(false);
    expect(isApproval("continue")).toBe(false);
  });
});

describe("isCorrection", () => {
  it("matches bare negations", () => {
    expect(isCorrection("no")).toBe(true);
    expect(isCorrection("nope")).toBe(true);
  });
  it("matches EN correction prefixes and 'still <problem>'", () => {
    expect(isCorrection("actually, do it differently")).toBe(true);
    expect(isCorrection("wrong, revert that")).toBe(true);
    expect(isCorrection("still failing")).toBe(true);
  });
  it("matches VI pushback prefixes", () => {
    expect(isCorrection("Không, hãy sửa lại")).toBe(true);
    expect(isCorrection("sai rồi")).toBe(true);
  });
  it("does not flag a fresh request", () => {
    expect(isCorrection("add a login page")).toBe(false);
  });
});

describe("isContinuationCue", () => {
  it("matches EN additive/proceed cues", () => {
    expect(isContinuationCue("also add tests")).toBe(true);
    expect(isContinuationCue("and then deploy")).toBe(true);
    expect(isContinuationCue("go ahead")).toBe(true);
    expect(isContinuationCue("continue")).toBe(true);
  });
  it("matches VI proceed cues (the critical 'tiếp tục' case)", () => {
    expect(isContinuationCue("tiếp tục")).toBe(true);
    expect(isContinuationCue("áp dụng đi")).toBe(true);
  });
  it("does not flag a fresh request", () => {
    expect(isContinuationCue("fix the bug")).toBe(false);
  });
});

describe("hasRequestCue", () => {
  it("detects request words", () => {
    expect(hasRequestCue("can you write this?")).toBe(true);
  });
  it("returns false for cue-less prose", () => {
    expect(hasRequestCue("the cat sat on the rug")).toBe(false);
  });
});

describe("isPaste", () => {
  it("flags a Python traceback", () => {
    const trace =
      "Traceback (most recent call last):\n" +
      '  File "app.py", line 10, in <module>\n' +
      "    raise ValueError('boom')\n" +
      "ValueError: boom and some more padding text here";
    expect(isPaste(trace)).toBe(true);
  });
  it("flags an ls -l style file listing (>=2 rows)", () => {
    const listing =
      "drwxr-xr-x 2 user user 4096 Jan 1 src\n" +
      "-rw-r--r-- 1 user user 1024 Jan 1 readme.md\n" +
      "-rwxr-xr-x 1 user user 2048 Jan 1 run.sh padding padding";
    expect(isPaste(listing)).toBe(true);
  });
  it("does not flag a short string", () => {
    expect(isPaste("rsync: error")).toBe(false); // under 60 chars
  });
  it("does not flag a long natural-language request", () => {
    const req =
      "Can you please write a function that adds two numbers and also handles edge cases for me, thanks";
    expect(isPaste(req)).toBe(false);
  });
});
