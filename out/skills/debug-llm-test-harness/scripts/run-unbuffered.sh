#!/usr/bin/env bash
# Run a command with unbuffered, line-buffered stdout/stderr so long-running
# LLM step-loops show real-time progress instead of appearing to hang.
# Usage: ./run-unbuffered.sh <command> [args...]
#   e.g. ./run-unbuffered.sh python harness.py --steps 20
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <command> [args...]" >&2
  exit 2
fi

# Prefer stdbuf for line-buffering any program; fall back to plain exec.
if command -v stdbuf >/dev/null 2>&1; then
  # -oL/-eL = line-buffer stdout/stderr. Tee to a log AND the terminal so you
  # can monitor live without a tail-only pipe swallowing buffered output.
  exec stdbuf -oL -eL "$@" 2>&1 | tee harness-run.log
else
  # Python-specific unbuffering hint if the command is python.
  export PYTHONUNBUFFERED=1
  exec "$@" 2>&1 | tee harness-run.log
fi
