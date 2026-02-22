#!/usr/bin/env bash
# CI lint: reject .catch() and .then() chains in edge functions.
# Enforce async/await + try/catch consistently.
#
# Scope: supabase/functions/**/*.ts only
#
# Allowlist (grep -v):
#   - req.json().catch       — safe JSON parse fallback
#   - response.json().catch  — safe HTTP response parse
#   - .json().catch          — any JSON parse guard
#   - Promise.race/all       — concurrency patterns
#   - cloned.json().catch    — clone-then-parse pattern
#   - *.test.ts              — test files can use any pattern

set -euo pipefail

EXIT_CODE=0

# ── Check 1: .catch( in edge functions (excluding allowlisted patterns) ──
CATCH_VIOLATIONS=$(
  grep -rn --include='*.ts' '\.catch(' supabase/functions/ \
    | grep -v '\.test\.ts:' \
    | grep -v '\.json()\.catch(' \
    | grep -v 'Promise\.race.*\.catch(' \
    | grep -v 'Promise\.all.*\.catch(' \
    | grep -v '\].catch(' \
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
THEN_VIOLATIONS=$(
  grep -rn --include='*.ts' '\.then(' supabase/functions/ \
    | grep -v '\.test\.ts:' \
    | grep -v '// lint-allow-then' \
  || true
)

if [ -n "$THEN_VIOLATIONS" ]; then
  echo "❌ Found .then() chains in edge functions. Use await instead:"
  echo ""
  echo "$THEN_VIOLATIONS"
  echo ""
  echo "Why: .then() chains are harder to debug and error-handle than"
  echo "async/await + try/catch. Use 'await' and wrap in try/catch."
  echo "Add '// lint-allow-then' comment to suppress if truly needed."
  echo ""
  EXIT_CODE=1
fi

if [ "$EXIT_CODE" -eq 0 ]; then
  echo "✅ No .catch()/.then() violations found in edge functions."
fi

exit $EXIT_CODE
