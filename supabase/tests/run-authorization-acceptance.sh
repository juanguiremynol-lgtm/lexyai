#!/usr/bin/env bash
set -euo pipefail
# Entire fixture exists only in this disposable local cluster. No ambient PG access.
root="$(mktemp -d /tmp/mcp-authorization.XXXXXX)"
chown 1000:1000 "$root"
cleanup() {
  setpriv --reuid=1000 --regid=1000 --clear-groups pg_ctl -D "$root/pg" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$root"
}
trap cleanup EXIT
setpriv --reuid=1000 --regid=1000 --clear-groups initdb -D "$root/pg" --auth=trust --encoding=UTF8 --no-locale >"$root/init.log"
setpriv --reuid=1000 --regid=1000 --clear-groups pg_ctl -D "$root/pg" -l "$root/server.log" -o "-h 127.0.0.1 -p 55442 -k $root" start >/dev/null
export PGSSLMODE=disable
psql -X -h 127.0.0.1 -p 55442 -U lovable -d postgres -v ON_ERROR_STOP=1 -f supabase/tests/fixtures/mcp_authorization_schema.sql >"$root/schema.log"
psql -X -h 127.0.0.1 -p 55442 -U lovable -d postgres -v ON_ERROR_STOP=1 -f drizzle/migrations/0075_mcp_empty_portfolio_freshness.sql >"$root/repair.log"
psql -X -h 127.0.0.1 -p 55442 -U lovable -d postgres -v ON_ERROR_STOP=1 -f drizzle/migrations/0076_mcp_protected_cursor_execution.sql >"$root/cursor-repair.log"
psql -X -h 127.0.0.1 -p 55442 -U lovable -d postgres -v ON_ERROR_STOP=1 -f drizzle/migrations/0077_mcp_paginated_freshness_issues.sql >"$root/freshness-page.log"
python3 supabase/tests/run_authorization_acceptance.py
python3 supabase/tests/mcp_source_acceptance.py
psql -X -h 127.0.0.1 -p 55442 -U lovable -d postgres -v ON_ERROR_STOP=1 -f supabase/tests/fixtures/mcp_feed_attachment_schema.sql >"$root/feed-schema.log"
python3 supabase/tests/run_feed_acceptance.py
python3 supabase/tests/mcp_feed_multisession.py
psql -X -h 127.0.0.1 -p 55442 -U lovable -d postgres -v ON_ERROR_STOP=1 -f supabase/tests/fixtures/mcp_stage_helpers.sql >"$root/stage-helpers.log"
python3 supabase/tests/mcp_manual_stage_acceptance.py