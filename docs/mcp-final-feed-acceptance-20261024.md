# Final feed acceptance — 2026-10-24

## Release verdict: NOT READY FOR ENABLEMENT OR PUBLICATION

The attached independent feed harness is now source-controlled in
`supabase/tests/feed-acceptance.sql`. Only its response extraction changed:
`freshness` is an object; item detail is `freshness.items`, not a top-level array.
All required behavioral assertions were preserved. It first reproduced one actual
failure: an empty portfolio page hid source failure for an unmonitored matter.

Applied `drizzle/migrations/0075_mcp_empty_portfolio_freshness.sql`:
visible unmonitored matters with source evidence from the existing 30-day window
now qualify for freshness detail even without event-page membership. Monitored,
explicit and page-associated matters remain eligible. The 200-detail cap remains;
truncation counts the same eligible set, including explicit matters. No source
data, cursor format, endpoint, OAuth identity, provider/cron/Vault or grants changed.
Installed definition and ten new mutation gates checked via read-only queries.

## Final combined checks

`bash supabase/tests/run-authorization-acceptance.sh`:
- Independent authorization: 68 checks, zero failures, normal JSON before rollback.
- Source/restore-at-cap: 33 checks, zero failures.
- Attached feed: 11 PASS, zero FAIL, three transparent SKIP records retained.
- Local multi-connection feed supplement: 11 checks, zero failures.
- Canonical manual-stage supplement: 10 checks, zero failures.

`bash supabase/tests/run-mcp-operational-acceptance.sh`: 55 checks, zero failures.
Vitest focused files: 19 tests across operational actions, management guard and
stage vocabulary, all passed. MCP source checked with tsgo against tsconfig.mcp.json;
`bun run check:mcp:artifact` regenerated the bundle through the canonical build
script and verified handler registration. Automatic preview compilation reports OK.
Inventory remains 49 tools / 0.6.2; no claim that a hosted MCP revision was deployed.

## Additional evidence and precise boundaries

The supplement proves equal-timestamp traversal across independent local reader
transactions, a fixed scan watermark during a committed insertion, exclusion of
the post-watermark row until the next overlap poll, invisibility of an uncommitted
writer followed by recovery after its actual commit, unsupported c9 version denial
(MCP22/CURSOR_INVALID), and actual stored-cursor expiry denial with recovery hint
(MCP09/CURSOR_EXPIRED). A 16-minute-old revision models the beyond-overlap case:
incremental polling misses it as documented; bounded current-row reconciliation
recovers it. This is NOT a 16-minute wall-clock transaction test.

The stage supplement invokes the actual canonical RPC/helpers with a transaction-
local EXECUTE grant. It checks valid forward/backward cross-phase CGP moves,
MANUAL_USER audit/phase markers, live governed transitions/regressions, required
reason, invented target/order denial, prohibited transition, stale revision and
unchanged revision after negatives. Errors must have exact expected state/prefix.

All attachment/authorization/stage fixture changes roll back. Independent reader/
writer concurrency requires committed synthetic state ONLY inside the disposable
loopback cluster; the entire cluster is destroyed on exit. No hosted fixture writes,
real portfolio IDs, sessions minted, providers, communications or publishing occurred.
Local owner RLS and supporting schema are reduced fixtures, not a production replica;
source revision triggers model now()/frozen detected_at locally. Enrollment records
are local substitutes, not proof of the whole production queue/trigger family.

## Remaining issues blocking release

- Older broad SQL suites still contain catch-all negative PASS paths and unconditional
  TEST_RESULTS exceptions. They have NOT been rerun/certified as final acceptance.
  Focused new suites do not substitute for full direct-writer/support/RLS coverage.
- Full equivalent isolated production schema/policy/enrollment coverage is missing.
- Contradictory concurrent mutation/idempotency decisions are not certified by the
  feed concurrency supplement; post-watermark update/archive while paging also
  needs dedicated concurrent coverage (single-connection correction/archive passes).
- Actual >15-minute wall-clock late commits remain modeled, not wall-clock tested.
- Permission panel has no authenticated browser end-to-end verification; only
  public ConnectAI copy and owner grant link were checked previously.
- External-client authenticated smoke remains on hold with publication/review.

The feed promises current revisions, not a durable intermediate-event/history
log. Hard purge has no tombstone. `reconcile_since` is limited to current revisions
within 400 days, not a complete snapshot/history. Detail windows are 30/90 days and
200 matters, with truncation disclosed. Cursor expiry fails explicitly, never resets.

All ten new mutation RPCs (original nine plus assign-radicado) remain unavailable
to authenticated/anon by EXECUTE privileges. Release script was not run. Root review
and the unresolved verification above are required before enabling or publishing.