#!/usr/bin/env python3
"""Verify that expected artifact files were actually written to a target folder.

Usage:
  verify-artifacts.py <folder> [expected_min_count] [--ext .png,.jpg,.pdf]

Exits 0 and prints a summary if at least expected_min_count matching files exist;
exits 1 otherwise so the caller knows the 'save to folder' deliverable failed and
a fallback / honest disclosure is required.
"""
import os
import sys


def main(argv):
    if not argv:
        print("usage: verify-artifacts.py <folder> [min_count] [--ext .png,.jpg]", file=sys.stderr)
        return 2
    folder = argv[0]
    min_count = 1
    exts = None
    rest = argv[1:]
    i = 0
    while i < len(rest):
        a = rest[i]
        if a == "--ext" and i + 1 < len(rest):
            exts = tuple(e.strip().lower() for e in rest[i + 1].split(",") if e.strip())
            i += 2
            continue
        try:
            min_count = int(a)
        except ValueError:
            print(f"ignoring unrecognized arg: {a}", file=sys.stderr)
        i += 1

    if not os.path.isdir(folder):
        print(f"FAIL: target folder does not exist: {folder}")
        return 1

    found = []
    for root, _dirs, files in os.walk(folder):
        for f in files:
            p = os.path.join(root, f)
            try:
                size = os.path.getsize(p)
            except OSError:
                continue
            if size <= 0:
                continue  # zero-byte file = nothing really saved
            if exts and not f.lower().endswith(exts):
                continue
            found.append((p, size))

    print(f"folder: {folder}")
    print(f"matching non-empty files: {len(found)} (need >= {min_count})")
    for p, size in found[:50]:
        print(f"  {size:>10}  {p}")

    if len(found) >= min_count:
        print("OK: artifacts persisted.")
        return 0
    print("FAIL: expected artifacts were not persisted; use a fallback and disclose the gap.")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
