#!/usr/bin/env python3
"""Clean a messy CSV/Excel table into a tidy file + change stats.

Reads the WHOLE file dynamically by path. Edit the per-column rules in
normalize() for your schema; never paste raw data rows into this script.

Usage: python clean_table.py <input> <output.csv> [--sheet NAME]
"""
import sys
import re
import argparse
import json

try:
    import pandas as pd
except ImportError:
    sys.exit("pandas is required: pip install pandas openpyxl")

MISSING_TOKENS = {"", "n/a", "na", "nan", "-", "--", "none", "null"}


def read_any(path, sheet):
    if path.lower().endswith((".xlsx", ".xls")):
        return pd.read_excel(path, sheet_name=sheet or 0, dtype=str)
    # try utf-8 then a permissive fallback; sniff the separator
    for enc in ("utf-8-sig", "latin-1"):
        try:
            return pd.read_csv(path, dtype=str, sep=None, engine="python", encoding=enc)
        except (UnicodeDecodeError, pd.errors.ParserError):
            continue
    sys.exit(f"Could not read {path}")


def to_missing(v):
    if v is None:
        return None
    return None if str(v).strip().lower() in MISSING_TOKENS else str(v).strip()


def parse_number(v):
    """Strip currency/thousands separators, keep the numeric core."""
    if v is None:
        return None
    s = re.sub(r"[^0-9,.\-]", "", str(v))
    if not s:
        return None
    # if both separators present, assume ',' is thousands
    if "," in s and "." in s:
        s = s.replace(",", "")
    else:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def split_unit(v):
    """Return (number, unit_text) from a value like '5 tỷ/căn'."""
    if v is None:
        return None, None
    m = re.match(r"\s*([\d.,\-]+)\s*(.*)$", str(v).strip())
    if not m:
        return None, str(v).strip()
    unit = m.group(2).strip() or None
    return parse_number(m.group(1)), unit


def normalize(df, stats):
    """Apply per-column rules. ADAPT this block to the observed schema."""
    out = df.copy()
    for col in out.columns:
        before_missing = out[col].apply(lambda x: to_missing(x) is None).sum()
        out[col] = out[col].apply(to_missing)
        stats["blanks_per_column"][col] = int(
            out[col].isna().sum() - before_missing if False else out[col].isna().sum()
        )
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--sheet", default=None)
    args = ap.parse_args()

    df = read_any(args.input, args.sheet)
    stats = {
        "rows_in": int(len(df)),
        "columns": list(df.columns),
        "blanks_per_column": {},
    }
    cleaned = normalize(df, stats)
    stats["rows_out"] = int(len(cleaned))
    cleaned.to_csv(args.output, index=False, encoding="utf-8-sig")
    print(json.dumps(stats, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
