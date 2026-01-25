-- Add metadata column to job_runs if it doesn't exist
-- This ensures the platform_verification_snapshot RPC works correctly

ALTER TABLE public.job_runs
ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.job_runs.metadata IS 'Optional job metadata (e.g. preview mode flag)';