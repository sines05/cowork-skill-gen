---
name: web-research-synthesis
description: "Use when the user asks you to research a topic on the web and report back in detail — market/competitor/industry research, news roundups, \"look up / mở web và nghiên cứu / find out the latest on X\", trend or price analysis, or any request to gather current information from the internet and synthesize it. Triggers on phrases like \"research\", \"look up\", \"find the latest\", \"what's happening with\", \"market this month\", \"in detail\". Drives the full loop: scope the question, run real web searches, read sources, and deliver a cited written synthesis — rather than stopping at tool discovery."
license: Proprietary. LICENSE.txt has complete terms
compatibility: "Requires a web search/fetch capability (e.g. WebSearch + WebFetch tools or equivalent browser access). No OS-specific assumptions."
---

Your job is to finish the research and hand back a written, source-cited answer — not to merely set up tools. The most common failure here is stopping after discovering or selecting a search tool, so the burden is on you to push through to a delivered synthesis in the same turn.

## 1. Pin down the question before searching
Restate the topic, the scope, and the time window in one sentence. Many research prompts are time-bound ("this month", "latest", "recent") — convert that to an explicit date range using today's date so your queries and your final report don't silently mix stale and current information. If the scope is genuinely ambiguous (which entity, which market, which region), pick the most reasonable interpretation, state it, and proceed; don't stall waiting for clarification on a researchable question.

## 2. Search for real, then read
Issue concrete search queries that include the entity plus the time window plus the angle (e.g. "<entity> <topic> <month year>"). Run several queries from different angles rather than one broad one — a single query rarely covers a multi-part question. Then actually open the most promising results and read them; search snippets alone are not evidence. Prefer primary and recent sources, and note the publication date of each so you can weigh freshness.

## 3. Cross-check before you trust
Treat a single source as a lead, not a fact. Corroborate key numbers and claims across at least two independent sources, and flag anything you could only find in one place as unverified. Watch for sources that are outdated relative to the requested window.

## 4. Synthesize and deliver — every time
The deliverable is a written report, not a pile of links. Fill in the bundled report template: a short summary up top, then findings organized by sub-topic, each claim attributed to its source with a URL, then explicit gaps or open questions. Even if results are thin, deliver what you found and say what you couldn't confirm — a partial, honest synthesis is the success condition; an in-progress tool call is not.

## Edge cases
- If a search returns nothing useful, reformulate (synonyms, narrower/broader terms, different language) rather than giving up after one attempt.
- If the request is in a non-English language, search in that language too — local-language sources are often the best for local-market topics.
- If the topic moves fast, lead with the most recent datapoints and timestamp them.

## Guardrails
- Always finish the loop within the turn: a research request is satisfied only by a delivered, written synthesis, never by an in-progress tool call.
- Attribute claims to sources with URLs and dates so the user can verify; do not present unsourced assertions as findings.
- Corroborate key facts across independent sources and explicitly label single-source claims as unverified.
- Respect the requested time window — do not pass off stale results as current.

## Anti-patterns (observed failures to avoid)
- Stopping after discovering or selecting a search tool without actually searching or synthesizing (the observed abandonment).
- Re-asking or re-stating the prompt instead of proceeding when the question is researchable as stated.
- Running a single broad query and giving up when it returns little, instead of reformulating.
- Returning a list of links or raw snippets in place of a synthesized, cited report.

## Assets
- `assets/research-report-template.md` — template/resource to apply when producing the output.
