## Implementation Plan — Atenia/Andrómeda Reliability Hardening

Before writing code, this plan lists what I will change, the migrations I will add, and the assumptions/conflicts I found between the spec and the actual repo. I will only proceed after approval.

### Assumptions and conflicts with the spec

1. **`provider_sync_traces.provider` and `sync_item_failure_tracker.provider`** — the spec says these don't exist. I need to verify this by inspecting the live schema before writing the fix. If they do exist (schema summary shows `provider_sync_traces: 12 columns`), the daily-report code may actually be correct and the failure is elsewhere. I will treat "remove/derive provider" as conditional on confirming the column is truly missing.
2. **`provider_instances.config`** — generated types confirm no `config` column. This is a straight code fix (remove the select).
3. **`PENAL_906`** — schema likely uses this as the only penal workflow type; I will audit distinct `workflow_type` values in `work_items` and only expand `_shared/onlineSyncEligibility.ts` if other penal enums exist.
4. **`job_runs` telemetry table** — spec calls for a new table. The repo already has `platform_job_heartbeats`, `atenia_cron_runs`, and `sync_traces`. I will reuse `platform_job_heartbeats` for dispatch/liveness telemetry (extending it with `correlation_id`, `trigger_source`, `work_item_id`, `workflow_type` if missing) rather than adding a redundant `job_runs` table.
5. **Frontend/backend eligibility consistency check** — I will add `src/lib/externalSyncDisplay.ts` mirroring `_shared/onlineSyncEligibility.ts` and a vitest that asserts they match.
6. **"Do not modify Cloud Run"** — respected. I will only produce the diagnostic handoff if Supabase-side fixes don't resolve the 500s.
7. **Scope guard** — this spec is very large (touches ~6.7k lines across 5 core functions plus callers, migrations, UI mapping, tests). I will implement it in the order below and stop for feedback if any assumption above turns out wrong when I inspect the code.

### Files to modify

**Shared / new modules**
- `supabase/functions/_shared/onlineSyncEligibility.ts` — audit against actual `workflow_type` values; add helpers `resolveCloudRunRoute(workflow, purpose)` and `SYNC_COOLDOWN_MS`.
- `supabase/functions/_shared/jobTelemetry.ts` (new) — thin wrapper over `platform_job_heartbeats` for dispatch/started/finished/duplicate.
- `supabase/functions/_shared/dispatchAsync.ts` (new or extract from watchdog) — wrap `fetch` in `EdgeRuntime.waitUntil`, insert a `dispatched` row, add idempotency key.
- `supabase/functions/_shared/cloudRunProbe.ts` (new) — short-timeout probe returning `{reachable_ok | reachable_auth_failed | route_not_found | unreachable | timeout}`.
- `src/lib/externalSyncDisplay.ts` (new) — single frontend mapping `workflow_type → "estados" | "publicaciones" | "none"`.
- `src/lib/__tests__/externalSyncDisplay.test.ts` (new) — consistency assertion.

**Part 0 — watchdog/supervisor hardening**
- `supabase/functions/atenia-cron-watchdog/index.ts` — wrap dispatches in `EdgeRuntime.waitUntil`; add idempotency guard; rotate section order via `cron_state` cursor; dynamic drain within time budget; emit `skipped_due_to_time_budget` and queue-depth metrics; use jobTelemetry.
- `supabase/functions/atenia-ai-supervisor/index.ts` — same waitUntil wrapping; persist HEARTBEAT liveness row; PROCESS_QUEUE idempotency.

**Part 1 — daily report**
- `supabase/functions/atenia-daily-report/index.ts` — replace non-existent `provider` selects with derivation via `provider_instances`/`work_items.workflow_type`; add sections for queue depth, oldest queued age, skipped-time-budget, unknown-workflow-type counts, job-run summary.

**Part 2 — publicaciones sync**
- `supabase/functions/sync-publicaciones-by-work-item/index.ts` — full refactor:
  - Import eligibility; deny non-eligible with `ok:true, status:not_applicable`.
  - Validate config/secrets first; classified errors (`configuration_error`, `auth_error`, `route_mismatch`, `provider_unavailable`, `provider_timeout`, `provider_5xx`, `bad_payload`, `category_not_applicable`).
  - Never return HTTP 500 for upstream failure — return 200/202 with `ok:false, status:degraded`.
  - Per-work-item cooldown (30 min default, bypass on explicit manual refresh flag).
  - Correlation IDs; persist attempt telemetry.
  - Route CPACA to the CPACA/SAMAI Estados service, not the general publicaciones endpoints (fixes the fast `/snapshot,/search,/buscar` exhaustion).
- Callers updated to branch on response body:
  - `src/hooks/useLoginSync.ts`
  - `src/hooks/use-create-work-item.ts`
  - `src/components/**/NewTutelaDialog.tsx`
  - `src/lib/services/auto-sync-service.ts`
  - Any scheduled callers under `supabase/functions/scheduled-*`.

**Part 3 — preflight**
- `supabase/functions/atenia-preflight-check/index.ts` — remove `config` from select; use current schema fields; add Cloud Run probe per enabled instance; structured readiness output.

**UI tab enforcement**
- `src/pages/WorkItemDetail/index.tsx` — consume `externalSyncDisplay` instead of inline `workflow_type === 'CPACA'` check.
- Audit and remove any other hardcoded per-category tab logic.

**Cross-cutting audit (grep + fix)**
- `provider_sync_traces.provider`, `sync_item_failure_tracker.provider`, `provider_instances.config`, hardcoded category lists, GOV_PROC/PETICION dispatch paths.

### Migrations

1. **`YYYYMMDD_platform_job_heartbeats_extend.sql`** — add `correlation_id text`, `trigger_source text`, `work_item_id uuid`, `workflow_type text`, `error_summary text` to `platform_job_heartbeats` if missing; index on `(job_name, status, started_at)`; unique partial index for idempotency `(job_name, correlation_id) where correlation_id is not null`.
2. **`YYYYMMDD_cleanup_ineligible_sync_rows.sql`** — mark existing GOV_PROC/PETICION rows in `sync_retry_queue`, `sync_item_failure_tracker`, `atenia_ai_remediation_queue`, `work_item_coverage_gaps` as `cancelled_not_applicable` (add status value if enum) without hard-deleting. Preserve audit trail.
3. **`YYYYMMDD_cron_state_section_cursor.sql`** — add row in `cron_state` for watchdog section-rotation cursor (if `cron_state` supports arbitrary keys already, skip).
4. Only add a `provider_sync_traces.provider` / `sync_item_failure_tracker.provider` migration if inspection confirms the columns are truly missing AND derivation from relational data is impossible. Default plan: derive, do not add.

Supabase types will regenerate automatically after each migration is approved and applied.

### Deliverables produced alongside code

- **Category mapping table** (section 4) — added as `docs/sync-routing-map.md`.
- **Routing map** (section 7.0) — same doc, second table.
- **Diagnostic handoff** (section 7.9) — produced only if, after all Supabase-side fixes, Cloud Run probes still fail. I will call `code--exec` to run the new preflight probe against the live services and produce the handoff document only if warranted.

### Execution order

1. Inspect actual schema for the three "missing column" claims and distinct `workflow_type` values.
2. Land shared modules + frontend mapping + tests.
3. Migration 1 (heartbeats extension).
4. Fix preflight (Part 3) — smallest, unblocks probe reuse.
5. Fix daily report (Part 1).
6. Refactor `sync-publicaciones-by-work-item` + callers (Part 2).
7. Harden watchdog + supervisor (Part 0).
8. Migration 2 (cleanup ineligible rows).
9. UI tab enforcement + audit sweep.
10. Verify: run tests, hit preflight, hit publicaciones sync for an ineligible category, confirm structured responses.

### What I will not do

- Not move scraping into Supabase.
- Not modify Cloud Run services.
- Not add a parallel `job_runs` table if `platform_job_heartbeats` suffices.
- Not revert the recent watchdog/supervisor async changes.
- Not hard-delete any historical rows.
- Not redesign Atenia or the Work Item Detail page.

Approve this plan and I will execute in the order above, stopping to flag any assumption that turns out wrong during inspection.
