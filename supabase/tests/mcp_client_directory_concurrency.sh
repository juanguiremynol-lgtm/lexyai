#!/usr/bin/env bash
# Real concurrency test (two sessions) for the fix. Requires a NON-production database where
# 0102 + mcp_client_directory_fix_20261113.sql are applied and $TEST_DB_URL (superuser) is set.
# Session A inserts (Clients-screen path) and holds the transaction; session B inserts the same
# normalized identification and must block, then fail with 23505 after A commits. Rolls back B; deletes A's row.
set -euo pipefail
OWNER=$(psql "$TEST_DB_URL" -Atc "select id from auth.users limit 1")
psql "$TEST_DB_URL" -v ON_ERROR_STOP=1 -c "begin; insert into clients(owner_id,name,id_number) values('$OWNER','TEST-CONC-A','9.999.999-1'); select pg_sleep(3); commit;" &
sleep 1
if psql "$TEST_DB_URL" -c "begin; insert into clients(owner_id,name,id_number) values('$OWNER','TEST-CONC-B','99999991'); rollback;" 2>&1 | grep -q IDENTIFICATION_EXISTS; then R=PASS; else R=FAIL; fi
wait
psql "$TEST_DB_URL" -c "delete from clients where name='TEST-CONC-A' and owner_id='$OWNER'"
echo "concurrency: $R"; [ "$R" = PASS ]
