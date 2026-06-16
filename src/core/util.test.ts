// util.test.ts — shared helpers. The Wilson CI here is what keeps the project honest
// about small-N agreement ("82% on 11" is meaningless without a band), so it's pinned
// carefully. Human-turn extraction is the seam every classifier sits on.

import { describe, expect, it } from "bun:test";
import {
  countImages,
  extractUserText,
  fmtRateCI,
  isHumanTurn,
  median,
  sha256,
  truncate,
  wilson,
} from "./util.ts";
import type { RawEvent } from "./types.ts";

describe("sha256 / truncate", () => {
  it("sha256 is deterministic 64-hex", () => {
    const a = sha256("hello");
    expect(a).toBe(sha256("hello"));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(sha256("hello!"));
  });

  it("truncate leaves short strings, slices long ones", () => {
    expect(truncate("abc", 5)).toBe("abc");
    expect(truncate("abcdef", 3)).toBe("abc");
  });
});

describe("median", () => {
  it("empty -> 0", () => expect(median([])).toBe(0));
  it("single", () => expect(median([5])).toBe(5));
  it("odd length", () => expect(median([3, 1, 2])).toBe(2));
  it("even length averages the middle two", () =>
    expect(median([1, 2, 3, 4])).toBe(2.5));
});

describe("wilson score interval", () => {
  it("n<=0 -> all zeros", () => {
    expect(wilson(0, 0)).toEqual({ p: 0, lo: 0, hi: 0 });
  });

  it("bounds are clamped to [0,1]", () => {
    const all = wilson(10, 10);
    expect(all.p).toBe(1);
    expect(all.hi).toBeLessThanOrEqual(1);
    const none = wilson(0, 10);
    expect(none.p).toBe(0);
    expect(none.lo).toBeGreaterThanOrEqual(0);
  });

  it("8/10 gives a point estimate of 0.8 with a band strictly inside (0,1)", () => {
    const w = wilson(8, 10);
    expect(w.p).toBeCloseTo(0.8, 5);
    expect(w.lo).toBeGreaterThan(0.4);
    expect(w.lo).toBeLessThan(0.6);
    expect(w.hi).toBeGreaterThan(0.9);
    expect(w.hi).toBeLessThan(1);
  });
});

describe("fmtRateCI", () => {
  it("n=0 -> em dash", () => expect(fmtRateCI(0, 0)).toBe("—"));
  it("formats count + Wilson 95% CI", () => {
    const s = fmtRateCI(9, 11);
    expect(s).toContain("9/11");
    expect(s).toContain("95% CI");
  });
});

describe("extractUserText / countImages", () => {
  it("string content is trimmed", () => {
    expect(extractUserText({ content: "  hi  " })).toBe("hi");
  });
  it("array content joins text parts only", () => {
    expect(
      extractUserText({
        content: [
          { type: "text", text: "a" },
          { type: "image" },
          { type: "text", text: "b" },
        ],
      })
    ).toBe("ab");
  });
  it("no message -> empty", () => expect(extractUserText(null)).toBe(""));
  it("counts image parts", () => {
    expect(
      countImages({ content: [{ type: "image" }, { type: "text", text: "x" }, { type: "image" }] })
    ).toBe(2);
  });
});

describe("isHumanTurn", () => {
  const u = (over: Partial<RawEvent>): RawEvent =>
    ({ type: "user", message: { content: "hello" }, ...over } as RawEvent);

  it("plain user text turn is human", () => {
    expect(isHumanTurn(u({}))).toBe(true);
  });
  it("assistant event is not human", () => {
    expect(isHumanTurn({ type: "assistant" } as RawEvent)).toBe(false);
  });
  it("isMeta envelope is not human", () => {
    expect(isHumanTurn(u({ isMeta: true }))).toBe(false);
  });
  it("tool-result user event is not human", () => {
    expect(isHumanTurn(u({ toolUseResult: { ok: true } }))).toBe(false);
    expect(
      isHumanTurn(u({ message: { content: [{ type: "tool_result", content: "x" }] } }))
    ).toBe(false);
  });
  it("slash/harness envelope (text starts with '<') is not human", () => {
    expect(isHumanTurn(u({ message: { content: "<command>foo</command>" } }))).toBe(false);
  });
  it("empty text + no image is not human", () => {
    expect(isHumanTurn(u({ message: { content: "" } }))).toBe(false);
  });
  it("image-only turn still counts as human", () => {
    expect(isHumanTurn(u({ message: { content: [{ type: "image" }] } }))).toBe(true);
  });
});
