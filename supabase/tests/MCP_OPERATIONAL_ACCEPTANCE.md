# Operational acceptance — 0073

Run `bash supabase/tests/run-mcp-operational-acceptance.sh` from the project root.
Requires PostgreSQL binaries, Linux `setpriv`, user 1000 and Python `psycopg2`.
Port 55441 must be unused; the runner fails rather than resetting another cluster.

The fixture is standalone, contains no credentials or real judicial records,
and the tests use explicit BEGIN/ROLLBACK with transaction-local EXECUTE grants.
Negative cases require an exact SQLSTATE and message prefix and unchanged matter,
audit and idempotency state. No provider, cron, dispatcher, Vault or hosted data calls.

Verified: normalization/leading zero, known stale revision, unverified/missing/
expired/mismatched sessions, cross-owner, OAuth read-only/narrow scope/deleted
client/revocation/consent generation, ACTIVE-only/empty identity, duplicate in
trash, monitored cap, telemetry, retry exactly once, enrollment trigger invocation,
stable equal-timestamp notification pages after 30 dismissed newest entries,
foreign state isolation, cursor filter/user isolation, state permission errors.

## Limits of this evidence

This is a focused synthetic database, not a replica of all production policies.
It loads the actual 0071 auth helpers, 0073 actions, deployed idempotency/audit,
monitoring invariant/limit and canonical lifecycle no-op body. Owner RLS is
simplified; enrollment writes to a local fixture record, not production enrollment
tables. Thus it proves trigger invocation, not the entire production enrollment
family. It does not certify legacy direct writers, org/platform support policies,
concurrent contradictory sessions, 0072 email grouping or the incremental feed.
The previous full acceptance suites still require strict negative assertions,
normal PASS/ROLLBACK flow and reruns. Permission-panel error behavior has not
been exercised in an authenticated browser session. No real-user smoke or publish.

Notification cursors are user/filter-bound keyset positions, not immutable
snapshots; start again at page one after state changes when full reconciliation
is needed. No empty state fallback is used.