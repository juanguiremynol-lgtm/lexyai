#!/usr/bin/env bash
# CI lint: reject .catch( on Supabase query builder chains in edge functions.
# Supabase query builder .catch() silently swallows DB errors.
# Use try/catch around awaited calls instead.
#
# Allowlist: req.json().catch, response.json().catch, Promise.race/all .catch
# are fine — they aren't Supabase query builders.

set -euo pipefail

PATTERN='(adminClient|supabase|client)\.(from|storage|rpc)\b.*\.catch\('

VIOLATIONS=$(grep -rn --include='*.ts' -E "$PATTERN" supabase/functions/ || true)

if [ -n "$VIOLATIONS" ]; then
  echo "❌ Found .catch() on Supabase query builders. Use try/catch instead:"
  echo ""
  echo "$VIOLATIONS"
  echo ""
  echo "Why: .catch() silently swallows DB errors, causing jobs to continue"
  echo "with undefined data and crash later with misleading errors."
  echo "Wrap the await in try/catch and handle the error explicitly."
  exit 1
fi

echo "✅ No .catch() on Supabase query builders found."
