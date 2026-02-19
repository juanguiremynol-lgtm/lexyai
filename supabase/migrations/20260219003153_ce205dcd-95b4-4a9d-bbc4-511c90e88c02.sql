-- Composite index for efficient UI polling by chain_id + org grouping
CREATE INDEX IF NOT EXISTS idx_daily_ledger_chain_org_created 
  ON public.auto_sync_daily_ledger (chain_id, organization_id, created_at DESC) 
  WHERE chain_id IS NOT NULL;