# Isolated integration harness for sync-by-work-item (local only)

Runs the REAL `sync-by-work-item/index.ts` + REAL `rpc_upsert_work_item_acts`, triggers and
unique indexes against a local Postgres 17 loaded with a SCHEMA-ONLY dump (no data) and a
local PostgREST. SAMAI is a synthetic local mock. No hosted services, no production data.

1. `pg_dump --schema-only --no-owner --no-privileges --schema=public -f /tmp/itest/public_schema.sql` (read-only, structure only)
2. As an unprivileged OS user: `initdb -D /tmp/itest/pgdata -U postgres --auth=trust`; `pg_ctl ... -o "-p 54329"` start
3. `lpsql -d postgres -c "create database sync_itest"`; load `prelude.sql`, `public_schema.sql`, grants to service_role, `seed.sql`
4. `deno run -A mkjwt.ts <local-secret> service_role > svc.jwt` (local synthetic secret, matches postgrest.conf)
5. `python3 drive.py` (starts PostgREST via `nix run nixpkgs#postgrest`, gateway.ts, runfn.sh; resets `sync_run` from template per scenario)

Known harness gap: after each `reset` the driver must wait until PostgREST reloads its schema cache
(poll `GET /rest/v1/work_items?id=eq.<WI>` until it returns the row) before calling the function.
