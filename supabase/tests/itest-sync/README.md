# Isolated integration harness for sync-by-work-item (local only)

Runs the REAL `sync-by-work-item/index.ts` + REAL `rpc_upsert_work_item_acts`, triggers and
unique indexes against a local Postgres 17 loaded with a SCHEMA-ONLY dump (no data) and a
local PostgREST. SAMAI is a synthetic local mock. No hosted services, no production data.

1. `pg_dump --schema-only --no-owner --no-privileges --schema=public -f /tmp/itest/public_schema.sql` (read-only, structure only)
2. As an unprivileged OS user: `initdb -D /tmp/itest/pgdata -U postgres --auth=trust`; `pg_ctl ... -o "-p 54329"` start
3. `lpsql -d postgres -c "create database sync_itest"`; load `prelude.sql`, `public_schema.sql`, grants to service_role, `seed.sql`
4. `deno run -A mkjwt.ts <local-secret> service_role > svc.jwt` (local synthetic secret, matches postgrest.conf)
5. `python3 drive.py` (starts PostgREST via `nix run nixpkgs#postgrest`, gateway.ts, runfn.sh; resets `sync_run` from template per scenario)

## Current execution boundary (2026-10-18, renewed sandbox)

The previous `/tmp/itest` directory and local Postgres instance are absent.
There is no saved `public_schema.sql`, seeded `sync_itest` database, or synthetic
JWT files. Postgres tools and Deno alone are not a ready integration environment.
No integration scenario has been rerun in this sandbox.

The bootstrap commands above describe the original harness, **not authorization
to execute them now**. In particular, do not run `pg_dump` against ambient hosted
connection variables, create roles/grants, or mint/change credentials. To resume
under the current restrictions, restore the previously prepared local-only
schema/database (including its already-existing test roles) and synthetic JWT
files. No private rows or hosted credentials may be included.

Required artifacts under `/tmp/itest`: `public_schema.sql`, `svc.jwt`, `anon.jwt`,
`lpsql`, `postgrest.conf`, `gateway.ts`, `runfn.sh`, plus the seeded local
`sync_itest` database on `127.0.0.1:54329`. Copy the reviewed harness files from
this directory, without changing the existing test credentials. If the old
database snapshot cannot be restored, rebuilding the harness would require
local role/grant and synthetic-credential setup not allowed by the current ask.

Once those prerequisites already exist:

```sh
supabase/tests/itest-sync/lpsql -d sync_itest -At -c "select id from work_items where id='33333333-3333-3333-3333-333333333333'"
python3 supabase/tests/itest-sync/drive.py
cat /tmp/itest/results.json
```

The driver waits after **every** database reset until an authenticated read
through local PostgREST returns the synthetic work-item UUID (bounded 60s).
It runs the real `index.ts`, RPC, triggers and queries, without changing indexes
to make the fixture pass. S1–S8 remain in scope; the known structural-index
collision is expected to remain a failure until separately approved remediation.

S6 now covers **A insert confirmed → read-back HTTP failure or empty result →
distinct B with the same day/title**. It must observe exactly one successful act
RPC, A's committed row, HTTP 500 with a read-back reason, and no B RPC. A subsequent
run must retain A's UUID/fingerprint. The index could hide a mistaken B write,
so merely asserting one persisted row is insufficient. These cases are prepared,
not executed against a real database in the renewed sandbox.
