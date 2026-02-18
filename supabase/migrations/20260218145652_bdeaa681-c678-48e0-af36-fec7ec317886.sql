
-- ============================================================
-- external_sync_runs: Per-invocation summary for sync operations
-- Records each time sync is invoked for a work item, which providers
-- were called, outcomes, and timing.
-- ============================================================

CREATE TABLE public.external_sync_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  work_item_id UUID NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES public.organizations(id),
  
  -- Invocation context
  invoked_by TEXT NOT NULL CHECK (invoked_by IN ('DEMO', 'WIZARD', 'CRON', 'MANUAL', 'RETRY', 'HEARTBEAT', 'E2E_TEST', 'GHOST_VERIFY')),
  trigger_source TEXT, -- e.g. 'scheduled-daily-sync', 'sync-by-radicado', 'sync-by-work-item'
  
  -- Timing
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  
  -- Overall result
  status TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED', 'TIMEOUT')),
  
  -- Provider attempts (JSONB array of per-provider results)
  -- Each entry: { provider, data_kind, status, http_code, latency_ms, error_code, inserted_count, skipped_count }
  provider_attempts JSONB NOT NULL DEFAULT '[]'::jsonb,
  
  -- Aggregate counts
  total_inserted_acts INTEGER NOT NULL DEFAULT 0,
  total_skipped_acts INTEGER NOT NULL DEFAULT 0,
  total_inserted_pubs INTEGER NOT NULL DEFAULT 0,
  total_skipped_pubs INTEGER NOT NULL DEFAULT 0,
  
  -- Error info
  error_code TEXT,
  error_message TEXT,
  
  -- Retry tracking
  retry_count INTEGER NOT NULL DEFAULT 0,
  
  -- Response fingerprint (hash of combined results for change detection)
  response_hash TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common query patterns
CREATE INDEX idx_external_sync_runs_work_item ON public.external_sync_runs(work_item_id);
CREATE INDEX idx_external_sync_runs_org ON public.external_sync_runs(organization_id);
CREATE INDEX idx_external_sync_runs_started ON public.external_sync_runs(started_at DESC);
CREATE INDEX idx_external_sync_runs_status ON public.external_sync_runs(status);
CREATE INDEX idx_external_sync_runs_invoked_by ON public.external_sync_runs(invoked_by);

-- Composite index for "latest sync per work item"
CREATE INDEX idx_external_sync_runs_wi_latest ON public.external_sync_runs(work_item_id, started_at DESC);

-- Enable RLS
ALTER TABLE public.external_sync_runs ENABLE ROW LEVEL SECURITY;

-- RLS: Users can view sync runs for their own work items
CREATE POLICY "Users can view sync runs for their work items"
ON public.external_sync_runs
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.work_items wi
    WHERE wi.id = external_sync_runs.work_item_id
    AND wi.owner_id = auth.uid()
  )
);

-- RLS: Service role can insert/update (edge functions)
CREATE POLICY "Service role can manage sync runs"
ON public.external_sync_runs
FOR ALL
USING (
  (current_setting('request.jwt.claim.role', true)) = 'service_role'
)
WITH CHECK (
  (current_setting('request.jwt.claim.role', true)) = 'service_role'
);

-- Auto-cleanup: keep only last 90 days of sync runs (via scheduled job)
COMMENT ON TABLE public.external_sync_runs IS 'Per-invocation sync summary. Providers attempted, outcomes, timing. Auto-pruned after 90 days.';
