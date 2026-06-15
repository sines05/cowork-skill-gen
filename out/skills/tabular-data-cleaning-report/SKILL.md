---
name: tabular-data-cleaning-report
description: "Use when a user hands you a messy spreadsheet or CSV/Excel export (competitor pricing, scraped listings, colleague-shared tables, real-estate or sales data) and asks you to clean, normalize, or standardize it into a tidy table and/or summarize what was changed. Triggers on phrases like 'clean this file', 'data is messy/lộn xộn', 'normalize the columns', 'standardize prices/units/dates', 'deduplicate', 'turn this into a clean table', 'fix the formatting', or 'tell me what you changed'. Handles inconsistent price/number formats, mixed units, ambiguous or partial dates, and N/A-style blanks, then produces a clean output plus a human-readable cleaning report that flags every assumption."
license: Proprietary. LICENSE.txt has complete terms
compatibility: "Assumes a shell with Python 3 and the pandas library available. Needs read access to the user's source file (request directory/file access first if sandboxed). Output paths should be writable."
---

Clean a messy tabular file into a tidy table **and** report what you changed, so the user can trust the result without re-checking every row.

## 1. Get access and look before you transform

If the file is outside your reachable directories, request access to its folder first rather than guessing the path — you cannot clean what you cannot read.

Read a sample of the raw file (header + a handful of rows, and a few rows from the middle/end) to learn the *actual* shape: delimiter, encoding, column names, and the messy patterns (mixed price formats, units glued to numbers, blank/`N/A` cells, partial dates). Plan the target schema — final column names and types — from what you observe, not from assumption.

For multi-step jobs, break the work into tracked tasks (read → define schema → write cleaner → run → verify → report). It keeps a messy job auditable and makes it obvious which transform produced which change.

## 2. Put the deterministic cleaning in a script

Parsing and normalizing varied formats is mechanical and error-prone to redo by hand, so write a small Python/pandas script (see `scripts/clean_table.py`) that:

- **Reads the file dynamically by path** and operates on every row. Do not paste sample rows into the code — hardcoded rows mean the script only "cleans" the examples you saw and silently ignores the rest of the file, which is the most common way this task goes wrong.
- Normalizes each messy column with an explicit rule (strip currency symbols and thousands separators from prices; split unit suffixes into their own column; parse dates with a known set of formats; map blank/`N/A`/`-` to a single missing value).
- Writes the cleaned table to a new file and never overwrites the source.
- Emits counts of what it changed (rows in/out, values coerced, blanks found) so the report is grounded in numbers, not vibes.

Run it against the full file, not a sample.

## 3. Keep judgement out of the script — verify the tricky cases yourself

A script can convert formats but cannot decide whether a conversion is *correct*. After running it, inspect the rows the data warned you about: ambiguous units (e.g. a value that could be per-unit or total), year-only or partial dates, unusual conversions, and anything that became missing. Confirm these read sensibly; fix the rule and re-run if not.

## 4. Report transparently — surface assumptions, don't bury them

Fill in `assets/cleaning-report.md`: the target schema, the rules applied per column, the change counts from the script, and an explicit list of every ambiguous case and the assumption you made for it. The user should be able to override any single decision after reading it. Do not present a clean table as if it were unambiguous when it required judgement calls — naming the assumptions is what makes the output trustworthy.

## Guardrails
- Read the source file by path and process every row; never embed sample rows in the cleaning code, which would leave most of the file untouched.
- Write cleaned data to a new file and leave the original untouched, so a bad rule is recoverable.
- Confirm or request access to the file location before reading, rather than guessing paths.
- State every judgement call (ambiguous units, partial dates, coerced blanks) in the report so the user can override it.

## Anti-patterns (observed failures to avoid)
- Hardcoding raw data rows into the cleaning script instead of reading the CSV/Excel dynamically.
- Presenting the cleaned table as unambiguous when it required assumptions, hiding the guesses.
- Freezing 'is this conversion correct?' judgement into the script instead of verifying tricky rows by hand after running it.

## Bundled scripts
- `scripts/clean_table.py` (python) — deterministic; prefer running this over re-deriving the steps by hand.

## Assets
- `assets/cleaning-report.md` — template/resource to apply when producing the output.
