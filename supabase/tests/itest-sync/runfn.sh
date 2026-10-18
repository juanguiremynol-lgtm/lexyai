#!/bin/sh
cd /dev-server/supabase/functions/sync-by-work-item
exec env -u PGHOST -u PGPASSWORD -u PGUSER -u PGDATABASE -u PGPORT -u SUPABASE_DB_URL SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=$(cat /tmp/itest/svc.jwt) SUPABASE_ANON_KEY=$(cat /tmp/itest/anon.jwt) SAMAI_FEED_BASE_URL=http://127.0.0.1:54321/samai SAMAI_FEED_API_KEY=synthetic-local deno run -A index.ts
