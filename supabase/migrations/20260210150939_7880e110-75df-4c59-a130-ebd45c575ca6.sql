-- Add claimed_at column for concurrency safety in process-retry-queue
ALTER TABLE public.sync_retry_queue
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz DEFAULT NULL;

-- Add index for efficient zombie detection
CREATE INDEX IF NOT EXISTS idx_sync_retry_queue_zombie
  ON public.sync_retry_queue (next_run_at, attempt, max_attempts)
  WHERE claimed_at IS NOT NULL;