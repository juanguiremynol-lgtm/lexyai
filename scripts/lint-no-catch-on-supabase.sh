#!/usr/bin/env bash
# CI lint: reject .catch() and .then() chains in edge functions.
# Enforce async/await + try/catch consistently.
#
# Scope: supabase/functions/**/*.ts only (excludes test files)
#
# Allowlist for .catch():
#   - .json().catch   — safe JSON parse fallback
#   - Promise.race/all .catch — concurrency patterns
#   - ].catch(        — array-of-promises pattern
#
# Allowlist for .then():
#   - // lint-allow-then: <justification>  (must include reason after colon)
#
# Exit code 1 if violations found.

set -euo pipefail

EXIT_CODE=0
ESCAPE_HATCH_COUNT=0

# ── Check 1: .catch( in edge functions (excluding allowlisted patterns) ──
CATCH_VIOLATIONS=$(
  grep -rn --include='*.ts' '\.catch(' supabase/functions/ \
    | grep -v '\.test\.ts:' \
    | grep -v '\.json()\.catch(' \
    | grep -v 'Promise\.race.*\.catch(' \
    | grep -v 'Promise\.all.*\.catch(' \
    | grep -v '\]\.catch(' \
  || true
)

if [ -n "$CATCH_VIOLATIONS" ]; then
  echo "❌ Found .catch() in edge functions. Use try/catch instead:"
  echo ""
  echo "$CATCH_VIOLATIONS"
  echo ""
  echo "Why: .catch() silently swallows errors, causing jobs to continue"
  echo "with undefined data and crash later with misleading errors."
  echo "Wrap the await in try/catch and handle the error explicitly."
  echo ""
  EXIT_CODE=1
fi

# ── Check 2: .then( chains in edge functions ──
THEN_RAW=$(
  grep -rn --include='*.ts' '\.then(' supabase/functions/ \
    | grep -v '\.test\.ts:' \
  || true
)

# Separate allowed (with valid escape hatch) from violations
THEN_VIOLATIONS=""
while IFS= read -r line; do
  [ -z "$line" ] && continue

  if echo "$line" | grep -q '// lint-allow-then:'; then
    # Valid escape hatch — has colon + justification
    ESCAPE_HATCH_COUNT=$((ESCAPE_HATCH_COUNT + 1))
  elif echo "$line" | grep -q '// lint-allow-then'; then
    # Escape hatch WITHOUT justification — this is a violation
    THEN_VIOLATIONS="${THEN_VIOLATIONS}${line}  ← missing justification after 'lint-allow-then:'\n"
    EXIT_CODE=1
  else
    # No escape hatch at all
    THEN_VIOLATIONS="${THEN_VIOLATIONS}${line}\n"
    EXIT_CODE=1
  fi
done <<< "$THEN_RAW"

if [ -n "$THEN_VIOLATIONS" ]; then
  echo "❌ Found .then() chains in edge functions. Use await instead:"
  echo ""
  echo -e "$THEN_VIOLATIONS"
  echo ""
  echo "Why: .then() chains are harder to debug and error-handle than"
  echo "async/await + try/catch. Use 'await' and wrap in try/catch."
  echo ""
  echo "To suppress: add '// lint-allow-then: <reason>' on the same line."
  echo "  Example: .then(() => {}) // lint-allow-then: fire-and-forget audit log"
  echo ""
fi

# ── CI Summary ──
echo "────────────────────────────────────"
echo "📊 Lint summary:"
echo "   Escape hatches (lint-allow-then): $ESCAPE_HATCH_COUNT"

if [ "$EXIT_CODE" -eq 0 ]; then
  echo "   ✅ No violations found."
else
  CATCH_COUNT=$(echo "$CATCH_VIOLATIONS" | grep -c '.' || true)
  THEN_COUNT=$(echo -e "$THEN_VIOLATIONS" | grep -c '.' || true)
  echo "   ❌ .catch() violations: $CATCH_COUNT"
  echo "   ❌ .then() violations:  $THEN_COUNT"
fi
echo "────────────────────────────────────"

exit $EXIT_CODE
