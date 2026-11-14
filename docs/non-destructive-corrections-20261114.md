# Non-destructive corrections — 2026-11-14

## Release state

- Baseline: `115e61ce636664bc8833390be7278b357e7a73f9`.
- Code checkpoint observed after implementation: `2a2666801cc09ed77bf3d1d06b967e47d7430c49`; final documentation is saved by the platform afterward. No manual Git commit was performed.
- `sync-by-work-item` selectively deployed successfully, submitted source SHA-256 `f757a17318cc2275424a4dd2d88d2a695d373dcf421aaa4e60b75f1980ce13fd`.
- `scheduled-daily-sync` selectively deployed successfully, submitted source SHA-256 `aa2408e3c39015f0cb9cbc9c6a94636d317cc73dd4e2969eff71388e494d8e40`.
- Deployment acceptance is not runtime completion: neither producer was invoked, no judicial source was queried, and automatic queue drain is not certified.
- MCP candidate: 0.6.13, 52 existing tools, public marker `mcp-rev-0-6-19`; generated artifact and manifest validated. Not published. Managed MCP requires full app publication; no independent MCP edge deployment is supported. Frontend not published, no frontend changes.
- No SQL applied; no record repair/backfill, permission, cron, instance-size, secret or legal identifier changes.
- Lovable Cloud already existed; no new service or auth setup was enabled.

## Implemented before/after

### Portfolio summary

`src/lib/mcp/tools/get-user-context.ts`

Before: all `deleted_at IS NULL` rows labelled active, silently capped at 1000, read errors ignored.
After: `ACTIVE` only, archived counted separately using an exact RLS-scoped count, active workflow projection traversed by ascending UUID until an empty page. This also tolerates a Data API page cap lower than the requested size. Profile/count/page failures return errors rather than empty portfolios. There are no hard-coded production counts.

Handler fixtures: 81 ACTIVE + 2 ARCHIVED + 1 deleted return 81 active/2 archived, workflows 68 CGP/13 CPACA; 1031 active rows return 1031, not 1000. These are synthetic regression results, not a new production census. Cross-page concurrent edits can change the result; this read is not a database snapshot transaction.

### Keyset listings

`src/lib/mcp/tools/list-work-items.ts`, `list-actuaciones.ts`, `src/lib/mcp/keyset-page.ts`

Work items default ACTIVE; ARCHIVED/ALL explicit. Both listings order descending date then UUID, null dates last, fetch one lookahead row, and return `has_more`/`next_cursor`. Filters apply in the query before the page. Acts retain the exact existing nonarchived predicate; no new speculative supersession rule was added. A fixture of 230 nonarchived acts returns all 230 across three pages, tied and null dates included, with no duplicate IDs.

Cursors are bounded, schema-validated, filter-bound listing boundaries; they are not authorization, trusted feed checkpoints, or server-held feed cursors. RLS and work-item resolution run on every request. Updating a sort date during traversal can move a row: listings are not immutable historical snapshots.

### Persistence evidence and small write reduction

`supabase/functions/sync-by-work-item/index.ts`, `_shared/actBatchState.ts`, `_shared/syncFailureEvidence.ts`

Before: failures before the normal terminal ledger block had no bucket; PostgREST errors in telemetry inserts were ignored; SQLSTATE was dropped on some reads; two redundant successful startup traces incurred writes.
After: outer failure path attempts one existing-table bucket before terminal tracing, with phase, SQLSTATE, trace/run/provider correlation and known counts. Zero parsed acts remain zero; a control failure never invents a lost act. Diagnostic bucket output excludes provider bodies. PostgreSQL cancellation remains distinct from unknown commit; no uncertain write replay is introduced. Failed evidence writes explicitly log correlation/code instead of silently claiming evidence exists. A runtime CPU kill can still interrupt this path; persistence cannot be guaranteed when the database itself rejects the evidence write.

Only successful `SYNC_START`/`WORK_ITEM_LOADED` traces are omitted; terminal, provider, security and failed traces remain. Two fewer database trace inserts per admitted normal sync; no measured production credit or latency saving is claimed. Readbacks, origin matching, post-ingestion verification and daily admissions are unchanged.

### Daily continuation

`supabase/functions/scheduled-daily-sync/index.ts`, `_shared/continuationDispatch.ts`

Confirmed source defect: continuation was marked enqueued even after fetch threw, and HTTP rejection was ignored. Now one dispatch is bounded to five seconds, accepted only on HTTP 2xx, and HTTP/network uncertainty is persisted separately. No redispatch on an uncertain result. Ledger read/write errors are surfaced. An HTTP acknowledgment does not imply successful child execution. Existing cursor, chain, continuation cap and extraction admission stay intact.

## Actual read-only findings

At approximately 19:11 UTC, `extensions.pg_stat_statements` reported:

| Statement category | Calls | Mean ms | Total ms |
|---|---:|---:|---:|
| `rpc_enrich_work_item_act` | 56 | 1141.12 | 63902.66 |
| `sync_traces` insert | 559 | 104.19 | 58241.27 |
| full act fresh read | 1996 | 17.65 | 35228.46 |
| `external_sync_runs` terminal update | 48 | 721.87 | — |

These are cumulative statistics, not incident-specific lock/CPU measurements. They do not prove that Tiny or one missing index caused the historical 57014. No blanket timeout increase or instance enlargement was made.

The enrichment function performs a primary-ID/owner-item CAS UPDATE comparing full raw JSON/documents, then returns the row. Live trigger inspection confirmed deadline recomputation is already skipped for attachment-only changes. Without incident lock/trigger timing, changing legal triggers or removing CAS would be speculative and unsafe. Slow `work_items` writes and POST_INGEST_EFFECTS_PENDING root causes remain unproven; no freshness write was removed.

Live `monitoring_coverage_v` independently scans acts/publications for maximum date and count, and globally aggregates run history/30-day attempt JSON. Prepared an equivalent view using one active-item-scoped aggregate per act/publication table plus active-item-scoped run/attempt aggregates. Output expressions, legal status rules, columns and existing ACL are preserved through CREATE OR REPLACE. Candidate and rollback are **not applied**; equivalence/performance are **not yet proven** on an isolated database. No isolated `TEST_DB_URL` was supplied; the available connection is production only.

## Live execution privileges — verified, unchanged

| RPC | authenticated EXECUTE | anon EXECUTE |
|---|---|---|
| `mcp_create_client(text,text,text,text,text)` | true | false |
| `mcp_update_client(uuid,jsonb,timestamptz,text)` | true | false |
| `mcp_correct_hearing(uuid,jsonb,timestamptz,text,text)` | false | false |
| `mcp_reclassify_work_item(uuid,text,text,timestamptz,text,text)` | false | false |

No grants were enabled. No billing/admin/signature controls were added. REDIRGE remains unidentified; SPOA/SFC identifiers and procedural stages were not rewritten.

## Preserved fail-closed outcomes

PP_STORED_READ_INCOMPLETE, PP_NATIVE_DATE_CONFLICT and incomplete-empty outcomes remain unchanged. No evidence demonstrates a safe root-cause data repair for those reported 25/5/14 cases. No active extraction was re-POSTed, no successful result fabricated, no historical evidence erased. Existing PP follow-up drain retains fenced claims and follow-up-only slots. Real future queue drain and same-day recoveries were not exercised because doing so would run producers and mutate records.

## Checks performed

```sh
bunx vitest run src/lib/mcp/__tests__
# 8 files, 76 tests PASS (9 new summary/pagination handler tests)
bun run check:mcp:source
bun run check:mcp:artifact
# PASS; official generator, no manual bundle edit
deno check supabase/functions/sync-by-work-item/index.ts supabase/functions/scheduled-daily-sync/index.ts
# PASS
deno test --no-check --allow-env --allow-read supabase/functions/_shared/{continuationDispatch,syncFailureEvidence,actBatchState,syncTimelineVerdict,ppRoleDateHandler,storedActAdmission,dailyUpdateGate,actOriginIdentity,dailyCompletion,dailyRetryWindow}_test.ts
# 83 tests, 16 steps PASS, no hosted judicial requests
git diff --check
# PASS
```

Initial checks found `.at` incompatible with the MCP target and a misplaced trace filter; both corrected, final source/function checks PASS. Initial Deno invocation used a nonexistent suite name, then lacked local env permissions; final command above PASS. Harness automatic build logs report `build OK`; no redundant manual web build was run.

Authenticated hosted MCP end-to-end is not certified: candidate is not published. Local handler fixtures and RLS-preserving source are not substitutes for a deployed authenticated check.

## Exact changed files

1. `AGENTS.md`
2. `roadmap.md`
3. `src/lib/mcp/keyset-page.ts`
4. `src/lib/mcp/tools/get-user-context.ts`
5. `src/lib/mcp/tools/list-work-items.ts`
6. `src/lib/mcp/tools/list-actuaciones.ts`
7. `src/lib/mcp/__tests__/portfolio-pagination.test.ts`
8. `src/lib/mcp/index.ts`
9. `.lovable/mcp/manifest.json` (generated)
10. `supabase/functions/mcp/index.ts` (generated)
11. `supabase/functions/_shared/actBatchState.ts`
12. `supabase/functions/_shared/syncFailureEvidence.ts`
13. `supabase/functions/_shared/syncFailureEvidence_test.ts`
14. `supabase/functions/_shared/continuationDispatch.ts`
15. `supabase/functions/_shared/continuationDispatch_test.ts`
16. `supabase/functions/sync-by-work-item/index.ts`
17. `supabase/functions/scheduled-daily-sync/index.ts`
18. `supabase/release/monitoring_coverage_fix_20261114.sql`
19. `supabase/release/monitoring_coverage_rollback_20261114.sql`
20. `supabase/tests/monitoring_coverage_equivalence_20261114.sql`
21. `docs/non-destructive-corrections-20261114.md`

## Remaining release / rollback

Run the SQL equivalence/performance test only on an isolated copy containing representative data; it evaluates both definitions in one repeatable-read snapshot, raises on any bidirectional EXCEPT ALL difference, EXPLAINs both, and rolls back. Do not invoke detect_stale_monitoring for testing: it produces alerts.

```sh
psql "$TEST_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/monitoring_coverage_equivalence_20261114.sql
# Only after isolated equivalence/performance review and separate SQL release:
psql "$APPROVED_DB_URL" -v ON_ERROR_STOP=1 -f supabase/release/monitoring_coverage_fix_20261114.sql
# SQL rollback, if needed:
psql "$APPROVED_DB_URL" -v ON_ERROR_STOP=1 -f supabase/release/monitoring_coverage_rollback_20261114.sql
```

No privilege changes accompany these files. Function rollback requires selectively redeploying the corresponding baseline source through the supported deployment flow, not reverting records. MCP activation requires full app republish then checking the public resource-documentation marker `mcp-rev-0-6-19`; manifest extraction alone is not deployment.

## Cost

Visible cumulative Lovable usage: 574 at start, 581 at final query: +7 credits during this turn so far. This is a period-counter difference, not per-command billing or guaranteed final turn cost. The previous client-directory correction's individual cost cannot be reconstructed from these counters. Tiny kept unchanged; no paid AI call, extra project or instance charge was initiated.