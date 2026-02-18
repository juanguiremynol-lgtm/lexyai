# Release Gate Test Plan — Orchestrator + Watchdog E2E

> **Version**: 1.0  
> **Last Updated**: 2026-02-18  
> **Scope**: Orchestrator execution, provider calls (CHAIN + FANOUT), canonical DB writes, notification triggers, UI display, watchdog + heartbeat under forced timeout.

---

## Preconditions

| # | Precondition | How to verify |
|---|-------------|---------------|
| 1 | Per-org toggle `atenia_ai_config.use_orchestrator_sync` exists | `SELECT use_orchestrator_sync FROM atenia_ai_config LIMIT 1;` |
| 2 | `external_sync_runs` + `external_sync_run_attempts` tables exist | Check schema |
| 3 | `platform_job_heartbeats` exists, RLS restricted to platform admins | `SELECT policyname FROM pg_policies WHERE tablename='platform_job_heartbeats';` |
| 4 | Work Item detail shows: ActCard with sources[], SyncStatusBadge, publicaciones | Visual check |
| 5 | Forced timeout hook deployed in `syncOrchestrator.ts` | Env vars `FORCE_PROVIDER_TIMEOUT*` are recognized |

---

## Test Data Setup

### A) Enable orchestrator for canary org

```sql
-- Replace ORG_CANARY_ID with the actual UUID
UPDATE atenia_ai_config
SET use_orchestrator_sync = true
WHERE organization_id = 'ORG_CANARY_ID';
```

### B) Identify test work items

| Work Item | `workflow_type` | Execution mode | Purpose |
|-----------|----------------|----------------|---------|
| `WORK_ITEM_CHAIN` | `CGP` or `CPACA` | CHAIN | Primary→fallback validation |
| `WORK_ITEM_TUTELA` | `TUTELA` | FANOUT | Multi-provider parallel + dedupe |

Both must have valid radicados that produce real provider responses.

---

## Forced Timeout Hook (already implemented)

**Mechanism**: Env vars in `syncOrchestrator.ts → safeProviderFetch()`:

| Env Var | Value | Description |
|---------|-------|-------------|
| `FORCE_PROVIDER_TIMEOUT` | `true` | Global enable |
| `FORCE_PROVIDER_TIMEOUT_PROVIDER` | e.g. `SAMAI_ESTADOS` | Which provider to force-timeout |
| `FORCE_PROVIDER_TIMEOUT_ORGS` | `ORG_CANARY_ID` | Comma-separated org UUIDs |

**Behavior**: When all 3 match, `safeProviderFetch` sleeps for `timeout_budget + 5s` then returns `FORCED_TIMEOUT` error. Only affects the matching org + provider. Impossible to trigger for other orgs.

**Revert**: Remove or unset `FORCE_PROVIDER_TIMEOUT` env var.

---

## Test Cases

### CASE 1 — Happy Path CHAIN: Orchestrator + DB Writes + UI

**Trigger**: Sync `WORK_ITEM_CHAIN` via UI "Sync now" or `sync-by-work-item` edge function.

#### Verification Checklist

| # | Check | SQL / Method | Expected |
|---|-------|-------------|----------|
| 1.1 | Sync run created | `SELECT * FROM external_sync_runs WHERE work_item_id='...' ORDER BY started_at DESC LIMIT 1;` | Row exists, `status` = `SUCCESS` or `PARTIAL` |
| 1.2 | Attempt rows exist | `SELECT * FROM external_sync_run_attempts WHERE sync_run_id='...' ORDER BY recorded_at;` | ≥1 row, `status=success` for primary (or fallback if primary failed), `latency_ms` > 0 |
| 1.3 | Canonical acts written | `SELECT id, hash_fingerprint, sources FROM work_item_acts WHERE work_item_id='...' ORDER BY act_date DESC LIMIT 5;` | `hash_fingerprint` non-null, `sources[]` non-empty |
| 1.4 | Publicaciones written (if applicable) | `SELECT id, hash_fingerprint, sources FROM work_item_publicaciones WHERE work_item_id='...' ORDER BY published_date DESC LIMIT 5;` | `hash_fingerprint` non-null |
| 1.5 | No platform incidents | `SELECT * FROM atenia_ai_conversations WHERE status='OPEN' AND created_at > now() - interval '5 minutes';` | No new incidents from this sync |
| 1.6 | UI: SyncStatusBadge | Work item detail page | Shows latest run time + attempt stats in tooltip |
| 1.7 | UI: sources badges | WorkItemActCard for new acts | Shows provider source badge(s) |

**Pass criteria**: All 7 checks pass.

---

### CASE 2 — Happy Path FANOUT (TUTELA): Multi-Provider Dedupe + Provenance

**Trigger**: Sync `WORK_ITEM_TUTELA` via UI or edge function.

#### Verification Checklist

| # | Check | SQL / Method | Expected |
|---|-------|-------------|----------|
| 2.1 | Multiple attempt rows | `SELECT provider, data_kind, status FROM external_sync_run_attempts WHERE sync_run_id='...' ORDER BY recorded_at;` | Rows for ALL providers in TUTELA FANOUT (e.g., CPNU + TUTELAS + SAMAI for ACTUACIONES) |
| 2.2 | Concurrency respected | Check `recorded_at` timestamps | No more than `FANOUT_CONCURRENCY` (2) overlapping at once |
| 2.3 | Dedupe: single row per event | `SELECT hash_fingerprint, sources, COUNT(*) FROM work_item_acts WHERE work_item_id='...' GROUP BY hash_fingerprint, sources HAVING COUNT(*) > 1;` | 0 rows (no duplicates) |
| 2.4 | Provenance merge | `SELECT id, sources FROM work_item_acts WHERE work_item_id='...' AND array_length(sources, 1) > 1 LIMIT 5;` | ≥1 row with multiple sources (e.g., `{cpnu,tutelas-api}`) |
| 2.5 | UI: multi-source indicator | WorkItemActCard | "Confirmado por N fuentes" tooltip visible |

**Pass criteria**: All 5 checks pass.

---

### CASE 3 — Failure Injection: Forced Timeout → Watchdog + Heartbeat

**Goal**: Force a provider timeout, verify: (i) attempt recorded, (ii) org-scoped incident, (iii) no user notification noise, (iv) heartbeat failure.

#### Setup

1. Set env vars for canary org:
   ```
   FORCE_PROVIDER_TIMEOUT=true
   FORCE_PROVIDER_TIMEOUT_PROVIDER=SAMAI_ESTADOS  # or CPNU
   FORCE_PROVIDER_TIMEOUT_ORGS=ORG_CANARY_ID
   ```

2. Trigger sync for a work item that uses the forced provider (e.g., CPACA → SAMAI_ESTADOS, or CGP → CPNU).

#### Verification Checklist

| # | Check | SQL / Method | Expected |
|---|-------|-------------|----------|
| 3.1 | Attempt recorded | `SELECT * FROM external_sync_run_attempts WHERE sync_run_id='...' AND provider='SAMAI_ESTADOS';` | `status=timeout`, `error_code=FORCED_TIMEOUT`, `latency_ms >= timeout_budget` |
| 3.2 | Sync run shows failure | `SELECT status, error_code FROM external_sync_runs WHERE id='...';` | `status=FAILED` or `PARTIAL` |
| 3.3 | Org-scoped incident | `SELECT * FROM atenia_ai_conversations WHERE organization_id='ORG_CANARY_ID' AND status='OPEN' AND title ILIKE '%SAMAI_ESTADOS%' ORDER BY created_at DESC LIMIT 1;` | Incident exists, scoped to canary org (NOT global) |
| 3.4 | Evidence attached | `SELECT * FROM atenia_ai_observations WHERE conversation_id='...' ORDER BY created_at DESC LIMIT 3;` | Observation(s) with attempt stats, no raw payloads |
| 3.5 | Debounce respected | Re-trigger sync within 15 min | No duplicate observations (check `created_at` gap ≥ 15 min unless severity escalated) |
| 3.6 | No user notification noise | `SELECT * FROM alert_instances WHERE owner_id IN (SELECT owner_id FROM work_items WHERE id='...') AND created_at > now() - interval '10 minutes' AND alert_type NOT IN ('ACTUACION_NUEVA','ESTADO_NUEVO');` | 0 rows for timeout-triggered alerts |
| 3.7 | Heartbeat failure (if sync job writes heartbeat) | `SELECT * FROM platform_job_heartbeats WHERE job_name LIKE '%sync%' AND status='ERROR' ORDER BY started_at DESC LIMIT 1;` | Row with `error_code` matching timeout, `duration_ms` populated |
| 3.8 | UI: no unexpected badge | SyncStatusBadge for the work item | Shows failure state, NOT "Sincronizando..." stuck |

#### Recovery

1. **Revert hook**: Unset `FORCE_PROVIDER_TIMEOUT` env var (or set to `false`).
2. **Re-sync**: Trigger sync for the same work item.
3. **Verify recovery**:

| # | Check | Expected |
|---|-------|----------|
| R.1 | Attempt success | New attempt row with `status=success` |
| R.2 | Incident resolves/de-escalates | Incident severity drops or status → `RESOLVED` per policy |
| R.3 | SyncStatusBadge | Shows healthy sync timestamp |

---

## Acceptance Criteria Summary

**PASS** only if ALL of the following hold:

- [ ] **CASE 1**: Orchestrator executes CHAIN, attempt rows exist, canonical tables written with `hash_fingerprint`, UI reflects runs + sources.
- [ ] **CASE 2**: FANOUT produces attempts for all providers, cross-provider dedupe works (single row per hash), multi-source provenance merges, UI shows "Confirmado por N fuentes".
- [ ] **CASE 3**: Forced timeout produces: (i) attempt with `FORCED_TIMEOUT`, (ii) org-scoped incident with evidence, (iii) no spurious user notifications, (iv) heartbeat failure recorded. Recovery restores normal operation.

---

## Rollback Procedure

```sql
-- 1. Disable orchestrator for canary org
UPDATE atenia_ai_config
SET use_orchestrator_sync = false
WHERE organization_id = 'ORG_CANARY_ID';
```

```
-- 2. Disable forced timeout (env var)
FORCE_PROVIDER_TIMEOUT=false
```

```sql
-- 3. Verify no residual incidents
SELECT id, title, status, organization_id
FROM atenia_ai_conversations
WHERE organization_id = 'ORG_CANARY_ID'
  AND status = 'OPEN'
  AND created_at > now() - interval '1 hour';
-- Manually resolve any test-created incidents if needed.
```

---

## Boundary Validation (Domain Separation)

| Action | Creates platform incident? | Creates user notification? |
|--------|--------------------------|---------------------------|
| Provider timeout (FORCED_TIMEOUT) | ✅ Yes (org-scoped) | ❌ No |
| New actuación inserted | ❌ No | ✅ Yes (ACTUACION_NUEVA) |
| Audiencia próxima alert | ❌ No | ✅ Yes (user alert) |
| Tarea vencida alert | ❌ No | ✅ Yes (user alert) |
| Heartbeat missed | ✅ Yes (platform) | ❌ No |

This table MUST hold true. Any violation is a release blocker.
