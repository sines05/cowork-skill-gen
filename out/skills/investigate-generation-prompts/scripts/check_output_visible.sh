#!/usr/bin/env bash
# Check whether a generated output file is reachable by the user or hidden
# by a .gitignore rule. Exit 0 = visible, 1 = ignored/missing.
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <path-to-output-file>" >&2
  exit 2
fi

path="$1"

if [ ! -e "$path" ]; then
  echo "MISSING: '$path' does not exist — generation may not have written it." >&2
  exit 1
fi

# git check-ignore prints the matching rule and returns 0 when the path IS ignored.
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if rule=$(git check-ignore -v "$path" 2>/dev/null); then
    echo "IGNORED: '$path' is hidden by a gitignore rule:"
    echo "  $rule"
    echo "Fix: write to a non-ignored path, add a negation (e.g. '!$path'), or show contents directly."
    exit 1
  fi
fi

echo "VISIBLE: '$path' exists and is not gitignored."
exit 0
