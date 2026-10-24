# Independent acceptance — canonical API through 0074

Run `bash supabase/tests/run-authorization-acceptance.sh` from the project root.
Requires the same PostgreSQL/Python/Linux prerequisites as the operational runner;
port 55442 must be unused. No ambient PG credentials are read by these runners.

The attached preparatory harness is stored and adapted in
`supabase/tests/authorization-acceptance.sql`. Exact positional signatures are
unchanged for creation, lifecycle, grant/revoke. Added assignment signature
`mcp_assign_work_item_radicado(uuid,text,timestamptz,text)` to the ten-function
gate snapshot and positive/negative acceptance. Only three action grants are
opened transaction-locally, with all ten compared again after rollback.

The runner reads the normal final JSON SELECT before issuing ROLLBACK in the same
connection. No unconditional TEST_RESULTS exception is needed. Missing functions,
wrong signatures, unexpected exceptions, setup errors and blanket EXECUTE denial
fail preflight/positive paths or exact SQLSTATE/anchored error checks. Assertions
pass only on TRUE; expected results compare with IS NOT DISTINCT FROM.

Verified local results:
- 68 independent authorization assertions, failed=0; ten gates restored.
- 33 source/restore assertions, failed=0: PETICION, GOV_PROCEDURE, no-radicado
  CGP and explicitly suspended CGP restore at full quota with monitoring false;
  genuinely monitored restoration still fails P0429 without mutating lifecycle.
  Ledger binds the newly inserted outbox; sources remain separate; old detected_at
  rows with current revisions/archival appear; equal-timestamp pagination,
  fixed watermark, quiet checkpoint, invalid/version/filter/expiry cursors,
  per-provider/operation successes and failure visibility, grouped inbox siblings.
- Existing 55 operational assertions and 19 focused Vitest tests passed again.

Access labels match exactly: verified native=first_party, invalid=none,
OAuth without management=read, current grant=manage. No label was weakened.
Cursor expiry is canonical SQLSTATE MCP09 with CURSOR_EXPIRED, not MCP22;
the test was adapted to this exact non-silent conflict boundary.

## Evidence boundaries

Only a disposable local database was used. The fixture captures actual installed
function bodies, including 0074 lifecycle, 0071 auth, action wrappers and source
queries; it is not a production schema replica. Auth tables and RLS are synthetic,
owner RLS models the core boundary, and enrollment writes a local fixture record.
No production auth lifecycle triggers, full business-plan/support visibility,
calendar semantics, providers, queues being processed or communications are certified.
The independent harness's platform-admin row tests direct writer ownership, not
the whole support-grant system. No real portfolio writes, sessions minted or calls
to providers occurred. Hosted SELECTs were restricted to definitions/privileges.

The older broad SQL suites still require conversion of catch-all negatives,
normal PASS/ROLLBACK results and reruns against a fully equivalent isolated schema.
Multi-connection late-commit/concurrency and pagination-time mutations remain
unverified; the feed still has a documented 15-minute overlap, current-row-only
reconciliation up to 400 days, no intermediate event/history or hard-purge capture.
The public ConnectAI scope and /app/settings/connections link were checked in
the browser, without login. Authenticated permission-panel behavior remains pending.
The current artifact is unchanged (49 tools/0.6.2); no MCP source changed this round.
All ten NEW mutation EXECUTE gates remain closed on the hosted database.
No publish or release-grant script was executed. No new services were enabled.