# Memory: architecture/auto-sync-governance-login-cap-and-ledger
Updated: now

## Login Sync Cap (3/day per user)

- `auto_sync_login_runs` table tracks per-user, per-org, per-date (America/Bogota) sync counts
- `check_and_increment_login_sync()` DB function provides atomic check+increment for server-side enforcement
- `get_login_sync_status()` DB function provides read-only status check
- `useLoginSync` hook calls server-side check before running batch sync
- Limit: 3 login-triggered syncs per user per calendar day (COT timezone)
- Failed syncs still count toward the limit to prevent abuse
- Client-side sessionStorage provides UX optimization but server enforces the hard limit

## Daily Sync Ledger (Per-Org Idempotency)

- `auto_sync_daily_ledger` table tracks per-org, per-date sync runs
- Status enum: PENDING | RUNNING | SUCCESS | PARTIAL | FAILED
- `acquire_daily_sync_lock()` provides idempotent lock acquisition with stale-lock detection (5 min heartbeat)
- `update_daily_sync_ledger()` updates progress/completion
- `get_pending_daily_syncs()` returns orgs needing retry

## Retry Strategy

- `scheduled-daily-sync` runs at 07:00 COT
- `fallback-sync-check` runs every 2-4 hours to catch failures
- Retry schedule: attempts at 09:00, 11:00, 14:00, 17:00, 20:00 COT
- Max 5 retries per org per day
- Cutoff at 20:00 COT (no retries after)
- Backoff applied based on retry_count
- Provider outage detection: repeated errors increase backoff

## Success Criteria

- SUCCESS: ≥90% of targeted items synced
- PARTIAL: Some items synced but below threshold
- FAILED: Could not start or crashed before meaningful progress
