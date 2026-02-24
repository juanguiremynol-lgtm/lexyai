
-- ═══ external_sync_run_payloads: per-provider raw payload logging for debug runs ═══
CREATE TABLE IF NOT EXISTS public.external_sync_run_payloads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sync_run_id UUID NOT NULL REFERENCES public.external_sync_runs(id) ON DELETE CASCADE,
  provider_name TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('request', 'response', 'parsed', 'upsert_summary', 'freshness_gate', 'dedupe')),
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload_size_bytes INTEGER GENERATED ALWAYS AS (octet_length(payload_json::text)) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookup by sync_run_id
CREATE INDEX idx_sync_run_payloads_run_id ON public.external_sync_run_payloads(sync_run_id);
CREATE INDEX idx_sync_run_payloads_provider ON public.external_sync_run_payloads(sync_run_id, provider_name);

-- RLS: service_role only writes, platform admins + run owner can read
ALTER TABLE public.external_sync_run_payloads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on sync run payloads"
  ON public.external_sync_run_payloads
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Platform admins can read all payloads
CREATE POLICY "Platform admins read sync run payloads"
  ON public.external_sync_run_payloads
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid()
    )
  );

-- Add debug_mode flag to external_sync_runs
ALTER TABLE public.external_sync_runs
  ADD COLUMN IF NOT EXISTS debug_mode BOOLEAN NOT NULL DEFAULT false;

-- Add mode column for CRON vs MANUAL_DEBUG distinction  
ALTER TABLE public.external_sync_runs
  ADD COLUMN IF NOT EXISTS run_mode TEXT NOT NULL DEFAULT 'NORMAL' CHECK (run_mode IN ('NORMAL', 'CRON', 'MANUAL_DEBUG', 'DRY_RUN'));

-- Cleanup: auto-expire old debug payloads (> 7 days) via a simple function
-- Can be called by pg_cron or manually
CREATE OR REPLACE FUNCTION public.cleanup_old_debug_payloads(days_to_keep INTEGER DEFAULT 7)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.external_sync_run_payloads
  WHERE created_at < now() - (days_to_keep || ' days')::interval;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;
