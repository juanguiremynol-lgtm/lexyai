# Memory: architecture/daily-sync-health-snapshot-and-runbook
Updated: now

## Consolidated Health Snapshot

- DB function `daily_sync_health_snapshot(p_days, p_target_date)` returns a single JSON with:
  - `platform_summary`: per-day metrics (orgs_seen, pct_fully_synced, p95_convergence_min, avg_chain_length, total_dead_lettered, total_timeouts, orgs_long_chains, p95_first_sync_min_after_midnight)
  - `problem_orgs_today`: list of orgs with issues (not fully synced, skipped > 0, dead letters, timeouts, chain_length >= 8)

## Wiring

- `atenia-ai-supervisor` calls the RPC in POST_DAILY_SYNC and MANUAL_AUDIT modes
- Full snapshot is persisted in `atenia_ai_actions` evidence under `DAILY_SYNC_KPI_REPORT`
- Response includes `health_snapshot` field alongside `platform_sync_kpis`

## Operational Runbook

### Daily (first week)
- 7:20–7:40 AM COT: check health snapshot for today
- Verify: most orgs started, no total_skipped > 0 after chain ends, dead-letter not climbing, no_progress = 0

### Weekly
- Review p95 time-to-first-sync and p95 convergence_time
- Review top dead-lettered items/providers
- If thresholds breached 3–5 consecutive days → trigger Phase 2

### Alert Thresholds (~100 tenants)
- total_skipped > 0 after chain ends → data freshness breach
- convergence_minutes > 60 → outgrowing sequential processing
- chain_length consistently >= 8 → page size too small or item latency too high
- dead_letter_count > 0 for 2+ consecutive days → persistent integration failure

### Phase 2 Gate (trigger when observed 3–5 days):
- p95 time-to-first-sync > 45–60 min
- p95 convergence > 90 min
- Repeated lock conflicts / MAX_CONTINUATIONS
- Provider 429 rate limiting

### Query for historical reports
```sql
SELECT summary, evidence->'health_snapshot' AS snapshot
FROM atenia_ai_actions
WHERE action_type = 'DAILY_SYNC_KPI_REPORT'
ORDER BY created_at DESC LIMIT 7;
```
