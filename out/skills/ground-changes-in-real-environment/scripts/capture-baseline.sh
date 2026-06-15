#!/usr/bin/env bash
# Capture a pre-change baseline of project checks so later failures can be
# attributed correctly (pre-existing vs introduced by your edit).
# Usage: ./capture-baseline.sh ["check command" ...]
# If no commands are given, it tries to infer common ones.
set -u

OUT_DIR="${BASELINE_DIR:-.baseline}"
mkdir -p "$OUT_DIR"

# Determine which check commands to run.
if [ "$#" -gt 0 ]; then
  CHECKS=("$@")
else
  CHECKS=()
  if [ -f package.json ]; then
    grep -q '"typecheck"' package.json && CHECKS+=("npm run typecheck")
    grep -q '"lint"'      package.json && CHECKS+=("npm run lint")
    grep -q '"test"'      package.json && CHECKS+=("npm test")
  fi
  if [ "${#CHECKS[@]}" -eq 0 ]; then
    echo "No check commands given and none inferred. Pass them explicitly, e.g.:" >&2
    echo "  $0 'npm run typecheck' 'pytest -q'" >&2
    exit 2
  fi
fi

stamp="$(date +%Y%m%d-%H%M%S)"
summary="$OUT_DIR/baseline-$stamp.txt"
echo "Baseline captured at $stamp" > "$summary"

for cmd in "${CHECKS[@]}"; do
  echo "=== $cmd ===" | tee -a "$summary"
  # Run the check; record exit code but never abort the whole baseline run.
  if eval "$cmd" > "$OUT_DIR/$(echo "$cmd" | tr -c 'a-zA-Z0-9' '_')-$stamp.log" 2>&1; then
    echo "  result: PASS (exit 0)" | tee -a "$summary"
  else
    code=$?
    echo "  result: FAIL (exit $code) -- PRE-EXISTING; see log" | tee -a "$summary"
  fi
done

echo
echo "Baseline written to $summary"
echo "Treat any FAIL above as pre-existing. After editing, re-run the same commands"
echo "and compare: only NEW failures are caused by your change."
