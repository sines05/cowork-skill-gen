// segment.test.ts — grouping classified turns into episodes. Pins the boundary rules
// that protect the judge cache + report quality: a session with NO human turns yields
// NO degenerate empty episode, new_task turns split episodes, the content hash is
// deterministic, and the opening prompt never leaks an interrupt marker.

import { describe, expect, it } from "bun:test";
import { segmentEpisodes } from "./segment.ts";
import { INTERRUPT_MARKER } from "./classify.cues.ts";
import type { ClassifiedTurn, RawEvent, SessionInfo, TurnRole } from "../core/types.ts";

const session: SessionInfo = {
  sessionId: "sess-1",
  project: "demo",
  projectDir: "demo-dir",
  cwd: "/tmp/demo",
  jsonlPath: "/tmp/demo/x.jsonl",
  subagentsDir: null,
  startedAt: "2026-06-16T00:00:00.000Z",
  completedAt: "2026-06-16T00:10:00.000Z",
};

let turnSeq = 0;
function turn(role: TurnRole, eventIndex: number, text: string): ClassifiedTurn {
  const idx = turnSeq++;
  return {
    sessionId: "sess-1",
    idx,
    uuid: `u${idx}`,
    role,
    text,
    charLen: text.length,
    nImages: 0,
    ts: "2026-06-16T00:00:00.000Z",
    eventIndex,
    classifiedBy: "heuristic",
  };
}

function ev(type: string, text = ""): RawEvent {
  return { type, message: { content: text }, timestamp: "2026-06-16T00:00:00.000Z" } as RawEvent;
}

describe("segmentEpisodes — degenerate sessions", () => {
  it("no human turns -> NO episode (avoids a judgeable empty episode)", () => {
    expect(segmentEpisodes(session, [ev("assistant")], [])).toEqual([]);
  });

  it("turns but no new_task boundary -> exactly one fallback episode", () => {
    turnSeq = 0;
    const turns = [turn("continuation", 0, "and also do this")];
    const eps = segmentEpisodes(session, [ev("user", "x"), ev("assistant")], turns);
    expect(eps.length).toBe(1);
    expect(eps[0].episodeId).toBe("sess-1#0");
  });
});

describe("segmentEpisodes — boundaries", () => {
  it("splits at each new_task into ordered episodes", () => {
    turnSeq = 0;
    const events = [ev("user", "Fix the bug"), ev("assistant"), ev("user", "Now add docs"), ev("assistant")];
    const turns = [turn("new_task", 0, "Fix the bug"), turn("new_task", 2, "Now add docs")];
    const eps = segmentEpisodes(session, events, turns);
    expect(eps.length).toBe(2);
    expect(eps[0].idx).toBe(0);
    expect(eps[1].idx).toBe(1);
    expect(eps[0].episodeId).toBe("sess-1#0");
    expect(eps[1].episodeId).toBe("sess-1#1");
  });

  it("produces a deterministic 64-hex content hash", () => {
    turnSeq = 0;
    const events = [ev("user", "Fix the bug"), ev("assistant")];
    const turns = [turn("new_task", 0, "Fix the bug")];
    const a = segmentEpisodes(session, events, turns)[0].contentHash;
    turnSeq = 0;
    const b = segmentEpisodes(
      session,
      [ev("user", "Fix the bug"), ev("assistant")],
      [turn("new_task", 0, "Fix the bug")]
    )[0].contentHash;
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
  });
});

describe("segmentEpisodes — first prompt selection", () => {
  it("uses the opening new_task text", () => {
    turnSeq = 0;
    const eps = segmentEpisodes(
      session,
      [ev("user", "Refactor the parser"), ev("assistant")],
      [turn("new_task", 0, "Refactor the parser")]
    );
    expect(eps[0].firstPrompt).toBe("Refactor the parser");
  });

  it("never returns the interrupt marker; falls through to the first real turn", () => {
    turnSeq = 0;
    const events = [ev("user", INTERRUPT_MARKER), ev("user", "real prompt here")];
    const turns = [
      turn("interruption", 0, INTERRUPT_MARKER),
      turn("continuation", 1, "real prompt here"),
    ];
    const eps = segmentEpisodes(session, events, turns);
    expect(eps[0].firstPrompt).toBe("real prompt here");
    expect(eps[0].firstPrompt).not.toContain(INTERRUPT_MARKER);
  });
});
