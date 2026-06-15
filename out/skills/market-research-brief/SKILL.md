---
name: market-research-brief
description: "Use when the user asks for market research, competitive analysis, industry sizing, pricing comparisons, vendor/product landscapes, or any request to gather and summarize external facts and figures (e.g. 'compare these tools', 'what's the market size for X', 'who are the top competitors', 'pricing of Y vs Z'). Produces a sourced, structured comparison. Triggers on keywords like market research, competitor, landscape, pricing, market size, TAM, vendor comparison, trends. Routes here whenever the deliverable is synthesized external data the user will treat as fact."
license: Proprietary. LICENSE.txt has complete terms
compatibility: "Requires a web search / browsing tool to gather current data. Works in any environment that exposes web search (e.g. Claude Code with WebSearch)."
---

# Market research brief

Turn an open-ended "find out about X" request into a sourced, comparable deliverable. The two things that go wrong with research requests are unverifiable figures and a deliverable the user can't quickly scan — both are preventable.

## 1. Frame the request as tracked tasks first

Before searching, restate what's being asked and break it into the concrete questions you need to answer (e.g. "market size", "top 5 competitors", "pricing tiers"). Track them so nothing in a multi-part request gets dropped. Multi-part research requests are easy to half-answer; an explicit task list makes the gaps visible.

## 2. Triangulate — don't trust a single source

Run several targeted searches per question rather than one broad one, and cross-check figures across at least two independent sources. Market numbers vary wildly between sources and dates; a figure confirmed by two sources is far more trustworthy than one pulled from the first hit.

## 3. Cite every figure inline, with its date

Whenever you state a number or a claim of fact, attach the source and (where it matters) the as-of date right there — not in a trailing "sources" dump. The recurring failure here is figures presented as fact with no way to verify freshness or provenance. If you could not find a reliable source for something, say so explicitly rather than presenting an estimate as fact.

## 4. Synthesize into a structured comparison

When the request compares things (vendors, products, plans, segments), put the result in a markdown table with one row per item and one column per dimension, so differences are scannable at a glance. Fill in the bundled template rather than re-inventing a layout each time. Lead with a 2–3 sentence takeaway above the table.

## 5. Flag confidence and gaps

Close with what you're confident in, what's uncertain or stale, and what a human should verify before acting on it. Research is decision input — the user needs to know where the soft spots are.

## Edge cases

- **Conflicting figures across sources:** show the range and cite both, don't silently pick one.
- **No recent data:** state the most recent year you found and label it; don't extrapolate silently.
- **Request is genuinely subjective** ("which is best"): separate verifiable facts (in the table) from your judgement (in the takeaway).

## Guardrails
- Attach a source and as-of date to every figure inline; never present an unsourced number as established fact.
- When sources conflict, show the range and cite each rather than silently choosing one.
- Surface confidence and gaps so the user knows what to verify before acting on the research.

## Anti-patterns (observed failures to avoid)
- Stating market figures or comparisons as fact with no inline citation or date.
- Relying on a single search result instead of triangulating across independent sources.
- Returning free-form prose for a comparison request instead of a scannable table.

## Assets
- `assets/comparison-template.md` — template/resource to apply when producing the output.
