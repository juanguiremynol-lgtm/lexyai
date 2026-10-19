#!/bin/sh
set -eu
: "${ITEST_REPO:?Set ITEST_REPO to the isolated checkout}"
cd "$ITEST_REPO/supabase/functions/sync-by-work-item"
# Clean environment and loopback-only network access prevent hosted side effects.
exec env -i PATH="$PATH" HOME="${HOME}" DENO_DIR="${DENO_DIR:-/tmp/samai-tools/deno-cache}" \
  SUPABASE_URL=http://127.0.0.1:54321 \
  SUPABASE_SERVICE_ROLE_KEY="$(cat /tmp/itest/svc.jwt)" \
  SUPABASE_ANON_KEY="$(cat /tmp/itest/anon.jwt)" \
  SAMAI_FEED_BASE_URL=http://127.0.0.1:54321/samai SAMAI_FEED_API_KEY=synthetic-local \
  USE_ORCHESTRATOR_SYNC=false \
  deno run --cached-only --no-check --allow-env --allow-read --allow-net=127.0.0.1,localhost,0.0.0.0:8000 index.ts
