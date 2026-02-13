# Memory: architecture/auto-sync-governance-login-cap-and-ledger
Updated: now

## Sync Governance Policy (CURRENT)

- **Login sync DISMANTLED** — `useLoginSync` hook removed from TenantLayout
- User-triggered syncs (AddRadicadoInline, WorkItemMonitoringBadge) removed
- Work items sync ONLY via:
  1. Daily cron job (`scheduled-daily-sync` at 07:00 COT)
  2. Super-admin sync buttons (SuperAdminToolbar → Master Sync)
  3. Atenia AI autonomous capabilities (heartbeat, supervisor, remediation queue)
- No regular user or org admin can trigger manual sync of work items

## Login Sync Cap (DEPRECATED — DISMANTLED)

- `auto_sync_login_runs` table still exists but is no longer written to
- `check_and_increment_login_sync()` / `get_login_sync_status()` DB functions remain but are unused
- `login-sync-service.ts` and `useLoginSync.ts` are dead code (kept for reference)

## Daily Sync Ledger (Per-Org Idempotency)

- `auto_sync_daily_ledger` table tracks per-org, per-date sync runs
- Status enum: PENDING | RUNNING | SUCCESS | PARTIAL | FAILED
- `acquire_daily_sync_lock()` provides idempotent lock acquisition with stale-lock detection (5 min heartbeat)
- `update_daily_sync_ledger()` updates progress/completion
- `get_pending_daily_syncs()` returns orgs needing retry

## Cron Assurance Layer (Watchdog Gates)

- **Gate A**: Daily Enqueue proof for Bogotá day
- **Gate B**: Watchdog liveness (OK in last 15 min)
- **Gate C**: Sync Coverage (≥80% in 24h)
- **Gate D**: Queue Boundedness (≤500 pending tasks)
- **Gate E**: Stuck convergence (SCRAPING_PENDING > 30min)
- **Gate F**: Heartbeat liveness (OK in last 35 min)
- **Gate G**: Per-Org Daily Sync Verification (after 12:00 COT, every active org must have ledger entry)
- **Gate H**: Work Item Freshness Audit (items stale > 48h trigger remediation)
- Edge Function liveness probing for critical functions

## Retry Strategy

- `scheduled-daily-sync` runs at 07:00 COT
- `fallback-sync-check` runs every 2-4 hours to catch failures
- `atenia-cron-watchdog` runs every 10 min for self-healing
- Max 5 retries per org per day
- Cutoff at 20:00 COT (no retries after)

## Success Criteria

- SUCCESS: ≥90% of targeted items synced
- PARTIAL: Some items synced but below threshold
- FAILED: Could not start or crashed before meaningful progress
