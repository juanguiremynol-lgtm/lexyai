# Sync Pipeline Migration Checklist (Layer 5)

> **Purpose**: For any future architectural change to the sync pipeline (new orchestrator, new provider, refactor), this checklist must be completed BEFORE merging. This prevents regressions like the `last_synced_at` unconditional update bug.

---

## Behavioral Invariants (verify each one is preserved)

- [ ] `last_synced_at` ONLY updates on confirmed data persistence or explicit empty-from-provider
- [ ] `last_synced_at` does NOT update on timeout, error, budget exhaustion, or skip
- [ ] `last_attempted_sync_at` ALWAYS updates on every sync attempt regardless of outcome
- [ ] Canonical tables (`work_item_acts`, `work_item_publicaciones`) are append-only during sync
- [ ] `hash_fingerprint` is computed source-agnostically (no `source_platform` in hash input)
- [ ] Every provider in a fan-out produces an explicit typed result (no void/undefined)
- [ ] Errors are logged with `correlationId`, never swallowed silently
- [ ] Partial success is distinguishable from full success and from failure
- [ ] DB trigger `guard_work_item_last_synced` blocks `last_synced_at` advance when zero data present

## Provider Routing (verify for each category)

- [ ] CGP → CPNU is called
- [ ] CPACA → SAMAI is called
- [ ] TUTELA → fan-out includes CPNU + TUTELAS (at minimum)
- [ ] LABORAL → CPNU is called
- [ ] PENAL_906 → CPNU is called
- [ ] No category falls through without selecting any provider

## Credentials & Environment

- [ ] All provider API keys/URLs are available in the new runtime environment
- [ ] Env vars copied from old edge function(s) to new orchestrator function
- [ ] Network egress / allowlist permits outbound calls to all provider endpoints

## Data Path

- [ ] Upsert target tables are the same as before migration
- [ ] Upsert conflict key is `hash_fingerprint` (not composite with `source_platform`)
- [ ] `source_platform` is correctly set per provider
- [ ] Transaction boundaries ensure data write and status update are atomic (or status is conditional)

## Observability

- [ ] Structured `[SYNC_LOG]` JSON emitted on every run
- [ ] Sync failures produce alerts (not just log lines)
- [ ] Watchdog invariant checks (freshness-vs-data, source gaps, count regression) cover the new code path

## Testing

- [ ] All Layer 4 regression tests pass (`src/test/sync-invariants.test.ts`)
- [ ] Manual E2E test for at least one work item per category
- [ ] Compare `act_count`/`pub_count` before and after migration for a sample of items

---

## Post-Migration Validation Queries

Run within 24 hours of deploying any sync pipeline change:

### 1. Freshness vs Data Regression Check

```sql
-- Expected: ZERO rows. Any rows = regression.
SELECT wi.id, wi.workflow_type, wi.last_synced_at,
  (SELECT COUNT(*) FROM work_item_acts WHERE work_item_id = wi.id) as acts,
  (SELECT COUNT(*) FROM work_item_publicaciones WHERE work_item_id = wi.id) as pubs
FROM work_items wi
WHERE wi.monitoring_enabled = true
  AND wi.last_synced_at > NOW() - INTERVAL '24 hours'
  AND (SELECT COUNT(*) FROM work_item_acts WHERE work_item_id = wi.id) = 0
  AND wi.created_at < NOW() - INTERVAL '24 hours';
```

### 2. Source Platform Gaps

```sql
-- Expected: CGP has CPNU, CPACA has SAMAI, etc.
SELECT wi.workflow_type, 
  array_agg(DISTINCT wia.source_platform) as sources_present,
  COUNT(DISTINCT wi.id) as item_count
FROM work_items wi
LEFT JOIN work_item_acts wia ON wia.work_item_id = wi.id
WHERE wi.monitoring_enabled = true
GROUP BY wi.workflow_type;
```

---

## Defense-in-Depth Summary

| Layer | What it catches | When it runs |
|-------|----------------|--------------|
| 1. DB triggers | `last_synced_at` lies, deletes during sync | Every write (real-time) |
| 2. App-level invariants | Silent failures, missing provider results | Every sync run |
| 3. Watchdog checks | Freshness vs data consistency, source gaps | Every 10 min |
| 4. Regression tests | Behavioral invariants broken by code changes | Every deploy (CI) |
| 5. Migration checklist | Architectural regressions during refactors | Before every sync change |
