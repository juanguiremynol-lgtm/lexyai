-- Per-attempt recording table for external_sync_runs observability
-- Each provider call gets its own row, linked to the parent sync run
CREATE TABLE IF NOT EXISTS public.external_sync_run_attempts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sync_run_id UUID NOT NULL REFERENCES public.external_sync_runs(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  data_kind TEXT NOT NULL CHECK (data_kind IN ('ACTUACIONES', 'ESTADOS')),
  role TEXT NOT NULL CHECK (role IN ('PRIMARY', 'FALLBACK')),
  status TEXT NOT NULL CHECK (status IN ('success', 'not_found', 'empty', 'error', 'timeout', 'skipped')),
  http_code INTEGER,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  recorded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index for querying attempts by run
CREATE INDEX idx_ext_sync_run_attempts_run ON public.external_sync_run_attempts(sync_run_id);

-- Index for provider health aggregation (platform ops)
CREATE INDEX idx_ext_sync_run_attempts_provider ON public.external_sync_run_attempts(provider, status, recorded_at);

-- Enable RLS
ALTER TABLE public.external_sync_run_attempts ENABLE ROW LEVEL SECURITY;

-- RLS: Only service_role can write (edge functions)
-- Read: Users can read attempts for sync runs they can see (via join to external_sync_runs → work_items)
CREATE POLICY "Service role full access on sync run attempts"
  ON public.external_sync_run_attempts
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Comment for documentation
COMMENT ON TABLE public.external_sync_run_attempts IS 'Per-provider attempt records within a sync run. Used for observability and provider health aggregation.';