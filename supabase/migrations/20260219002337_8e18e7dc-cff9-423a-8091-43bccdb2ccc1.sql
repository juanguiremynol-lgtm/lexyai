-- Add trigger_source and manual_initiator_user_id to auto_sync_daily_ledger
-- These support distinguishing CRON vs MANUAL runs and auditing who triggered manual syncs

ALTER TABLE public.auto_sync_daily_ledger 
  ADD COLUMN IF NOT EXISTS trigger_source TEXT NOT NULL DEFAULT 'CRON';

ALTER TABLE public.auto_sync_daily_ledger 
  ADD COLUMN IF NOT EXISTS manual_initiator_user_id UUID NULL;

-- Add index for efficient chain_id polling (used by UI to track global manual runs)
CREATE INDEX IF NOT EXISTS idx_daily_ledger_chain_id 
  ON public.auto_sync_daily_ledger (chain_id) 
  WHERE chain_id IS NOT NULL;