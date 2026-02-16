# Memory: architecture/daily-ops-report-system
Updated: now

## Atenia Daily Ops Report System

### Components
- **Edge Function**: `atenia-daily-report` — orchestrates 14 diagnostic tools, generates structured TXT
- **DB Table**: `atenia_daily_ops_reports` (report_date, run_id, status, txt_content, txt_storage_path, txt_sha256, summary_json, raw_run_metadata_json)
- **Storage Bucket**: `atenia-daily-reports` (private, platform admin only)
- **Cron**: `atenia-daily-ops-report` at 08:30 COT (13:30 UTC)
- **UI Page**: `/platform/daily-ops-reports` — Super Admin report viewer with download

### Tool Registry (14 tools)
1. HEALTH_SNAPSHOT — daily_sync_health_snapshot(7d)
2. KPI_REPORT — latest DAILY_SYNC_KPI_REPORT from atenia_ai_actions
3. PER_ORG_KPIS — per-org ledger aggregation
4. PROVIDER_STATUS — provider trace analysis
5. REMEDIATION_QUEUE — pending/running/failed queue items
6. DEAD_LETTER_SUMMARY — dead-lettered items
7. CRON_WATCHDOG — recent cron runs + scheduled tasks
8. PREFLIGHT_CHECKS — recent preflight results
9. DEEP_DIVES — today's deep dives
10. E2E_TESTS — today's E2E test results
11. OBSERVATIONS — today's observations by severity
12. INCIDENTS — open incidents
13. RECENT_ACTIONS — today's AI actions by type
14. WORK_ITEM_FRESHNESS — stale items (>24h)

### TXT Format (6 sections)
1. EXECUTIVE SUMMARY — key metrics and alerts
2. PLATFORM KPI REPORT — raw evidence from DAILY_SYNC_KPI_REPORT
3. PER-ORG KPI TABLE — tabular per-org breakdown
4. TOOL RUN MANIFEST — each tool with raw output blocks
5. CRON / WATCHDOG / HEARTBEAT STATUS — cron runs + scheduled tasks
6. ERRORS / ANOMALIES — aggregated warnings

### Idempotency
- One SUCCESS report per date (partial unique index)
- `force: true` parameter overrides skip logic
- Each tool logs its own `DAILY_REPORT_TOOL_*` action in atenia_ai_actions
- Master report logs `DAILY_OPS_REPORT` action with manifest

### Access
- RLS: platform admins only (is_platform_admin())
- Storage: private bucket, platform admin read policy
