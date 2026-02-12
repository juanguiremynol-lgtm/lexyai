
-- Add new tracking columns to auto_sync_daily_ledger (idempotent)
ALTER TABLE public.auto_sync_daily_ledger ADD COLUMN IF NOT EXISTS expected_total_items int DEFAULT 0;
ALTER TABLE public.auto_sync_daily_ledger ADD COLUMN IF NOT EXISTS cursor_last_work_item_id uuid NULL;
ALTER TABLE public.auto_sync_daily_ledger ADD COLUMN IF NOT EXISTS failure_reason text NULL;
ALTER TABLE public.auto_sync_daily_ledger ADD COLUMN IF NOT EXISTS items_skipped int DEFAULT 0;
ALTER TABLE public.auto_sync_daily_ledger ADD COLUMN IF NOT EXISTS error_summary jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.auto_sync_daily_ledger ADD COLUMN IF NOT EXISTS finished_at timestamptz NULL;
