---
name: web-competitive-research-with-fallback
description: "Use when asked to research, compare, or summarize information across multiple live competitor or product websites — e.g. \"visit these sites, capture the current pricing pages, save them to a folder, and summarize how they differ from X\". Triggers: competitive analysis, pricing-page comparison, market research, browser automation, screenshots of web pages, scraping prices/specs, multi-site research deliverables. Drives a browser to gather evidence but degrades gracefully to web search plus HTML page-text extraction when pages render slowly or show prices as images/canvas, and verifies that any 'save to folder' deliverable actually landed on disk before reporting it done."
license: Proprietary. LICENSE.txt has complete terms
compatibility: "Assumes an agent with browser-automation tools (navigate/screenshot) plus a web-search tool and read/write filesystem access. Browser screenshot persistence to the local filesystem may be unavailable in sandboxed environments — the workflow detects and works around this."
---

Use this when a request spans several live websites and asks you to gather, compare, and report — and especially when it also asks you to save artifacts (screenshots, page captures) to a folder. Browser capture of real sites is fragile, so plan for fallbacks and verify deliverables rather than assuming the tools worked.

## 1. Plan before browsing
Write a short tracked task list first: the sites to visit, the specific page on each (e.g. the pricing page, not the homepage), the artifacts to save, and the comparison to produce. This keeps a multi-site task from drifting and makes partial completion visible. (A tracked breakdown was the practice that kept the exemplar coherent.)

## 2. Probe the save path early — don't trust it at the end
If the deliverable includes "save screenshots/files to <folder>", do one capture-and-save **first**, then check that the file actually exists in the target folder before continuing. Screenshot/`save_to_disk`/`upload_image` calls can return success yet write nothing in a sandboxed filesystem. Discovering this on artifact #1 lets you adapt; discovering it at delivery means a failed promise. Run the bundled `verify-artifacts` check to confirm files landed.

## 3. Gather per site, with a fallback ladder
For each site, batch your browser actions (navigate, wait, capture) to cut round-trips. Heavy sites — especially media-rich regional ones — load slowly and often render prices in images or `<canvas>`, which screenshots capture but text extraction misses, and vice versa. When live capture stalls or the page text is unusable:
  1. Extract the rendered page's text/HTML directly instead of relying on the screenshot.
  2. Fall back to a web search for the same figures from the site or reputable secondary sources.
Capture the **source URL** for every figure you record, regardless of which tier produced it — the comparison must be citable.

## 4. Build the comparison
Fill in the bundled comparison template: one row/section per competitor with the key attributes, then an explicit "differences vs <baseline>" summary. Attribute every number to its source URL. Judge whether the figures are current and self-consistent before presenting them — a script can fetch text but only you can tell if a price looks stale or mislabeled.

## 5. Report honestly, including gaps
If an artifact could not be saved (e.g. screenshots wouldn't persist), state that plainly and deliver the substantive comparison anyway, noting where the data came from instead. A transparent gap with a working alternative is a partial success; a hidden gap is a failure. Never describe files as saved unless step 2's verification confirmed them.

## Edge cases
- Prices behind interaction (region/date selectors): set the selectors before capturing, or extract from the resulting URL/state.
- Anti-bot or login walls: don't brute-force; fall back to search and disclose the limitation.
- Localized/currency-varying pages: record the locale and currency alongside each figure so the comparison is apples-to-apples.

## Guardrails
- Confirm with a filesystem check that any 'save to folder' artifact actually exists (and is non-empty) before reporting it as saved; tool success codes can be misleading in sandboxes.
- Record a source URL for every figure presented so the comparison is independently verifiable.
- Disclose unmet deliverables and data-source substitutions plainly instead of presenting partial work as complete.
- Note currency/locale/date for each captured figure so comparisons stay apples-to-apples.

## Anti-patterns (observed failures to avoid)
- Treating browser screenshots as the only path to the data and getting blocked when pages render prices as image/canvas, instead of extracting page text or searching.
- Assuming save_to_disk / upload_image succeeded and only discovering at delivery that no files were written.
- Hiding the missing-screenshots gap or implying the folder was populated when it was not.
- Front-loading all browser captures sequentially without batching, multiplying slow round-trips on heavy sites.

## Bundled scripts
- `scripts/verify-artifacts.py` (python) — deterministic; prefer running this over re-deriving the steps by hand.

## Assets
- `assets/comparison-template.md` — template/resource to apply when producing the output.

## Related skills
- **browser-extract-with-fallback-tiers** (depends_on) — Reliable per-page extraction (screenshot -> page text -> search) is the gathering primitive this research workflow orchestrates across sites.
- **cite-sources-in-research-output** (see_also) — Every figure in the comparison must carry a source URL; a citation skill enforces that discipline.
