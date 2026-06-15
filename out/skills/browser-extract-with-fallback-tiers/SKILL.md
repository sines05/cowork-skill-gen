---
name: browser-extract-with-fallback-tiers
description: "Use when retrieving or summarizing information from a live web app via browser automation — reading email inboxes, web-rendered spreadsheets, dashboards, or any page where you must navigate, locate a specific record, and extract its values. Triggers: 'open the browser and summarize my latest emails', 'find this row/student/order in the web app', 'read this online spreadsheet', tasks mentioning Brave/Chrome/an open browser window, canvas- or iframe-rendered content that plain page-text scraping misses, or extraction that needs a downstream computation. Encodes a tiered extraction fallback (page-text → JS DOM query → screenshot/computer-use → zoom/scroll) for when a single method is blocked or returns empty, plus disambiguating the target record before reading and verifying derived values."
license: Proprietary. LICENSE.txt has complete terms
compatibility: "Requires a browser-automation environment with at least one of: page-text extraction, JavaScript/DOM evaluation, and a screenshot/computer-use vision tool. The user must already be authenticated in the target web app (an open, logged-in browser window). No OS assumptions beyond a graphical browser session."
---

Retrieve information from a live, logged-in web app when plain scraping is unreliable. The core idea: don't commit to one extraction method — escalate through tiers when a tier is blocked or returns empty, pin down exactly which record you're reading before you read it, and re-derive any computed value rather than trusting a glance.

## 1. Orient before acting

Identify which already-open, authenticated window/tab holds the target app before issuing any action. When two browser windows are open, focus and act on the wrong one is a common failure — confirm the active window matches the app you intend to drive, and re-assert focus before each interaction rather than assuming it persisted.

## 2. Disambiguate the target record first

If the task is to read a *specific* row, message, student, order, or entry, get the unambiguous key (ID, exact email subject+sender, order number) from the user **before** locating it. Guessing the row from a partial description and then reading the wrong one wastes the whole extraction. Asking one short question up front is cheaper than a confident wrong answer.

## 3. Extract through fallback tiers (escalate only when blocked or empty)

Start at the cheapest tier and escalate only when the current tier is blocked or returns nothing usable. Each tier reaches content the previous one cannot:

1. **Page-text extraction** — fastest; works for ordinary HTML text. If it returns empty or misses rows that are clearly visible on screen, the content is likely script-rendered or virtualized — escalate.
2. **JavaScript / DOM query** — evaluate a selector against the live DOM to pull structured rows (e.g. message list items, table cells) that flat page-text dropped. Use when text extraction captured the chrome but not the data rows.
3. **Screenshot + vision / computer-use** — for content rendered to a `<canvas>` or inside a cross-origin `<iframe>` (common with web spreadsheets and embedded viewers), text and DOM tools see an opaque element. Read the pixels instead.
4. **Zoom / scroll then re-capture** — when a screenshot is too small to read or the data is below the fold or lazy-loaded, zoom in or scroll the container and re-capture in segments.

Prefer in-page extraction over downloading the artifact. Download is often intercepted by a safety/permission filter and adds a long detour; only attempt it if every in-page tier fails and the user expects a file.

## 4. Verify derived and high-stakes values

If the answer is computed (a grade, total, ranking, status threshold), re-derive it from the raw extracted inputs using the stated rule rather than reporting a value read at a glance. For category/threshold outputs (letter grades, tiers, pass/fail), check the boundary carefully — adjacent buckets (e.g. A vs A+) are an easy mis-read. State the raw inputs alongside the conclusion so the user can spot an error.

## 5. Correct cleanly when questioned

If the user pushes back on a value, re-extract and re-compute rather than defending the first answer — the tiered pipeline has several places a single read can go wrong, and a quick recheck against the source is the fastest way to resolve it.

## Edge cases
- Empty page-text on a visibly-populated page → assume script-rendered, jump to DOM/vision; don't conclude "no data".
- Virtualized lists only render visible rows — scroll and accumulate, or query the data source, rather than reading once.
- A blocked download is not the end state — fall back to reading on-page.

## Guardrails
- Confirm the active browser window is the intended app before acting; with multiple windows open, focus on the wrong one corrupts the result.
- Operate only on a window the user has already authenticated; do not attempt to bypass login or safety filters.
- Prefer in-page extraction over downloading files, since downloads are often blocked by a safety filter and add risk and delay.
- Report raw extracted inputs alongside any computed answer so errors are visible and auditable.

## Anti-patterns (observed failures to avoid)
- Committing to a single extraction method and concluding 'no data' when page-text returns empty on a visibly-populated, script-rendered page.
- Guessing which record the user means instead of asking for an unambiguous ID first.
- Reading a computed value (grade/total/tier) at a glance instead of re-deriving it from raw inputs.
- Defending the first answer when the user questions it rather than re-extracting and re-computing.
- Burning time on repeated download attempts when an in-page screenshot/DOM read would have worked.

## Related skills
- **browser-login** (depends_on) — The target app must be authenticated in an open window before this skill can navigate and extract.
- **summarize-content** (followed_by) — Once rows/records are extracted, the natural next step is condensing them into a summary for the user.
