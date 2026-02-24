
-- Add CPNU refresh cadence fields to work_items
ALTER TABLE public.work_items 
  ADD COLUMN IF NOT EXISTS last_cpnu_buscar_at timestamptz,
  ADD COLUMN IF NOT EXISTS needs_cpnu_refresh boolean NOT NULL DEFAULT false;

-- Add ingestion metadata fields to external_sync_runs
ALTER TABLE public.external_sync_runs 
  ADD COLUMN IF NOT EXISTS cpnu_source_mode text,
  ADD COLUMN IF NOT EXISTS cpnu_snapshot_max_date date,
  ADD COLUMN IF NOT EXISTS cpnu_force_refresh boolean DEFAULT false;

-- Create index for needs_cpnu_refresh for cron queries
CREATE INDEX IF NOT EXISTS idx_work_items_needs_cpnu_refresh 
  ON public.work_items (needs_cpnu_refresh) 
  WHERE needs_cpnu_refresh = true;

-- Create CPNU freshness monitoring view for admin panel
CREATE OR REPLACE VIEW public.cpnu_freshness_overview AS
SELECT 
  wi.id AS work_item_id,
  wi.radicado,
  wi.organization_id,
  wi.workflow_type,
  wi.needs_cpnu_refresh,
  wi.last_cpnu_buscar_at,
  wi.last_crawled_at,
  (SELECT MAX(wia.act_date::date) FROM work_item_acts wia WHERE wia.work_item_id = wi.id AND wia.is_archived = false) AS db_max_act_date,
  esr.cpnu_source_mode AS last_source_mode,
  esr.cpnu_snapshot_max_date AS last_snapshot_max_date,
  esr.started_at AS last_sync_at,
  esr.status AS last_sync_status
FROM work_items wi
LEFT JOIN LATERAL (
  SELECT cpnu_source_mode, cpnu_snapshot_max_date, started_at, status
  FROM external_sync_runs
  WHERE work_item_id = wi.id
  ORDER BY started_at DESC
  LIMIT 1
) esr ON true
WHERE wi.monitoring_enabled = true;
