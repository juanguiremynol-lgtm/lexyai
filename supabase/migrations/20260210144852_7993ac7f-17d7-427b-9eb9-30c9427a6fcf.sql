
-- Add consecutive_failures counter to work_items for general failure tracking
-- (consecutive_404_count already exists for 404-specific tracking)
ALTER TABLE public.work_items ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0;

-- Add last_error_code to work_items for quick diagnosis without checking sync_traces
ALTER TABLE public.work_items ADD COLUMN IF NOT EXISTS last_error_code text;

-- Add last_error_at timestamp
ALTER TABLE public.work_items ADD COLUMN IF NOT EXISTS last_error_at timestamptz;

-- Index for ghost item detection: monitored items that haven't been synced recently
CREATE INDEX IF NOT EXISTS idx_work_items_ghost_detection 
  ON public.work_items (organization_id, monitoring_enabled, last_synced_at)
  WHERE monitoring_enabled = true;

-- Index for at-risk items (consecutive failures)
CREATE INDEX IF NOT EXISTS idx_work_items_consecutive_failures
  ON public.work_items (consecutive_failures)
  WHERE consecutive_failures > 0;
