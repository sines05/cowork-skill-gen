// classify.overlap.test.ts — topic-overlap machinery. The key regression this guards
// against is the old ASCII tokenizer that shredded Vietnamese at every diacritic
// ("kiểm tra hệ thống" -> only "tra"), so containment never fired on non-English turns.

import { describe, expect, it } from "bun:test";
import { containment, keywordsOf, tsToMs } from "./classify.overlap.ts";

describe("keywordsOf", () => {
  it("drops stopwords and <3-char tokens", () => {
    const kw = keywordsOf("Fix the login bug");
    expect(kw.has("login")).toBe(true);
    expect(kw.has("bug")).toBe(true);
    expect(kw.has("the")).toBe(false); // stopword
    expect(kw.has("fix")).toBe(false); // stopword
  });

  it("keeps accented Vietnamese words intact (unicode-aware)", () => {
    const kw = keywordsOf("kiểm tra hệ thống");
    expect(kw.has("kiểm")).toBe(true);
    expect(kw.has("thống")).toBe(true);
    expect(kw.has("hệ")).toBe(false); // 2 chars -> dropped
  });
});

describe("containment", () => {
  it("fraction of the turn's keywords present in the window", () => {
    const turn = new Set(["a", "b"]);
    const window = new Set(["a", "c"]);
    expect(containment(turn, window)).toBe(0.5);
  });
  it("empty sets -> 0", () => {
    expect(containment(new Set(), new Set(["a"]))).toBe(0);
    expect(containment(new Set(["a"]), new Set())).toBe(0);
  });
});

describe("tsToMs", () => {
  it("parses ISO timestamps", () => {
    expect(tsToMs("2026-06-16T00:00:00.000Z")).toBe(Date.parse("2026-06-16T00:00:00.000Z"));
  });
  it("NaN for missing/invalid", () => {
    expect(Number.isNaN(tsToMs(undefined))).toBe(true);
    expect(Number.isNaN(tsToMs("not-a-date"))).toBe(true);
  });
});
