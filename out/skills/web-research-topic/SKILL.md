---
name: web-research-topic
description: "Use when the user asks you to open the web and research a topic, market, company, product, or current trend in detail — triggers include 'research', 'look up', 'find out about', 'market research', 'nghiên cứu', 'mở web', or any request for up-to-date facts you cannot answer from memory. Covers turning an open-ended research request into actual fan-out web searches, source fetching, and a synthesized, cited answer. Especially relevant when the request names a recency window ('this month', 'latest', 'current') or asks for detail/comparison that needs multiple sources."
license: Proprietary. LICENSE.txt has complete terms
compatibility: "Requires web search and fetch tools (e.g. WebSearch/WebFetch or an equivalent search MCP). No OS-specific assumptions."
---

Turn an open-ended research request into delivered, cited findings. The common failure here is stalling: discovering or selecting a tool and ending the turn before any search, fetch, or synthesis happens. Treat tool discovery as a means, not the deliverable — keep going until you have produced an answer.

## 1. Pin down the question first
Restate the topic, the scope, and any recency window the user gave ('this month', 'latest') before searching. If the request is genuinely ambiguous on a dimension that changes the answer (region, time range, which entity), ask one or two focused questions; otherwise proceed with a reasonable default and state it. Do not let clarification become another reason to stall.

## 2. Fan out, don't single-shot
Issue several targeted searches from different angles rather than one broad query — e.g. the entity by name, the entity plus the recency window, and an adjacent angle (competitors, regulation, recent events). A single query usually misses the picture; varied queries surface what any one angle is blind to.

## 3. Fetch and read the promising sources
Search result snippets are not enough for a 'detailed' answer. Open the most relevant and most recent sources and read them. Prefer primary or reputable sources; note the publication date so you can tell the user how current each fact is.

## 4. Verify before you assert
For any claim that matters (numbers, dates, 'the latest X'), confirm it appears in at least one fetched source, and cross-check surprising figures against a second source. Distinguish what the sources actually say from your own inference.

## 5. Synthesize and deliver — every turn ends with output
Produce the answer: a short summary, the key findings organized by sub-topic, and inline source links. If you ran out of time or a search failed, deliver what you have plus what is still open — never end silently on an in-progress tool call. State the recency of the data and any gaps.

## Note
For large multi-source, fact-checked reports, a dedicated deep-research workflow may be a better fit than ad-hoc searching — route to it when the user wants exhaustive, adversarially-verified coverage.

## Guardrails
- Verify load-bearing facts against fetched sources before asserting them; cross-check surprising figures against a second source.
- State the recency of the data and any gaps rather than implying completeness.

## Anti-patterns (observed failures to avoid)
- Ending the turn after tool discovery / selection without running any search or producing output.
- Relying on a single broad query instead of several targeted ones.
- Answering from memory for a request that explicitly asks to use the web or names a recency window.

## Related skills
- **deep-research** (see_also) — Heavier fan-out + adversarial verification harness for exhaustive, fact-checked reports; route there when ad-hoc searching is not thorough enough.
