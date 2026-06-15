---
name: competitive-pricing-research
description: "Use when asked to research competitors' current pricing, plans, or product specs from their websites and produce a comparison against a reference brand — e.g. 'visit these companies' sites, capture their pricing pages, and summarize how they differ from X'. Triggers: competitive analysis, competitor pricing tables, market/price comparison, 'so sánh giá', real-estate/SaaS/retail price benchmarking, screenshot-the-pricing-page requests. Especially relevant when target sites are heavy, lazy-loaded, or render pricing as images/canvas/video that resist clean text capture. It guides you to gather verifiable figures with sources, fall back to text extraction when visual capture fails, and deliver a sourced comparison table while honestly flagging any capture limitation."
license: Proprietary. LICENSE.txt has complete terms
compatibility: "Assumes a browser/web-automation capability (e.g. a headless browser or browser extension) plus a web-search tool and HTML fetch. Note that some sandboxes cannot persist browser-extension screenshots to the local filesystem; confirm write access before promising saved image files."
---

## Goal

Produce a **sourced comparison** of competitors against a reference brand — typically pricing, plans, or specs gathered from live sites — and deliver it reliably even when the pages fight back.

## Why this skill exists

The naive approach (open each site → screenshot the pricing page → save images to a folder → summarize) is fragile: many sites render pricing as images, `<canvas>`, or video, lazy-load on scroll, and some sandboxes can't persist browser screenshots to disk. When that happens the *visual* deliverable silently fails while the user still wanted the *answer*. Plan for the text answer first; treat screenshots as a nice-to-have.

## Steps

1. **Restate the deliverable and split it into tracked todos** — one per competitor plus one for the final comparison. Capture the explicit asks separately (e.g. "save screenshots to folder" vs "summarize differences") so a failure in one doesn't sink the other.

2. **Check what your environment can actually persist before promising files.** If the task asks for saved screenshots, verify you can write image files to the target folder. If you can't, say so early rather than discovering it at the end — the comparison itself is usually the real goal.

3. **Try to load each target page and extract the data as text/HTML first.** Text extraction is what you can cite and compare; a screenshot is not. Pull the actual numbers (prices, plan names, units) into structured notes with the source URL beside each figure.

4. **When a page loads poorly or renders pricing as non-textual media, fall back to web search.** Search for the competitor's pricing alongside the segment/region in the request, prefer the official page or a recent reputable source, and record the URL. This fallback is what turns a blocked capture into a usable answer.

5. **Capture screenshots opportunistically, not as the load-bearing step.** If visual capture works and is persistable, include it. For lazy/heavy pages, wait for content and scroll before capturing, but cap retries — don't loop indefinitely on a page that serves pricing as canvas/video, since a clean capture may be impossible there.

6. **Fill in the comparison deliverable** (see the bundled template): a row per competitor with concrete figures, the reference brand as the baseline, a short "key differences" synthesis, and a source link for every figure. Don't present a number you can't attribute.

7. **Disclose limitations plainly.** If screenshots couldn't be saved, or a site's pricing couldn't be read directly and a figure comes from a secondary source, state that in the deliverable. Transparent gaps beat a confident-looking table built on guesses.

## Edge cases

- **Pricing behind a form / region selector:** set the region the user asked about before reading values; note if pricing is quote-only.
- **Stale or conflicting sources:** prefer the official site; if you must use a third party, date it and flag the uncertainty.
- **Currency/units differ across competitors:** normalize or label units so the comparison is honest.

## Guardrails
- Verify the environment can persist screenshot files before promising saved images; if it can't, disclose that and prioritize the textual comparison.
- Attach a source URL to every figure presented; never show a price you cannot attribute.
- When a figure comes from a secondary source rather than the competitor's own page, flag the uncertainty and date it.
- Cap capture retries on heavy/canvas/video pages instead of looping indefinitely on a capture that may be impossible.

## Anti-patterns (observed failures to avoid)
- Treating screenshot-to-folder as the load-bearing step, so the whole task fails when capture or file-persistence is blocked.
- Relying on visual capture of pricing rendered as images/canvas/video, which yields no citable, comparable data.
- A rigid plan>explore>search>edit>present march that doesn't pivot to text/search fallback when pages don't render cleanly.
- Presenting a confident comparison table while silently hiding that some figures couldn't be captured or verified.

## Assets
- `assets/comparison-template.md` — template/resource to apply when producing the output.

## Related skills
- **web-research** (see_also) — general fallback for extracting facts and sources when live pages don't render cleanly
