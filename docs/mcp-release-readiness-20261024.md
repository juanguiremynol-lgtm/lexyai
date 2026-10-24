# MCP final scoped release review — 2026-10-24

## Candidate and authorization

Exact final candidate: **0.6.5 / 50 tools**, including documentation/UI closure as requested by root at 20:56 UTC (supersedes the documentation-only 0.6.6 label). Same endpoint, Andromeda identity and OAuth configuration. Implementation migrations **0059–0079**, including 0078 non-row privilege revocation and 0079 atomic updates/runtime capabilities/freshness ties; no additional migration or MCP tool. Public revision marker: **mcp-rev-0-6-5**. No services newly enabled: existing Cloud backend and OAuth integration retained. No deployment, publication or release grant script execution by this agent.

0078 revokes TRUNCATE, REFERENCES and TRIGGER from PUBLIC, anon, authenticated and mcp_feed_executor. Hosted read-only privilege inspection confirms all three absent for anon/authenticated/executor. Authenticated SELECT/DELETE remain, INSERT remains denied; executor INSERT remains. Existing anonymous SELECT/DELETE grants were not widened or changed; RLS still denies unauthenticated cursor access.

All **eleven** new mutation RPCs remain gated from authenticated/anon (ten existing plus internal `mcp_update_work_item`). Root completed final delta verification and authorized MCP release at 20:56 UTC; root retains explicit application of the reviewed grant SQL and frontend publication. No grant or hosted write was performed during this closure. There is no pending human approval for MCP release; the deployment mechanism is the concrete limitation described below.

0079 validates metadata/client before changes, composes metadata plus canonical pause/resume in one transaction, checks owner/manage, and audits atomically with optional idempotency key. Existing optional input semantics remain: omitted fields are unchanged; omitted key receives a generated key returned in the result (reuse an explicit key for reliable client retries). Returned monitoring state is committed state, not requested state. Runtime capability discovery is invoker-scoped: verified app authority plus actual function/table privileges, with per-tool availability and distinct SESSION_UNVERIFIED guidance for `none`. Execution availability is necessary, not a promise that every row/action passes RLS or business validation.

The withdrawn creation-quota concern was not changed: no extra creation quota mechanism or provider schedule change was added. Freshness uses timestamp DESC, id DESC consistently with issue pages.

## Root-provided hosted evidence — 20:50 and final 20:56 UTC, 2026-10-24

Root independently reports execution against the hosted actual schema with rollback-only suites. These results are **root-provided evidence, not this agent's hosted run**. Final delta verification is complete according to root's 20:56 report.

| Hosted suite | Root-reported result |
|---|---|
| AUTH | 61/61 PASS |
| CURSOR | 26/26 PASS |
| FEED | 21 PASS, 0 FAIL, 2 explicit-limit SKIPs |
| OPERATIONS | 40/40 PASS |
| Atomic update final delta | 20/20 PASS |
| Freshness ties final delta | 6/6 PASS |

Root reports real enrollment/reminders/queues, automatic SYSTEM create → assign, genuine USER pause, actual capacity-50 restore/create behavior, email group confirmation/conflicts, backward manual stage/revision and notification pagination covered by OPERATIONS. Final cleanup verified **zero synthetic auth.users and zero mcp_client_grants**; **all eleven action gates closed** and **all 0078 cursor excess privileges absent**. Root reviewed the adapter, specific live SQL and eleven release signatures; independent review found no access blocker. The two previously reported feed SKIPs remain explicit limits, not passes; their individual details were not supplied.

Public connection disclosures describe available actions, explicit per-client opt-in from the user's own Andromeda session, revocation and ten-day recovery, not a permanent development-review blockade. `get_capabilities` still derives actual execution availability and app authority at runtime; no gate logic changed.

## Final local evidence

| Suite | Passed | Notes |
|---|---:|---|
| Authorization | 68 | Exact denials, NULL-safe, normal verdict then rollback |
| Source/restore at capacity | 33 | Nonmonitorable and USER-paused restoration |
| Creation continuation | 18 | Automatic SYSTEM reason, USER pause retained, quota/retry/audit |
| Attached feed | 11 | 3 explicit SKIPs retained; supplemental cursor/version/expiry/concurrency tests below |
| Multi-session feed | 11 | Independent commits and fixed watermark; old-revision clock model beyond overlap |
| Manual stages | 10 | Canonical stages, regressions and stale revisions |
| Protected cursors | 22 | Includes 10 new privilege assertions, positive issued cursor and crafted/cross-client denial |
| Overlapping mutations | 15 | Two independent sessions; actual PostgreSQL Lock waits observed in all three scenarios |
| Operations | 55 | Assignment and personal notification pagination |
| Atomic update/runtime/ties | 13 | Invalid-client + pause and later canonical failure leave everything unchanged; retry once, actual false resume state, gate availability, equal-time success/error |
| Vitest | 34 | Includes 6 rendered SettingsConnections cases and 6 final-discrepancy contracts |

Concurrency tests commit only in a disposable loopback cluster so transactions genuinely overlap. Same-key create returns one matter/result/audit plus a replay. Competing confirm/dismiss yields one winner and MCP09/ALREADY_RESOLVED for the loser with zero losing audit/idempotency. Stage competitors share a revision; loser gets MCP09/STALE_REVISION, winning stage/version retained and exactly one stage audit. Fixture cleanup explicitly removes random-scoped rows and restores gates; runner trap destroys the cluster even on failure.

SettingsConnections is rendered in jsdom with synthetic API responses: stale manage state clears after load failure, unknown state disables opt-in, pending refresh disables controls, successful grant/revoke reloads permission state, first-party refusal never claims management. Full management scope and ten-day recovery/scheduled removal are visible before opt-in. No real user's session or OAuth credentials are used; this is rendered UI behavior testing, not hosted authenticated external-client smoke.

Canonical bundle is regenerated by the build script, never hand-edited. `check:mcp:source` and `check:mcp:artifact` exited 0 after 0079. Final extraction and supervised app build are checked at the closing checkpoint. Generated manifest is not proof the hosted revision changed.

## Reproduce safely

Run from project root on Linux with PostgreSQL `initdb`, `pg_ctl`, `psql`, `setpriv`, local UID/GID 1000 (`lovable`), Python 3 + psycopg2, Bun/Node and Deno. Ports **55442** and **55441** must be unused. No ambient/hosted PG credentials are read.

```sh
bash supabase/tests/run-authorization-acceptance.sh
bash supabase/tests/run-mcp-operational-acceptance.sh
bunx vitest run src/test/mcp-final-discrepancies.test.ts src/test/settings-connections-permissions.test.tsx src/test/mcp-operational-actions.test.ts src/test/mcp-manage-guard.test.ts src/test/mcp-runtime-env.test.ts src/lib/mcp/__tests__
bun run check:mcp:source
bun run check:mcp:artifact
```

The app build is performed by the supervised validation harness, not a separately restarted server. The standalone concurrency script is only for the runner-prepared disposable schema, never a hosted target. Reduced schemas model owner RLS, calendar helpers and enrollment; they are not claimed full production equivalence. Legacy historical suites are not substituted for the strict final suites and are not presented as final independent hosted evidence.

## Agreed limits and remaining release steps

Feed represents current revisions, not durable history. A 15-minute overlap bounds recovery; older late commits may be missed. `reconcile_since` rereads current rows with maximum 400-day lookback, not a complete snapshot or intermediate event log. Hard deletes have no tombstone. No literal 16-minute wait is required to restate this documented bound; clock-model and overlapping within-window tests are distinguished.

No providers, messages, schedules, Vault, real portfolio writes or automatic manage grants were touched. Synchronization remains scheduled pending, not immediate hydration.

Root's final delta review/test and MCP release authorization are complete. Concrete deployment blocker: this project's managed MCP is excluded from development edge deployments and activates only through app publish. A direct MCP-only deployment is not supported; the requested frontend-publication boundary is preserved rather than bypassed. A public unauthenticated read during this closure still returned **mcp-rev-0-6-4**, not the candidate marker. Root's existing-app publication activates the generated candidate; verify **mcp-rev-0-6-5** afterward. Root retains application of the eleven-signature grant SQL and subsequent external-client smoke. This is a deployment limitation, not an access blocker or missing human approval.