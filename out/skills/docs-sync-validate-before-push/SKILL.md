---
name: docs-sync-validate-before-push
description: "Use when asked to update or clean up project documentation (README, *.md, docs/, config-reference docs) for clarity/accuracy, or to remove stale/scratch doc files (e.g. brainstorm/notes), especially when the same request also says to commit, push, or merge to main. Triggers: 'update all docs', 'make docs clearer/concise/accurate', 'delete the brainstorm file', 'sync docs then push/merge'. It reads the docs and referencing code first, edits for accuracy, sweeps for every reference to anything being removed, and—because users often want to review first—treats commit/push/merge as a separate, confirm-before-acting step rather than part of the doc edit."
license: Proprietary. LICENSE.txt has complete terms
compatibility: "Works in any repo with git and grep/ripgrep. Shell-chaining and helper-script syntax differ across shells (POSIX sh vs Bun Shell vs PowerShell on Windows); verify multi-command chains in the actual target shell before relying on them."
---

Update documentation so it matches what the code and config actually do, then stop before any push/merge until the user confirms. The two most common ways this task goes wrong are (1) editing prose without reading the source of truth, so the "fix" introduces new inaccuracies, and (2) treating "push and merge to main" as automatic when the user really wanted to review the edits first.

## 1. Read before you edit
Open the docs you're about to change AND the code/config they describe. Stale documentation is usually wrong about specifics (flags, costs, behavior, file names), so confirm each claim against the implementation rather than rephrasing the existing text. When the doc makes a quantitative or behavioral claim you can't see at a glance (e.g. "incremental cost", caching/resume behavior), inspect the relevant logic and state what's actually true instead of guessing.

## 2. Sweep for references before removing or renaming anything
Before deleting a scratch/brainstorm file or renaming a section, grep the whole repo for every reference to it (the filename, the section title, links). Removing the file without fixing inbound links leaves dangling references. Update or remove each hit, then re-grep to confirm none remain.

## 3. Edit for the reader
Favor clear, concise, complete, accurate text: short sentences, real defaults/values, consistent terminology, no contradictions between docs. If diagrams or tables exist, keep them consistent with the prose you just corrected.

## 4. Clean up any temporary artifacts you created
If you wrote a throwaway script or test to verify behavior (e.g. to confirm a command chains correctly), remove it once you've confirmed the answer so it doesn't get committed as noise.

## 5. Treat commit/push/merge as a separate, confirmed step
Even when the original request says "then push and merge to main", pause after the edits and surface a summary of what changed. Users frequently want to validate the doc/command changes before anything lands on main, and may redirect the work mid-way. Ask which branch should receive the change and get explicit confirmation before pushing or merging — pushing to main is hard to reverse and may not be what they meant.

## Handling interruptions and corrections
This kind of task often takes several correction turns, and a transient API/socket error can interrupt mid-edit. Keep changes small and committed-in-your-head step by step so that on resume you can pick up where you left off rather than redoing work. When the user redirects, re-anchor on their latest instruction rather than the original phrasing.

## Guardrails
- Get explicit confirmation of the target branch before pushing or merging to main; it is hard to reverse and the user may want to review edits first.
- Verify shell command chaining in the actual target shell before committing it into docs or scripts.
- Re-grep after removing a file to confirm no dangling references remain.

## Anti-patterns (observed failures to avoid)
- Following the literal 'then push and merge to main' instruction without pausing to confirm, when the user actually wanted to validate the changes first.
- Rephrasing stale docs without reading the source code/config, which preserves or introduces inaccuracies.
- Deleting a referenced file without sweeping for and fixing inbound links.
- Answering a quantitative/behavioral doc claim by guessing instead of inspecting the implementation.

## Related skills
- **code-review** (see_also) — Review the doc diff for accuracy/consistency before proposing to commit.
