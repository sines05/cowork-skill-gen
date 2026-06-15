# Data Cleaning Report

**Source file:** `<path>`  
**Cleaned output:** `<path>`  
**Rows in → out:** `<n>` → `<n>`

## Target schema

| Column | Type | Source column(s) | Notes |
|--------|------|------------------|-------|
| <col>  | <type> | <raw> | <rule> |

## Rules applied per column

- `<column>`: <e.g. stripped currency symbol + thousands separators; coerced to float>
- `<column>`: <e.g. split unit suffix into `<unit_column>`>
- `<column>`: <e.g. parsed dates with formats X, Y; year-only → Jan 1>
- Missing values: treated `<tokens>` as empty.

## Change counts

- Values coerced to number: `<n>`
- Blanks/N-A found: `<n>` (per column: …)
- Rows dropped/deduplicated: `<n>`

## Assumptions & ambiguous cases (please review)

1. **<row / value>** — ambiguous because <reason>; assumed <decision>. Override if wrong.
2. **Year-only / partial dates** — <how handled>.
3. **Ambiguous units (per-unit vs total)** — <how handled>.
