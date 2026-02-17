-- Fix B: Add structured failure fields to E2E test results
ALTER TABLE public.atenia_e2e_test_results
  ADD COLUMN IF NOT EXISTS failure_stage text,
  ADD COLUMN IF NOT EXISTS failure_summary text;

-- Note: failure_reason column already exists in the table

-- Fix E: Add lease_heartbeat_at to remediation queue for liveness tracking
ALTER TABLE public.atenia_ai_remediation_queue
  ADD COLUMN IF NOT EXISTS lease_heartbeat_at timestamptz;

-- Create index for stale RUNNING remediation items
CREATE INDEX IF NOT EXISTS idx_remediation_queue_stale_running
  ON public.atenia_ai_remediation_queue (status, updated_at)
  WHERE status = 'RUNNING';

-- Create index for stale RUNNING deep dives (Fix D)
CREATE INDEX IF NOT EXISTS idx_deep_dives_running_ttl
  ON public.atenia_deep_dives (status, started_at)
  WHERE status = 'RUNNING';