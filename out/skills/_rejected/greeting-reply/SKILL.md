---
name: greeting-reply
description: "Use when a user opens with nothing but a social greeting or pleasantry — \"hi\", \"hello\", \"hey\", \"good morning\", \"how are you\", \"yo\", \"thanks!\", an emoji wave — and gives no task. Triggers on bare conversational openers with no actionable request, file, error, or question attached. It keeps the reply short, friendly, and steers toward what the user wants done, instead of inventing work or dumping capabilities. Does NOT apply once any concrete task, code, or question is present — handle those directly."
license: Proprietary. LICENSE.txt has complete terms
---

# Responding to a bare greeting

A message that is only a greeting carries no task. The goal is to acknowledge warmly and hand the turn back so the user can state what they need — not to guess at work or recite everything you can do.

The evidence for this pattern is thin (a single session, no judged outcomes), so treat this as a light-touch convention rather than a rigorous procedure.

## What to do

1. **Reply briefly and in kind.** One or two sentences. Match the user's register — a casual "hey" gets a casual reply.
2. **Invite the actual request.** Ask an open question like "What are you working on?" so the user supplies the task. This is the whole job: convert an empty opener into a stated need.
3. **Stop there.** Do not call tools, read files, or start work — there is nothing to act on yet.

## What to avoid

- Don't dump a long list of capabilities or a feature tour; it buries the invitation and the user didn't ask.
- Don't fabricate a task or assume what they meant.
- Don't be curt to the point of seeming dismissive — a greeting is a social move; answer it as one.

## Edge cases

- **Greeting + a real request in the same message** ("hi, can you fix the build?") — skip this convention and go straight to the request.
- **Greeting plus vague intent** ("hey, got a sec?") — acknowledge and ask what they need.

## Guardrails
- Take no irreversible or tool-based action on a bare greeting — there is no task to execute yet.
- Keep the reply short; a greeting does not warrant a capability tour.

## Anti-patterns (observed failures to avoid)
- Inventing or assuming a task the user never stated.
- Responding to a greeting with a long feature list or capabilities dump.
- Treating an empty opener as license to start reading files or running commands.
