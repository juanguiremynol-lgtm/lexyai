
-- ============= SYNC RETRY QUEUE =============
CREATE TABLE IF NOT EXISTS public.sync_retry_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  radicado text NOT NULL,
  workflow_type text NOT NULL,
  stage text,
  kind text NOT NULL CHECK (kind IN ('ACT_SCRAPE_RETRY', 'PUB_RETRY')),
  provider text NOT NULL,
  attempt int NOT NULL DEFAULT 1,
  max_attempts int NOT NULL DEFAULT 3,
  next_run_at timestamptz NOT NULL,
  last_error_code text,
  last_error_message text,
  scraping_job_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_item_id, kind)
);

-- Index for the retry worker to find due items efficiently
CREATE INDEX IF NOT EXISTS idx_sync_retry_queue_next_run 
  ON public.sync_retry_queue (next_run_at);

CREATE INDEX IF NOT EXISTS idx_sync_retry_queue_work_item 
  ON public.sync_retry_queue (work_item_id);

ALTER TABLE public.sync_retry_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to sync_retry_queue"
  ON public.sync_retry_queue
  FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE TRIGGER update_sync_retry_queue_updated_at
  BEFORE UPDATE ON public.sync_retry_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
