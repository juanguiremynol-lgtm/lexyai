# External Provider Wizard → Orchestrator Acceptance Criteria

## Overview
This document defines step-by-step acceptance checks for verifying that new external providers
added via the Super Admin Wizard are correctly discovered and used by the orchestrator,
scheduled sync, and global master sync — with NO code changes required.

## Architecture Summary

```
Wizard → provider_connectors + provider_instances + provider_instance_secrets
       → provider_coverage_overrides (attaches to workflow/dataKind)
       → provider_category_routes_global (routing precedence)

Orchestrator (syncOrchestrator.ts):
  1. Loads coverage overrides from DB (loadCoverageOverrides)
  2. Merges with hardcoded COVERAGE_MAP (getProviderCoverageWithOverrides)
  3. Creates dynamic adapter (genericRemoteAdapter.ts → provider-sync-external-provider)
  4. Executes via CHAIN/FANOUT as configured
  5. Records attempts in external_sync_run_attempts
```

## Pre-conditions
- Super Admin access to Platform Console
- At least one test organization with monitored work items
- The provider endpoint must follow the Atenia provider contract (POST /snapshot)

---

## Test 1: Add Provider via Wizard (enabled=false → test → attach → enable)

### Steps:
1. Navigate to `/platform/external-providers/wizard`
2. Choose "New" template
3. Create connector:
   - key: `TEST_PROVIDER` (uppercase, unique)
   - name: "Test External Provider"
   - allowed_domains: `["*.example.com"]`
   - capabilities: `["ACTUACIONES"]`
4. Create PLATFORM-scoped instance:
   - base_url: `https://api.example.com/v1`
   - auth_type: `API_KEY`
   - timeout_ms: 30000
5. Set encrypted API key via secrets step
6. Run Preflight — verify health check passes
7. Configure Routing:
   - Workflow: CGP, Scope: ACTS, Role: FALLBACK
   - **Attach to Coverage**: workflow=CGP, data_kind=ACTUACIONES, priority=100
8. Run E2E validation
9. Pass Readiness gate → provider created with `enabled=false`

### Verify:
```sql
-- Connector exists
SELECT id, key, is_enabled FROM provider_connectors WHERE key = 'TEST_PROVIDER';

-- Instance exists (PLATFORM scope)
SELECT id, scope, is_enabled FROM provider_instances WHERE connector_id = '<connector_id>';

-- Coverage override exists (disabled)
SELECT * FROM provider_coverage_overrides WHERE provider_key = 'TEST_PROVIDER';

-- Secret exists (encrypted)
SELECT id, is_active, key_version FROM provider_instance_secrets WHERE provider_instance_id = '<instance_id>';
```

## Test 2: Enable Provider and Trigger Sync

### Steps:
1. Enable the coverage override:
```sql
UPDATE provider_coverage_overrides SET enabled = true WHERE provider_key = 'TEST_PROVIDER';
```
2. Trigger Global Master Sync (enqueue+kick via Platform Console)
3. Wait for ledger completion

### Verify:
```sql
-- A) Attempt rows exist for new provider
SELECT provider, status, latency_ms, error_code
FROM external_sync_run_attempts
WHERE provider = 'TEST_PROVIDER'
ORDER BY recorded_at DESC
LIMIT 10;

-- B) No duplicate ingestion (check fingerprint uniqueness)
SELECT hash_fingerprint, count(*)
FROM work_item_acts
WHERE work_item_id = '<test_work_item_id>'
GROUP BY hash_fingerprint
HAVING count(*) > 1;

-- C) Provenance sources[] merge on conflict
SELECT sources
FROM work_item_acts
WHERE work_item_id = '<test_work_item_id>'
  AND 'TEST_PROVIDER' = ANY(sources);
```

## Test 3: Work Item UI Sources Badges

### Steps:
1. Open a work item that was synced with the new provider
2. Check the sources badges in the detail view

### Verify:
- Provider key appears in sources[] badges
- Tooltip shows provider name and sync timestamp

## Test 4: Heartbeats and Telemetry

### Verify:
```sql
-- Heartbeats for scheduled-daily-sync slices exist
SELECT started_at, status, metadata->>'chain_id' as chain_id
FROM platform_job_heartbeats
WHERE job_name = 'scheduled-daily-sync'
ORDER BY started_at DESC
LIMIT 10;

-- No orphaned RUNNING heartbeats
SELECT count(*) AS stuck
FROM platform_job_heartbeats
WHERE job_name = 'scheduled-daily-sync'
  AND status = 'RUNNING'
  AND started_at < now() - interval '10 minutes';
```

## Test 5: No User Notification Noise

### Verify:
```sql
-- Alert instances should not spike
SELECT count(*) AS recent_alerts
FROM alert_instances
WHERE created_at > now() - interval '1 hour';

-- No user-domain notifications from platform diagnosis
SELECT count(*)
FROM notifications
WHERE created_at > now() - interval '1 hour'
  AND type IN ('PROVIDER_INCIDENT', 'PLATFORM_DIAGNOSIS');
```

## Test 6: Rollback — Disable Without Deploy

### Steps:
1. Disable the coverage override:
```sql
UPDATE provider_coverage_overrides SET enabled = false WHERE provider_key = 'TEST_PROVIDER';
```
2. Trigger another sync

### Verify:
- No new `external_sync_run_attempts` rows for `TEST_PROVIDER`
- Existing built-in providers continue working normally
- No code deploy needed

## Test 7: FANOUT Semantics (TUTELA)

### Steps:
1. Add a new provider with coverage override for TUTELA/ACTUACIONES, execution_mode=FANOUT
2. Enable and trigger sync for a TUTELA work item

### Verify:
- All FANOUT providers called in parallel
- Cross-provider dedup active (same fingerprint → sources[] merge)
- No duplicate acts in DB

---

## Key Invariants

1. **Built-in providers are NEVER broken** — dynamic providers are additive unless `override_builtin=true`
2. **Single executor discipline** — all sync goes through `scheduled-daily-sync`
3. **Secrets never in plaintext** — all via `provider_instance_secrets` + AES-256
4. **Coverage overrides are platform-admin-only** — RLS enforced
5. **Attempt-level recording preserved** — every provider call creates `external_sync_run_attempts` row
6. **Dynamic providers use the same pipeline** — `provider-sync-external-provider` handles SSRF, mapping, provenance

---

## Release Invariants (Definition of Done)

These invariants MUST hold as new providers are added (6th, 7th, 10th…) without code changes.

### A. Provider Onboarding Invariants (Wizard → Runtime)

1. **Inert by default**: wizard-created providers start with `enabled=false`; no coverage override written unless explicitly configured.
2. **Registration gate**: orchestrator only registers dynamic providers where `enabled=true` AND at least one active coverage override row exists.
3. **Built-in baseline**: overrides may only (a) add new providers, (b) change ordering/roles, or (c) explicitly override built-ins when `override_builtin=true`.

### B. Orchestrator Execution Invariants (CHAIN / FANOUT)

1. **CHAIN stop semantics**: a non-empty success stops fall-through. "Empty" / "not_found" falls through. "Error/timeout" falls through only if role semantics permit (configurable).
2. **FANOUT completeness**: every provider attempt is recorded; canonical dedupe remains `(work_item_id, hash_fingerprint)` with `sources[]` merged additively via RPC upsert.
3. **Uniform execution**: dynamic providers use the same `safeProviderFetch` wrapper and `getProviderTimeout()` budget as built-ins.

### C. Telemetry Invariants

1. **Attempt-level completeness**: every provider call produces `external_sync_run_attempts` rows with `provider`, `role`, `data_kind`, `status`, `error_code`, `latency_ms`, `inserted_count`/`skipped_count`, correlated by `sync_run_id`.
2. **Supervisor independence**: wizard changes do not bypass degradation detection; it uses attempts and remains org-scoped.
3. **Trigger distinguishability**: manual and cron runs remain distinguishable via `trigger_source` and `manual_initiator_user_id` through ledger and heartbeat metadata.

### D. Testing Invariant (`release_gate`)

1. **Platform-admin only**: `release_gate.force_empty_provider` must be hard-disabled for non-platform admins and is no-op unless explicitly passed in the request body (never reads secrets/env).
2. **Scoped effect**: can only force-empty a single provider per invocation; cannot affect broader runs.

---

## Assertion Queries (4 Proofs + 1 Negative Test)

### Proof 1 — Override row existence
```sql
-- After wizard completes, the override row exists and is disabled
SELECT id, provider_key, workflow_type, data_kind, provider_role, enabled
FROM provider_coverage_overrides
WHERE provider_key = '<PROVIDER_KEY>'
  AND enabled = false;
-- Expected: exactly 1 row
```

### Proof 2 — Dynamic provider invocation attempt
```sql
-- After enabling override and triggering sync, the dynamic provider was invoked
SELECT provider, role, data_kind, status, error_code, latency_ms,
       inserted_count, skipped_count, sync_run_id
FROM external_sync_run_attempts
WHERE provider = '<PROVIDER_KEY>'
  AND created_at > now() - interval '15 minutes'
ORDER BY recorded_at DESC
LIMIT 5;
-- Expected: ≥1 row with latency_ms > 0
```

### Proof 3 — Zero deduplication violations
```sql
-- No duplicate (work_item_id, hash_fingerprint) pairs exist
SELECT work_item_id, hash_fingerprint, count(*) AS dupes
FROM work_item_acts
WHERE work_item_id = '<WORK_ITEM_ID>'
GROUP BY work_item_id, hash_fingerprint
HAVING count(*) > 1;
-- Expected: 0 rows
```

### Proof 4 — Rollback evidence (no residue after disable)
```sql
-- After setting enabled=false and re-triggering sync, no new attempts appear
SELECT count(*) AS post_disable_attempts
FROM external_sync_run_attempts
WHERE provider = '<PROVIDER_KEY>'
  AND recorded_at > '<DISABLE_TIMESTAMP>';
-- Expected: 0
```

### Negative Test — Disabled override produces no registration or attempts
```sql
-- Override exists but enabled=false → orchestrator must NOT register or invoke
-- Step 1: Verify override is disabled
SELECT id, provider_key, enabled
FROM provider_coverage_overrides
WHERE provider_key = '<PROVIDER_KEY>' AND enabled = false;
-- Expected: 1 row

-- Step 2: Trigger sync, then verify zero attempts
SELECT count(*) AS attempts_while_disabled
FROM external_sync_run_attempts
WHERE provider = '<PROVIDER_KEY>'
  AND recorded_at > '<SYNC_TRIGGER_TIMESTAMP>';
-- Expected: 0

-- Step 3: Verify orchestrator logs show 0 dynamic providers registered
-- (check edge function logs for "Registered 0 dynamic provider(s)" or absence of provider key)
```
