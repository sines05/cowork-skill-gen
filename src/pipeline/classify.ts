// classify.ts — assign a role to every human turn in a session.
// Roles: new_task | correction | continuation | approval | interruption | paste.
// Hybrid: heuristics for easy cases, signals (time-gap + topic/file overlap) for
// the ambiguous new_task vs correction/continuation boundary, optional one cheap
// `claude -p` batch pass behind opts.classifyLlm for the still-ambiguous turns.
import type { ClassifiedTurn, RawEvent, SessionInfo, TurnRole } from "../core/types.ts";
import { extractUserText, countImages, readEvents, isHumanTurn } from "../core/util.ts";
import {
  INTERRUPT_MARKER,
  isApproval,
  isCorrection,
  isContinuationCue,
  isPaste,
} from "./classify.cues.ts";
import {
  containment,
  keywordsOf,
  tsToMs,
  windowKeywords,
} from "./classify.overlap.ts";
import { runClassifyLlm, type LlmCandidate } from "./classify.llm.ts";

// ── Heuristic-only role (returns null when ambiguous new_task/follow-up) ───────
type HeuristicResult = { role: TurnRole; ambiguous: boolean };

function heuristicRole(text: string, nImages: number): HeuristicResult {
  if (text.includes(INTERRUPT_MARKER)) {
    return { role: "interruption", ambiguous: false };
  }
  // Correction wins over everything below: a leading negation/pushback ("Không, ...",
  // "no, ...") is a fix of the last action regardless of any later cue word.
  if (isCorrection(text)) {
    return { role: "correction", ambiguous: false };
  }
  // CRITICAL: a continuation cue ("Tiếp tục", "Áp dụng đi", "also ...") must be
  // checked BEFORE isApproval, and must win over a false approval match. Otherwise
  // a short "go on" turn could be read as an ack — and a near-episode-end approval
  // is later promoted by signals.ts to an explicit_user_approval success signal,
  // so a mislabel here would inflate success. We only treat it as continuation
  // heuristically when SHORT (≤40 chars, same ceiling as approval); longer cue
  // turns carry real content and are left to the signal pass for boundary logic.
  if (text.length > 0 && text.length <= 40 && isContinuationCue(text)) {
    return { role: "continuation", ambiguous: false };
  }
  if (isApproval(text)) {
    return { role: "approval", ambiguous: false };
  }
  if (isPaste(text)) {
    return { role: "paste", ambiguous: false };
  }
  // image-only turn => continuation (never a boundary)
  if (text === "" && nImages > 0) {
    return { role: "continuation", ambiguous: false };
  }
  // Everything else is provisionally new_task but flagged AMBIGUOUS so the
  // signal pass can demote short low-content follow-ups to correction/continuation.
  return { role: "new_task", ambiguous: true };
}

// ── Main ──────────────────────────────────────────────────────────────────────
export async function classifyTurns(
  session: SessionInfo,
  events: RawEvent[],
  opts?: { classifyLlm?: boolean }
): Promise<ClassifiedTurn[]> {
  const turns: ClassifiedTurn[] = [];

  // First pass: build ClassifiedTurns with heuristic roles + ambiguity flag.
  const ambiguousIdx: number[] = [];
  const meta: { ambiguous: boolean }[] = [];
  let humanIdx = 0;

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!isHumanTurn(ev)) continue;
    const text = extractUserText(ev.message);
    const nImages = countImages(ev.message);
    const h = heuristicRole(text, nImages);

    turns.push({
      sessionId: session.sessionId,
      idx: humanIdx,
      uuid: ev.uuid ?? `${session.sessionId}#u${i}`,
      role: h.role,
      text,
      charLen: text.length,
      nImages,
      ts: ev.timestamp ?? "",
      eventIndex: i,
      classifiedBy: "heuristic",
    });
    meta.push({ ambiguous: h.ambiguous });
    if (h.ambiguous) ambiguousIdx.push(humanIdx);
    humanIdx++;
  }

  // Second pass: signal-based disambiguation for the ambiguous (provisional
  // new_task) turns. Demote to correction/continuation when the turn is a tight
  // follow-up (small gap + high overlap), keep new_task otherwise.
  // Track which remain ambiguous after signals for the optional LLM pass.
  const stillAmbiguous: number[] = [];

  // index of the last turn currently considered a new_task boundary (for window)
  let lastNewTaskTurn = -1;

  for (let t = 0; t < turns.length; t++) {
    const turn = turns[t];
    if (turn.role === "new_task" && !meta[t].ambiguous) {
      lastNewTaskTurn = t;
      continue;
    }
    if (!meta[t].ambiguous) {
      // non-boundary roles do not reset the in-progress episode window
      continue;
    }

    // Strong text cue: an additive continuation ("also ...", "and ...", "then ...")
    // with an episode already in progress is a follow-up, not a fresh task.
    if (lastNewTaskTurn >= 0 && isContinuationCue(turn.text)) {
      turn.role = isCorrection(turn.text) ? "correction" : "continuation";
      turn.classifiedBy = "signal";
      meta[t].ambiguous = false;
      continue;
    }

    // Signals: time gap vs previous human turn.
    const prev = t > 0 ? turns[t - 1] : null;
    const gapMs =
      prev && turn.ts && prev.ts ? tsToMs(turn.ts) - tsToMs(prev.ts) : NaN;
    const gapSeconds = Number.isNaN(gapMs) ? Infinity : gapMs / 1000;

    // Near-identical consecutive turn => a resend/duplicate, always a continuation
    // (or correction) of the same in-progress task, never a new boundary.
    if (
      prev &&
      lastNewTaskTurn >= 0 &&
      turn.text.length > 0 &&
      turn.text === prev.text
    ) {
      turn.role = isCorrection(turn.text) ? "correction" : "continuation";
      turn.classifiedBy = "signal";
      meta[t].ambiguous = false;
      continue;
    }

    // Topic/file overlap vs the in-progress episode window (assistant activity
    // between the last new_task boundary and this turn). Containment, not Jaccard:
    // the window accumulates the whole task's prose, so we ask "is this turn ABOUT
    // the in-progress work?" rather than symmetric similarity.
    const winLo =
      lastNewTaskTurn >= 0 ? turns[lastNewTaskTurn].eventIndex : 0;
    const winHi = turn.eventIndex;
    const winKw = windowKeywords(events, winLo, winHi);
    const turnKw = keywordsOf(turn.text);
    const overlap = containment(turnKw, winKw);

    // Decision signals (heuristic, no LLM). The time GAP gates overlap-based
    // merging — a shared project vocabulary means even unrelated tasks share
    // keywords, so high overlap alone cannot merge tasks that are hours apart.
    //   small gap (<10 min) + some overlap        => tight iteration, same task
    //   medium gap (<30 min) + very high overlap   => quick resume of same topic
    //   short correction with small gap            => correction in-place
    //   weak/ambiguous                             => optional LLM pass (default new_task)
    //   else (large gap, low overlap)              => fresh task
    const smallGap = gapSeconds < 600; // 10 min
    const mediumGap = gapSeconds < 1800; // 30 min
    const someOverlap = overlap >= 0.2;
    const highOverlap = overlap >= 0.4;
    const veryHighOverlap = overlap >= 0.6;
    const veryShort = turn.charLen <= 40;

    const tightIteration = smallGap && (someOverlap || veryShort);
    const quickResume = mediumGap && veryHighOverlap;
    const inPlaceCorrection = smallGap && veryShort && isCorrection(turn.text);

    const isFollowUp =
      lastNewTaskTurn >= 0 &&
      (tightIteration || quickResume || inPlaceCorrection);

    if (isFollowUp) {
      // it's a follow-up on the current episode, not a fresh task
      if (veryShort && !highOverlap && !isCorrection(turn.text)) {
        turn.role = "continuation";
      } else {
        // re-check correction cue now that we know it's same-topic
        turn.role = isCorrection(turn.text) ? "correction" : "continuation";
      }
      turn.classifiedBy = "signal";
      meta[t].ambiguous = false;
    } else if (lastNewTaskTurn < 0) {
      // no prior boundary yet: this IS the first new_task
      turn.role = "new_task";
      turn.classifiedBy = "signal";
      meta[t].ambiguous = false;
      lastNewTaskTurn = t;
    } else if (someOverlap) {
      // same-ish topic but not strong enough to merge confidently (e.g. a doc-edit
      // follow-up hours later: "i think u should update subsection 3.6"). Text+gap
      // can't separate these from a fresh ask => genuinely ambiguous. Routed to the
      // optional LLM pass; defaults to new_task when --classify-llm is off.
      stillAmbiguous.push(t);
      // provisional new_task IS a boundary so the window resets for later turns
      lastNewTaskTurn = t;
    } else {
      // low overlap => fresh task
      turn.role = "new_task";
      turn.classifiedBy = "signal";
      meta[t].ambiguous = false;
      lastNewTaskTurn = t;
    }
  }

  // Third pass (optional): one cheap LLM batch over still-ambiguous boundaries.
  if (opts?.classifyLlm && stillAmbiguous.length > 0) {
    // build a tiny prior-task summary from the most recent new_task firstline
    let priorTask = "";
    for (let t = stillAmbiguous[0] - 1; t >= 0; t--) {
      if (turns[t].role === "new_task") {
        priorTask = turns[t].text.slice(0, 200);
        break;
      }
    }
    const candidates: LlmCandidate[] = stillAmbiguous.map((t) => {
      const turn = turns[t];
      const prev = t > 0 ? turns[t - 1] : null;
      const gapMs =
        prev && turn.ts && prev.ts ? tsToMs(turn.ts) - tsToMs(prev.ts) : NaN;
      const winLo =
        // recompute window lo for this turn
        (() => {
          for (let k = t - 1; k >= 0; k--)
            if (turns[k].role === "new_task") return turns[k].eventIndex;
          return 0;
        })();
      const winKw = windowKeywords(events, winLo, turn.eventIndex);
      const overlap = containment(keywordsOf(turn.text), winKw);
      return {
        idx: turn.idx,
        text: turn.text,
        gapSeconds: Number.isNaN(gapMs) ? 99999 : gapMs / 1000,
        topicOverlap: overlap,
      };
    });

    const llmRoles = await runClassifyLlm(priorTask, candidates);
    for (const t of stillAmbiguous) {
      const role = llmRoles.get(turns[t].idx);
      if (role) {
        turns[t].role = role;
        turns[t].classifiedBy = "llm";
      }
      // else: keep the provisional new_task / heuristic label (graceful fallback)
    }
  }

  return turns;
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (import.meta.main) {
  const { discoverSessions } = await import("../ingest/discover.ts");
  const arg = process.argv[2];
  const wantLlm = process.argv.includes("--classify-llm");
  if (!arg) {
    console.error("usage: bun run src/classify.ts <sessionId|path> [--classify-llm]");
    process.exit(1);
  }

  // Resolve arg to a session + jsonl path.
  let session: SessionInfo | undefined;
  let jsonlPath: string;

  if (arg.endsWith(".jsonl")) {
    jsonlPath = arg;
    const all = await discoverSessions();
    session = all.find((s) => s.jsonlPath === arg);
  } else {
    const all = await discoverSessions();
    session = all.find((s) => s.sessionId === arg);
    if (!session) {
      // maybe a partial/short id
      session = all.find((s) => s.sessionId.startsWith(arg));
    }
    if (!session) {
      console.error(`session not found: ${arg}`);
      process.exit(1);
    }
    jsonlPath = session.jsonlPath;
  }

  if (!session) {
    // synthesize a minimal SessionInfo from the path
    const events0 = await readEvents(jsonlPath);
    const sessionId = jsonlPath.split("/").pop()!.replace(/\.jsonl$/, "");
    session = {
      sessionId,
      project: "unknown",
      projectDir: "",
      cwd: events0.find((e) => e.cwd)?.cwd ?? "",
      jsonlPath,
      subagentsDir: null,
      startedAt: "",
      completedAt: "",
    };
  }

  const events = await readEvents(jsonlPath);
  const turns = await classifyTurns(session, events, { classifyLlm: wantLlm });

  const hist: Record<string, number> = {};
  for (const t of turns) {
    hist[t.role] = (hist[t.role] || 0) + 1;
    const first = t.text.replace(/\s+/g, " ").slice(0, 80);
    const tag = `${String(t.idx).padStart(3)}  ${t.role.padEnd(12)} (${String(
      t.charLen
    ).padStart(4)}c,${t.nImages}i) [${t.classifiedBy[0]}]`;
    console.log(`${tag}  ${JSON.stringify(first)}`);
  }
  console.log(`\n── role histogram (${turns.length} human turns) ──`);
  for (const [role, n] of Object.entries(hist).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${role.padEnd(13)} ${n}`);
  }
}
