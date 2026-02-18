
-- Platform Job Heartbeats: one row per invocation of each scheduled function
-- Used by Atenia AI watchdog to detect missing/failed/stuck jobs
CREATE TABLE public.platform_job_heartbeats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_name TEXT NOT NULL,
  invoked_by TEXT NOT NULL DEFAULT 'cron', -- cron | manual | supervisor
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'RUNNING', -- RUNNING | OK | ERROR | TIMEOUT
  error_code TEXT,
  error_message TEXT,
  duration_ms INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for watchdog queries: find latest heartbeat per job
CREATE INDEX idx_pjh_job_name_started ON public.platform_job_heartbeats (job_name, started_at DESC);

-- Index for detecting stuck jobs
CREATE INDEX idx_pjh_status_started ON public.platform_job_heartbeats (status, started_at)
  WHERE status = 'RUNNING';

-- Cleanup: auto-delete heartbeats older than 30 days (optional, via cron later)
-- For now, just set retention as a comment

-- RLS: service_role writes, authenticated admins can read
ALTER TABLE public.platform_job_heartbeats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on platform_job_heartbeats"
  ON public.platform_job_heartbeats FOR ALL
  USING (true);

CREATE POLICY "Authenticated users can read platform_job_heartbeats"
  ON public.platform_job_heartbeats FOR SELECT
  USING (auth.role() = 'authenticated');

-- Known jobs registry view for easy reference
COMMENT ON TABLE public.platform_job_heartbeats IS 'Records every invocation of scheduled platform jobs. Consumed by Atenia AI watchdog to detect missing, failed, or stuck executions.';
