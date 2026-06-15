---
name: browser-info-extraction
description: "Use when a task means reading information out of a live web page in a browser — summarizing emails in a webmail inbox, pulling rows from an online spreadsheet, reading a dashboard, or extracting any on-screen data that the user references by browser (Brave/Chrome/Firefox, Gmail, Outlook, Excel Online, Google Sheets, web tables). Triggers: 'go to my mail and summarize', 'read the values from this page', 'find the row for X', 'what does this dashboard say'. Drives the page, extracts the data with a tiered fallback when plain text fails (canvas/iframe content), and verifies the answer before reporting it."
license: Proprietary. LICENSE.txt has complete terms
compatibility: "Assumes an agent that can drive a browser and read page content across multiple tiers: page-text extraction, JavaScript/DOM query, and a visual fallback (screenshot / computer-use). Works against any Chromium or Firefox-family browser; no OS-specific assumption."
---

Extract information from a live web page reliably by escalating through extraction tiers and verifying before you answer. Plain page-text often misses the data (rows rendered late, content drawn on a `<canvas>` or inside an `<iframe>`), so a single extraction attempt is the main reason these tasks go wrong.

## 1. Pin down what's being asked before you navigate

If the request points at a specific item — a particular email, a student/order/row by some key — ask for the identifying value up front rather than guessing which row matches. Guessing and then locating the wrong row wastes a full navigation cycle and produces confidently wrong answers.

## 2. Identify the right window and tab

When more than one browser window is open, confirm which window and tab actually holds the target before acting. Focus tangled between two windows leads to actions landing on the wrong page. Bring the intended window to the front and verify the URL/title matches before extracting.

## 3. Extract with a tiered fallback — escalate only when blocked

Start cheap and escalate. Each tier handles content the previous one can't:

1. **Page-text** — read the rendered text directly. Fastest; works for normal HTML.
2. **JavaScript / DOM query** — when page-text returns nothing useful or drops rows (lazy-rendered lists, virtualized tables), query the DOM for the specific elements (e.g. the email-row or table-row selectors). This is the usual fix when an inbox or list looks empty to text extraction.
3. **Visual / screenshot (computer-use)** — when the data is drawn on a `<canvas>` or sealed in an `<iframe>` (Excel Online, some dashboards), text and DOM tools see nothing. Read it from a screenshot, scrolling/zooming the viewport to bring all the data into frame.

Don't burn time on dead ends: if the content is a canvas/iframe, recognize it early and go visual rather than chasing downloads or exports, which are frequently blocked by safety filters or auth and add a long detour.

## 4. Verify before you report

Don't report the first value you read as final. Sanity-check it:

- If the answer is *computed* (a grade, a total, a derived status), re-compute it from the underlying inputs and the stated rule/formula rather than trusting a displayed summary.
- Watch boundary cases that are easy to misread (e.g. a threshold that flips one category into the next — an `A` vs `A+`, `pass` vs `fail`, off-by-one on a cutoff).
- Cross-check the extracted value against a second tier when feasible (e.g. confirm the screenshot reading against a DOM value).

## 5. Self-correct openly when challenged

If the user questions your answer, re-open the source and re-derive it rather than defending the first reading. Initial extractions and boundary judgments are exactly where errors hide; treat a challenge as a signal to re-verify, and state the corrected result plainly.

## Edge cases

- **Empty-looking list:** almost always a rendering/lazy-load issue, not an empty inbox — drop to DOM query before concluding there's no data.
- **Download/export blocked:** expected; pivot to on-page reading (DOM or visual) instead of fighting the filter.
- **Data spans multiple screens:** scroll and accumulate; confirm you captured the full count the user asked for (e.g. all 10 items, not the 6 that fit on screen).

## Guardrails
- Confirm the correct browser window and tab before acting, since focus can land actions on the wrong page when multiple windows are open.
- Do not report the first extracted value as final for computed results — re-derive from the underlying inputs and the stated rule, especially near category boundaries.
- Ask for the identifying key (ID, name, row) before locating a record instead of guessing which one the user means.

## Anti-patterns (observed failures to avoid)
- Concluding a list/inbox is empty after a single page-text extraction, when the rows are actually lazy-rendered and need a DOM query.
- Chasing downloads or exports to read canvas/iframe content (Excel Online, dashboards) — these are commonly blocked and waste a cycle; read the data visually instead.
- Defending the first answer when the user pushes back rather than re-opening the source and re-deriving it.
