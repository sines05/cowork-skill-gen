---
name: ground-changes-in-real-environment
description: "Use when integrating research findings or fixes into a codebase whose environment is uncertain — after switching host/OS, when storage or config paths are assumed rather than known, or when touching code that queries a database or reads on-disk data. Triggers: 'research where X is stored', 'find the storage path', 'fix this query', 'we moved to a new machine/host', edits involving file paths, DB columns/tables, or external data layouts. It makes you investigate the actual filesystem, host, and schema before editing, verify output against real data (not just 'runs without error'), and separate pre-existing breakage from changes you introduced."
license: Proprietary. LICENSE.txt has complete terms
compatibility: "Assumes a shell and a project with a typecheck/test command. Path conventions and storage locations differ across OSes (e.g. Linux vs Windows), so do not assume a fixed home or app-data layout — discover it. The bundled baseline script is bash; on Windows use Git Bash/WSL or run the equivalent commands manually."
---

# Ground changes in the real environment before editing

The failure mode this prevents: writing edits against an *assumed* environment — guessed storage paths, remembered column names, a host that has since changed — so the code looks done but targets things that don't exist. Investigate first, then edit, then verify against reality.

## 1. Confirm the host and where things actually live

Before writing any path, table name, or config reference, find out what is true *now*.

- Identify the current OS/host. Path conventions and app-data locations differ (a Linux `$HOME/.config/...` has no meaning on Windows, and vice-versa). After a host migration, anything you "remember" about paths is suspect.
- Discover storage locations by inspecting the real filesystem (list the candidate directories, search for the app's data folder) rather than reconstructing them from memory. A mode like a desktop "workspace" or background agent may store data in a non-obvious, app-specific location — look for it, don't assume it sits beside the obvious config.
- When the work touches a database, read the actual schema (table and column names) before writing a query. A query built from a guessed column name will run against the wrong shape and force a rework.

Why: the recurring waste here came from edits written to stale paths from a previous host, and a verification query that used the wrong columns — both discoverable up front in seconds.

## 2. Capture a baseline so you can tell pre-existing breakage from your own

Before changing anything, record the current state of the checks you'll rely on:

- Run the project's typecheck/test/lint once and save the output (see `scripts/capture-baseline.sh`).
- This gives you a reference point. If typecheck was already failing for unrelated reasons, you want to know that *before* you edit, so a later failure doesn't get mis-attributed to your change — and so you don't "fix" something you didn't break.

## 3. Edit, grounded in what you found

- Make the change against the verified paths/schema from step 1.
- If you encounter existing stub or placeholder code that is factually wrong (a hardcoded wrong path, an outdated assumption), correct it rather than building on top of it.

## 4. Verify against real data, not just "it ran"

"Runs without error" is not success. Exercise the change against real inputs and confirm the *output is correct*:

- Run the actual pipeline/extraction/query against real sessions or records and inspect what comes back.
- Re-run after your edits to check for regressions, not only that the happy path completes.

## 5. Diagnose failures honestly

- Compare new check output to the baseline from step 2. A failure present in the baseline is pre-existing — diagnose it as a repo/config issue and say so, rather than assuming your edit caused it (or silently absorbing blame).
- A failure that is new relative to the baseline is yours to fix.

## 6. Document and clean up

- Briefly record what you discovered (the real locations, the correct schema, whether a failure was pre-existing) so the next person doesn't repeat the investigation.
- Remove any temporary files, scratch scripts, or probe artifacts you created while investigating.

## Edge cases

- If you genuinely cannot locate the storage path, state that and list where you looked — do not fall back to a plausible-looking guess.
- If the schema and the code disagree, trust the schema (the live shape) and flag the code as out of date.

## Guardrails
- Never substitute a plausible-looking guessed path for a verified one; if you can't find it, say where you looked.
- Treat 'runs without error' as insufficient — confirm output against real data before calling it done.
- Capture a baseline before editing so failures are attributed honestly, not absorbed or mis-blamed.
- Remove temporary investigation artifacts before finishing.

## Anti-patterns (observed failures to avoid)
- Writing edits to paths remembered from a previous host/OS without checking the current filesystem.
- Building a query from assumed column or table names instead of reading the live schema.
- Assuming any check failure after your edit is caused by your edit, without comparing to a baseline.
- Building on top of factually wrong stub/placeholder code instead of correcting it.

## Bundled scripts
- `scripts/capture-baseline.sh` (bash) — deterministic; prefer running this over re-deriving the steps by hand.
