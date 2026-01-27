# Work Item Migration Hardening Runbook

**Version**: 2.0  
**Date**: 2026-01-27  
**Status**: Production Hardened

---

## Executive Summary

This runbook documents the complete migration from legacy entity tables (`filings`, `monitored_processes`) to the canonical `work_items` table. All operational pipelines, including ingestion, timeline (`process_events`), milestones (`cgp_milestones`), and alerts, are now keyed to `work_item_id`.

**Security Hardening (v2.0):** Functions `resolve_work_item_id` and `backfill_work_item_ids` are now locked to service_role only. Organization scoping is mandatory for legacy ID resolution.

---

## Phase 0: Database Schema Hardening ✅

### 0.1 Foreign Keys (Implemented)

```sql
-- Verify foreign keys exist:
SELECT conname, conrelid::regclass, confrelid::regclass
FROM pg_constraint
WHERE conname IN (
  'actuaciones_work_item_id_fkey',
  'process_events_work_item_id_fkey',
  'cgp_milestones_work_item_id_fkey'
);
```

### 0.2 Performance Indexes (Implemented)

```sql
-- Verify indexes exist:
SELECT indexname, tablename 
FROM pg_indexes 
WHERE indexname IN (
  'idx_actuaciones_work_item_date',
  'idx_process_events_work_item_date',
  'idx_cgp_milestones_work_item_type'
);
```

### 0.3 Dedup Uniqueness Constraints (Implemented)

```sql
-- Verify unique constraints:
SELECT indexname, tablename 
FROM pg_indexes 
WHERE indexname IN (
  'idx_actuaciones_work_item_fingerprint_unique',
  'idx_process_events_work_item_fingerprint_unique'
);
```

---

## Phase 1: RLS & Multi-tenant Safety ✅

### 1.1 Security Definer Function Lockdown

**CRITICAL:** These functions are now restricted to service_role only:

```sql
-- Verify permissions (should return empty for anon/authenticated):
SELECT grantee, privilege_type 
FROM information_schema.routine_privileges 
WHERE routine_name IN ('resolve_work_item_id', 'backfill_work_item_ids')
  AND grantee IN ('anon', 'authenticated');
```

### 1.2 Scoping Rules (Enforced)

All writes to event tables include:
- `work_item_id` (primary key)
- `owner_id` (from JWT auth context)
- Organization scope derived from `work_items.organization_id`

### 1.3 Tenant Isolation in Edge Functions

| Edge Function | Scoping Strategy | Status |
|---------------|------------------|--------|
| `normalize-actuaciones` | owner_id from JWT + work_item validation | ✅ |
| `scheduled-crawler` | Iterates work_items per owner | ✅ |
| `adapter-publicaciones` | owner_id from JWT + work_item validation | ✅ |
| `adapter-historico` | owner_id from JWT + work_item validation | ✅ |
| `sync-by-radicado` | owner_id from JWT | ✅ |
| `sync-penal906-by-radicado` | owner_id from JWT | ✅ |

### 1.4 resolve_work_item_id Security

The function now supports mandatory `p_organization_id` parameter:

```sql
-- Secure usage (organization-scoped):
SELECT public.resolve_work_item_id(
  p_radicado := '12345678901234567890123',
  p_owner_id := 'uuid-here',
  p_organization_id := 'org-uuid-here',  -- MANDATORY for security
  p_legacy_filing_id := NULL,
  p_legacy_process_id := NULL
);
```

### 1.5 Verification Query

```sql
-- Check for any cross-tenant writes (should return 0):
SELECT COUNT(*) 
FROM actuaciones a
LEFT JOIN work_items w ON a.work_item_id = w.id
WHERE a.owner_id != w.owner_id
   OR (a.organization_id IS NOT NULL AND a.organization_id != w.organization_id);
```

---

## Phase 2: Backfill & Exceptions Report ✅

### 2.1 Run Backfill Function

```sql
-- Execute backfill (idempotent, safe to re-run):
-- NOTE: Must be run as service_role (not authenticated user)
SELECT * FROM public.backfill_work_item_ids();
```

**Expected Output:**
| table_name | total_rows | already_mapped | newly_mapped | unmapped | exceptions |
|------------|------------|----------------|--------------|----------|------------|
| actuaciones | N | N | 0 | 0 | [] |
| process_events | N | N | 0 | 0 | [] |
| cgp_milestones | N | N | 0 | 0 | [] |

### 2.2 Backfill Mapping Steps

The function performs three mapping steps in order:

1. **Legacy Filing ID**: `actuaciones.filing_id` → `work_items.legacy_filing_id`
2. **Legacy Process ID**: `actuaciones.monitored_process_id` → `work_items.legacy_process_id`
3. **Radicado Match**: Normalized 23-digit radicado + `owner_id` + `organization_id`

Ambiguous mappings (multiple work_items match) are skipped and recorded as exceptions.

### 2.3 Exceptions Report

```sql
-- View unmapped rows (if any):
SELECT * FROM actuaciones WHERE work_item_id IS NULL;
SELECT * FROM process_events WHERE work_item_id IS NULL;
SELECT * FROM cgp_milestones WHERE work_item_id IS NULL;
```

### 2.4 Migration Health Check

```sql
-- View overall migration status:
SELECT * FROM public.migration_health_check;
```

**Expected Columns:**
| Column | Description |
|--------|-------------|
| table_name | Table being checked |
| total_rows | Total row count |
| with_work_item_id | Rows with work_item_id populated |
| missing_work_item_id | Rows without work_item_id |
| pct_mapped | Percentage mapped (target: ≥99%) |
| unique_work_items | Distinct work_item_id values |
| dupe_groups | Count of (work_item_id, hash_fingerprint) groups with duplicates |
| max_dupe_count | Maximum duplicates in any single group |

**Pass Criteria:**
- `pct_mapped` >= 99% for all tables
- `dupe_groups` = 0
- `max_dupe_count` = 0

---

## Phase 3: Strict Precedence Rules ✅

### 3.1 Precedence Logic

All edge functions and frontend hooks follow this rule:

```
1. IF work_item_id is provided → USE IT
2. ELSE IF legacy_filing_id or legacy_process_id is provided → RESOLVE to work_item_id
3. ELSE → FAIL with clear error
```

### 3.2 Fallback Observability

Log events to track fallback usage. Search for these patterns in Edge Function logs:

```
[FUNCTION_NAME][FALLBACK] Using legacy identifier
```

**Query Supabase Edge Function Logs:**
```
Search for: "[FALLBACK]"
```

### 3.3 Updated Edge Functions

| Function | Primary Input | Legacy Fallback | Status |
|----------|---------------|-----------------|--------|
| `normalize-actuaciones` | `work_item_id` | filing_id, monitored_process_id | ✅ |
| `scheduled-crawler` | work_items table | N/A | ✅ |
| `adapter-publicaciones` | `work_item_id` | monitored_process_id | ✅ |
| `adapter-historico` | `work_item_id` | monitored_process_id | ✅ |
| `crawl-rama-judicial` | `work_item_id` | filing_id | ✅ |

---

## Phase 4: End-to-End Regression Suite ✅

### 4.1 Test Scenarios

#### CGP Workflow
- [ ] `sync-by-radicado` inserts actuaciones with `work_item_id`
- [ ] `normalize-actuaciones` creates timeline events for same `work_item_id`
- [ ] Stage/milestones updates do not create duplicates
- [ ] UI renders acts and timeline for `work_item_id`

#### LABORAL / TUTELA Workflow
- [ ] Estados import works without `filing_id`
- [ ] UI renders acts and timeline for `work_item_id`

#### CPACA Workflow
- [ ] Scraping/sync populates acts
- [ ] UI reads by `work_item_id`

#### PENAL_906 Workflow
- [ ] UI does not break or infinite load
- [ ] Stage remains stable

### 4.2 Validation Queries

```sql
-- 1. Migration health check (comprehensive)
SELECT * FROM public.migration_health_check;

-- 2. Duplicate fingerprints per work_item (should be 0)
SELECT work_item_id, hash_fingerprint, COUNT(*) 
FROM actuaciones 
WHERE work_item_id IS NOT NULL AND hash_fingerprint IS NOT NULL
GROUP BY work_item_id, hash_fingerprint 
HAVING COUNT(*) > 1;

-- 3. Timeline/event counts per work_item (top 20)
SELECT work_item_id, COUNT(*) AS event_count
FROM actuaciones
WHERE work_item_id IS NOT NULL
GROUP BY work_item_id
ORDER BY event_count DESC
LIMIT 20;

-- 4. Crawler writes scoped by org
SELECT 
  w.organization_id,
  COUNT(a.id) AS actuaciones_count
FROM actuaciones a
JOIN work_items w ON a.work_item_id = w.id
GROUP BY w.organization_id;

-- 5. Orphan check (should be 0 due to FK)
SELECT COUNT(*) FROM actuaciones 
WHERE work_item_id IS NOT NULL 
  AND work_item_id NOT IN (SELECT id FROM work_items);
```

---

## Phase 5: Cutover Gates & Legacy Decommission ✅

### 5.1 Cutover Gates (Must Pass)

| Gate | Criteria | Query | Status |
|------|----------|-------|--------|
| G1 | ≥99% actuaciones with work_item_id | `SELECT * FROM migration_health_check WHERE table_name = 'actuaciones'` | ☐ |
| G2 | Zero duplicate groups | `SELECT * FROM migration_health_check WHERE dupe_groups > 0` | ☐ |
| G3 | UI reads exclusively by work_item_id | Manual testing | ☐ |
| G4 | normalize-actuaciones requires work_item_id | Code review | ✅ |
| G5 | scheduled-crawler uses work_items only | Code review | ✅ |
| G6 | Fallback usage near-zero for 7-14 days | Edge function logs | ☐ |
| G7 | No cross-tenant writes | Verification query | ☐ |

### 5.2 Gate Verification Script

Run this comprehensive check before proceeding to cleanup:

```sql
-- GATE VERIFICATION SCRIPT
WITH gates AS (
  SELECT 
    'G1_PCT_MAPPED' AS gate,
    CASE WHEN pct_mapped >= 99 THEN 'PASS' ELSE 'FAIL' END AS status,
    pct_mapped::TEXT AS value
  FROM migration_health_check 
  WHERE table_name = 'actuaciones'
  
  UNION ALL
  
  SELECT 
    'G2_NO_DUPES',
    CASE WHEN dupe_groups = 0 THEN 'PASS' ELSE 'FAIL' END,
    dupe_groups::TEXT
  FROM migration_health_check 
  WHERE table_name = 'actuaciones'
  
  UNION ALL
  
  SELECT 
    'G7_NO_CROSS_TENANT',
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
    COUNT(*)::TEXT
  FROM actuaciones a
  LEFT JOIN work_items w ON a.work_item_id = w.id
  WHERE a.work_item_id IS NOT NULL 
    AND (a.owner_id != w.owner_id 
         OR (a.organization_id IS NOT NULL AND a.organization_id != w.organization_id))
)
SELECT * FROM gates;
```

### 5.3 Cleanup Steps (After Gates Pass)

**Step 1: Disable Legacy Writes** (After 14 days of stable operation)
- Update all edge functions to reject legacy ID parameters
- Remove fallback resolution code
- Log: `[LEGACY_DISABLED] Function no longer accepts filing_id/monitored_process_id`

**Step 2: Remove Legacy Codepaths** (After 30 days)
- Delete legacy redirect routes
- Remove legacy type definitions
- Clean up unused imports

**Step 3: Drop Legacy Tables** (After 90 days)
- Archive data before dropping
- Drop `filings` table
- Drop `monitored_processes` table
- Drop legacy columns from `actuaciones`, `process_events`, `cgp_milestones`

### 5.4 Rollback Plan

If issues arise after cutover:

1. **Immediate**: Re-enable legacy fallback code (git revert)
2. **Schema**: Legacy columns are preserved, no schema rollback needed
3. **Data**: Run backfill in reverse (not needed if columns preserved)

---

## Helper Functions Reference

### resolve_work_item_id()

```sql
-- Resolve work_item_id from various inputs
-- MUST be called as service_role
SELECT public.resolve_work_item_id(
  p_radicado := '12345678901234567890123',
  p_owner_id := 'uuid-here',
  p_organization_id := 'org-uuid-here',  -- Mandatory for security
  p_legacy_filing_id := NULL,
  p_legacy_process_id := NULL
);
```

### backfill_work_item_ids()

```sql
-- Run idempotent backfill
-- MUST be called as service_role
SELECT * FROM public.backfill_work_item_ids();
```

### migration_health_check

```sql
-- View migration status (readable by authenticated users)
SELECT * FROM public.migration_health_check;
```

---

## Observability Dashboard Queries

### Daily Fallback Usage

```sql
-- Count legacy fallback usage (requires edge function logging)
-- Monitor this metric; should trend to zero
SELECT 
  DATE(created_at) AS day,
  COUNT(*) FILTER (WHERE metadata->>'used_fallback' = 'true') AS fallback_count,
  COUNT(*) AS total_count
FROM audit_logs
WHERE action LIKE '%SYNC%' OR action LIKE '%CRAWL%'
GROUP BY DATE(created_at)
ORDER BY day DESC
LIMIT 14;
```

### Workflow Coverage

```sql
-- Events per workflow type
SELECT 
  w.workflow_type,
  COUNT(DISTINCT w.id) AS work_items,
  COUNT(a.id) AS actuaciones
FROM work_items w
LEFT JOIN actuaciones a ON a.work_item_id = w.id
GROUP BY w.workflow_type
ORDER BY actuaciones DESC;
```

### Security Audit

```sql
-- Verify function permissions are locked down
SELECT 
  r.routine_name,
  r.routine_type,
  array_agg(DISTINCT p.grantee) AS grantees
FROM information_schema.routines r
LEFT JOIN information_schema.routine_privileges p 
  ON r.routine_name = p.routine_name
WHERE r.routine_schema = 'public'
  AND r.routine_name IN ('resolve_work_item_id', 'backfill_work_item_ids')
GROUP BY r.routine_name, r.routine_type;
```

---

## FK Delete Policy

Foreign keys use `ON DELETE CASCADE`. Protection against accidental deletion:

1. **RLS Policy**: Only `owner_id` or org admins can delete work_items
2. **Edge Functions**: `delete-work-items` validates ownership before deletion
3. **Audit**: All deletions logged to `audit_logs`

```sql
-- Verify RLS delete policy exists
SELECT policyname, cmd, qual 
FROM pg_policies 
WHERE tablename = 'work_items' AND cmd = 'DELETE';
```

---

## Contacts & Escalation

- **Technical Owner**: Engineering Team
- **Database Admin**: DBA Team
- **Incident Response**: On-call Engineer

---

## Changelog

| Date | Version | Change |
|------|---------|--------|
| 2026-01-27 | 1.0 | Initial runbook created |
| 2026-01-27 | 2.0 | Security hardening: function lockdown, org scoping, enhanced backfill, improved metrics |
