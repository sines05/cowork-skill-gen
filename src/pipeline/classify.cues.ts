// classify.cues.ts — role-cue heuristics + constants used by classify.ts.
// Approval / correction / continuation / paste detection, plus the interrupt marker.

export const INTERRUPT_MARKER = "[Request interrupted by user]";

// ── Approval (short acknowledgements) ─────────────────────────────────────────
// Multilingual: English + Vietnamese. These are PURE acknowledgement/praise with
// no follow-up instruction; kept SHORT-only (≤40 chars, see isApproval) so longer
// turns that merely contain "ok"/"được" but also carry a real request don't match.
export const APPROVAL_PHRASES = [
  "ok",
  "okay",
  "yes",
  "yep",
  "yeah",
  "go",
  "go ahead",
  "continue",
  "lgtm",
  "perfect",
  "great",
  "thanks",
  "thank you",
  "do it",
  "sounds good",
  "proceed",
  "👍",
  // Vietnamese pure acks / praise (no instruction):
  "được",
  "đúng",
  "đúng rồi",
  "ổn",
  "tốt",
  "tuyệt",
  "chuẩn",
  "ngon",
  "cảm ơn",
  "cám ơn",
  "duyệt",
  "đồng ý",
  "ok nhé",
];

// Strip trailing punctuation/whitespace and lowercase for ack matching.
export function normalizeAck(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s.!,]+$/g, "")
    .trim();
}

export function isApproval(text: string): boolean {
  if (text.length === 0 || text.length > 40) return false;
  const norm = normalizeAck(text);
  if (APPROVAL_PHRASES.includes(norm)) return true;
  // allow "ok go", "yes do it", "ok continue" style two-word acks
  if (norm.length <= 20) {
    const words = norm.split(/\s+/);
    if (words.length <= 3 && words.every((w) => APPROVAL_PHRASES.includes(w))) return true;
  }
  return false;
}

// ── Correction cues ───────────────────────────────────────────────────────────
// Multilingual pushback/fix prefixes. A leading negation or "redo this differently"
// marker signals the user is fixing the assistant's last action, not opening a new
// task. Vietnamese negations ("không"/"chưa") most commonly appear at turn start
// ("Không, hãy ..."), so prefix matching is the right shape here.
export const CORRECTION_PREFIXES = [
  "no ",
  "no,",
  "nope",
  "actually",
  "instead",
  "wait",
  "that's wrong",
  "thats wrong",
  "wrong",
  "revert",
  "undo",
  "not ",
  "don't",
  "dont",
  "stop",
  // Vietnamese pushback / fix prefixes:
  "không", // "Không," / "Không, hãy ..." at start = correction
  "ko ", // colloquial "không"
  "sai", // "sai rồi" = wrong
  "chưa", // "chưa đúng" = not yet right
  "khoan", // "khoan đã" = hold on / wait
  "dừng", // stop
  "sửa lại", // redo / fix
  "thay vào đó", // instead
  "thực ra", // actually
  "vẫn", // "vẫn <problem>" = still <problem> (Vietnamese "still")
];

export function isCorrection(text: string): boolean {
  const t = text.toLowerCase().trim();
  if (t === "no" || t === "nope") return true;
  for (const p of CORRECTION_PREFIXES) {
    if (t.startsWith(p)) return true;
  }
  // "still <problem>" — e.g. "still failing", "still broken", "still not working".
  // Vietnamese "vẫn" (still) is already covered as a prefix above.
  if (/^still\b/.test(t)) return true;
  return false;
}

// ── Continuation cues ─────────────────────────────────────────────────────────
// Additive follow-ups that extend the in-progress task rather than open a new one.
// "also ...", "and also ...", "then ...", "plus ..." are near-certain follow-ups
// in this corpus. (A correction cue still wins if both match.)
// Multilingual: Vietnamese "proceed / keep going / additive" cues are added below.
// These also matter for a CRITICAL disambiguation: short Vietnamese "go on" turns
// like "Tiếp tục" / "Áp dụng đi" are CONTINUATIONS, not approvals — and because a
// near-end approval is later promoted to an explicit_user_approval success signal,
// so mislabeling one would inflate success. So heuristicRole checks this BEFORE
// isApproval (see heuristicRole), letting a continuation cue win over a false ack.
export const CONTINUATION_PREFIXES = [
  "tiếp tục", // continue
  "tiếp theo", // next
  "tiếp", // go on (also a prefix of the above — order doesn't matter, all return)
  "rồi", // "then / done, now ..."
  "sau đó", // after that
  "còn", // "and also / what about"
  "thêm", // add more
  "nữa", // "more / again"
  "áp dụng", // apply (e.g. "Áp dụng đi" = apply it / go ahead applying)
  "triển khai", // implement / roll out
  "làm tiếp", // keep working
  "cũng", // "also"
  "và", // "and ..."
];

export function isContinuationCue(text: string): boolean {
  const t = text.toLowerCase().trim();
  if (/^also\b/.test(t)) return true;
  if (/^and\s+(also|then)\b/.test(t)) return true;
  if (/^then\b/.test(t)) return true;
  if (/^plus\b/.test(t)) return true;
  if (/^and\s+/.test(t)) return true;
  // Vietnamese additive / proceed cues at turn start.
  for (const p of CONTINUATION_PREFIXES) {
    if (t.startsWith(p)) return true;
  }
  return false;
}

// ── Paste detection ─────────────────────────────────────────────────────────
// Pasted log/listing/output with no request cue. Tuned against the real corpus:
// rsync transfers, file listings (-rwx...), tracebacks, "reset by peer", shell echoes.
export const LOG_TOKENS = [
  "rsync:",
  "xfer#",
  "to-check=",
  "reset by peer",
  "broken pipe",
  "client_loop:",
  "traceback (most recent call last)",
  "send disconnect",
  "connection reset",
  "permission denied (publickey",
];

export const REQUEST_CUES = [
  "?",
  "can you",
  "could you",
  "please",
  "let",
  "write",
  "add",
  "create",
  "make",
  "fix",
  "update",
  "remove",
  "implement",
  "how",
  "why",
  "what",
  "should",
  "i want",
  "i need",
  "i think",
];

export function hasRequestCue(text: string): boolean {
  const t = text.toLowerCase();
  return REQUEST_CUES.some((c) => t.includes(c));
}

export function isPaste(text: string): boolean {
  if (text.length < 60) return false; // pastes are bulky
  const lower = text.toLowerCase();

  // classic log tokens are a near-certain paste signal
  const hasLogToken = LOG_TOKENS.some((tok) => lower.includes(tok));

  const lines = text.split("\n");
  // shell-prompt echo: line containing "user@host ... %" or "$ "
  const shellEcho = lines.some(
    (l) => /\w+@[\w.-]+.*[%$]\s/.test(l) || /^\s*\$ /.test(l)
  );
  // stack-trace frames: "  at file:line" or 'File "...", line N'
  const traceFrames =
    /\n\s*at\s+\S+:\d+/.test(text) || /File ".*", line \d+/.test(text);
  // file-listing rows: permission bits or many "size date path" rows
  const listingRows = lines.filter((l) =>
    /^[-d][rwx-]{9}/.test(l.trim()) || /\b\d{2,}%\b.*\d{2}:\d{2}:\d{2}/.test(l)
  ).length;
  // process-table rows (top/ps/htop dumps): a long run of whitespace-separated
  // numeric columns, e.g. "1002677 root 20 0 2031404 518696 8688 S 102.6 ..."
  const procTableRows = lines.filter((l) => {
    const cols = l.trim().split(/\s+/);
    if (cols.length < 6) return false;
    const numeric = cols.filter((c) => /^\d[\d.,%]*$/.test(c)).length;
    return numeric >= 4;
  }).length;

  // ratio of lines that start with a non-letter (logs/listings tend to)
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  const nonLetterStart = nonEmpty.filter(
    (l) => !/^[A-Za-z]/.test(l.trim())
  ).length;
  const nonLetterRatio = nonEmpty.length ? nonLetterStart / nonEmpty.length : 0;

  const looksLikeLog =
    hasLogToken ||
    shellEcho ||
    traceFrames ||
    listingRows >= 2 ||
    procTableRows >= 2 ||
    (nonEmpty.length >= 4 && nonLetterRatio >= 0.6);

  if (!looksLikeLog) return false;

  // A paste must NOT carry a request cue. But a hard log token (rsync/traceback/
  // process-table/listing) overrides a stray cue word, since users paste these
  // raw without asking anything.
  if (
    hasLogToken ||
    traceFrames ||
    listingRows >= 2 ||
    procTableRows >= 2 ||
    shellEcho
  ) {
    // even with these, if the FIRST line is clearly an instruction, it's not a paste
    const firstLine = (nonEmpty[0] || "").toLowerCase();
    if (/[?]/.test(firstLine) && firstLine.length < 120) return false;
    return true;
  }
  return !hasRequestCue(text);
}
