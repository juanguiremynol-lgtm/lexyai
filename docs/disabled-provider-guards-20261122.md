# Execution guards for disabled source queries

Base: `259444d9cfe28b3caf9978421b3c583fe1e78a0f`. Its
`supabase/functions` tree is `0412f0f471a63557b3a96f78e9edf9f3970e6f57`.
This is source provenance; it does not assert the deployed revision.

The canonical daily selector requires `monitoring_enabled=true`,
`scraping_enabled=true` and an active, nondeleted matter. Two additional callers
could bypass those flags: `bridge-reconcile` selected monitoring only (and
explicit IDs bypassed even that filter); `provider-sync-external-provider`
loaded no lifecycle/suspension fields before posting a provider snapshot.

Both callers now check those flags before provider calls. The external snapshot
caller also respects disabled source and provider-instance records. Exclusions
return `SKIPPED`, `source_query_attempted=false`, `source_complete=false`; the
bridge returns excluded IDs/reasons and advances its cursor past explicit skips.
No judicial rows, queue history or freshness timestamps are changed by a skip.
Legitimate reactivation is evaluated on the next read. Registration and upstream
disable operations are not changed; a per-tenant exclusion cannot justify
globally disabling a shared Cloud radicado.

Tests (synthetic data, no judicial portal queries):

- `node --test scripts/test-provider-query-guards.mjs`: 8/8. Executes the actual
  handler control flow with mocked database/import boundaries; provider and
  secret boundaries throw if a disabled case reaches them.
- `deno test --allow-env supabase/functions/_shared/publicEligibility_test.ts
  supabase/functions/_shared/retryEligibility_test.ts`: 4/4.
- `deno check supabase/functions/_shared/providerQueryEligibility.ts`: passes.
- `npm run check:mcp:source`: passes.
- `deno run --no-check --allow-all scripts/check-mcp-artifact.ts`: passes. The
  generated MCP bundle was neither hand-edited nor suppressed.
- The base `npm ci` failed because the manifest's two existing Lovable Vite
  plugins were absent from `package-lock.json`. Regeneration adds only those
  entries (32 lines); clean `npm ci --ignore-scripts` then passes (618 packages).
- General `npm run typecheck` reports 29 errors across 22 unchanged application
  files. They involve strict Supabase write argument typing in UI, ingestion,
  calendar and billing code, not the generated MCP artifact. No blanket
  suppression or unrelated edits were applied. Full frontend publication is
  not verified by this patch.

Deployment pending: publish only `bridge-reconcile` and
`provider-sync-external-provider` with the shared `providerQueryEligibility.ts`
through the existing authorized application channel. No SQL migration,
frontend publish, cron, IAM, secret, MCP deployment or Lovable AI session is
needed for these two guards. A Git push alone does not deploy managed functions.
Rollback consists of restoring those two functions from the base revision;
that reopens the known disabled-source bypass, so forward correction is preferred.

Read-only MCP evidence at 21 November 2026, approximately 20:51–21:00 Bogotá:
143 visible rows, 103 active matters, 81 active monitoring-enabled matters.
Of 66 active non-CPACA radicados, 63 have scraping enabled and 3 disabled; 15
active CPACA are separate. These totals do not certify provider coverage.
The MCP freshness endpoint is issues-only and must not be used as a complete
portfolio denominator. Individual readbacks were obtained for all 15 CPACA:
12 actuaciones checks verified, one partial persistence failure, one older
Cornare observation and one EDU last-attempt failure; 15 stored Estados checks
verified. No fresh provider query was made in this work.

The current MCP surface does not expose `persistence_summary`: get_work_item
strips timeline metadata and query_table allows only its catalogued tables.
For matter `154b4c7d-78e9-4dc2-8989-1b70a5349aec`, the latest failure timeline is
`6f6c93db-e529-452a-87f1-ff798ad244c4`, finished `2026-11-22T01:03:04.157Z`,
`PERSISTENCE_FAILED`, 3 inserted and 34 skipped, source observation
`2026-11-21T07:39:38.805Z`, no new source query. Its exact failed-write cause
requires the authorized application-side timeline metadata/log read; it is not
inferred from this summary.

Production activation, signed-in visual checks and the future 22 November
02:10 Cloud / 07:20 application cycle remain distinct pending validations.
