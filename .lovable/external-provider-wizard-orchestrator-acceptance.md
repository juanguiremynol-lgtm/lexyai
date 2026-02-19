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
