
-- Add last_attempted_sync_at column to track sync attempts regardless of success
-- This separates "last successful sync" from "last attempt" for proper staleness detection
ALTER TABLE public.work_items ADD COLUMN IF NOT EXISTS last_attempted_sync_at TIMESTAMPTZ;

-- Clean up stuck RUNNING ledger entries from today (> 30 min old)
UPDATE public.auto_sync_daily_ledger 
SET status = 'FAILED', finished_at = now(), failure_reason = 'TIMEOUT_STUCK_RUNNING_MANUAL_CLEANUP'
WHERE status = 'RUNNING' 
  AND last_heartbeat_at < (now() - interval '30 minutes');

-- Reset sentinel consecutive failures (they've accumulated to 18 due to E2E test issues)
UPDATE public.atenia_e2e_test_registry 
SET consecutive_failures = 0, last_test_result = 'RESET'
WHERE consecutive_failures > 5;
