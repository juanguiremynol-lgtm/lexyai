-- Cron run logging for notification dispatch
CREATE TABLE public.notification_dispatch_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING','SUCCESS','FAILED','NO_ALERTS')),
  trigger_source TEXT NOT NULL DEFAULT 'cron',
  alerts_found INTEGER NOT NULL DEFAULT 0,
  alerts_processed INTEGER NOT NULL DEFAULT 0,
  emails_enqueued INTEGER NOT NULL DEFAULT 0,
  recipients_count INTEGER NOT NULL DEFAULT 0,
  work_items_count INTEGER NOT NULL DEFAULT 0,
  errors JSONB DEFAULT '[]'::jsonb,
  error_summary TEXT,
  duration_ms INTEGER,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- RLS: only service_role and platform admins
ALTER TABLE public.notification_dispatch_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins can read dispatch runs"
  ON public.notification_dispatch_runs
  FOR SELECT
  USING (public.is_platform_admin());

-- Index for recent runs lookup
CREATE INDEX idx_notification_dispatch_runs_started
  ON public.notification_dispatch_runs (started_at DESC);
