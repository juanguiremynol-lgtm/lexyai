
-- Fix security definer view: recreate with SECURITY INVOKER
CREATE OR REPLACE VIEW public.cpnu_freshness_overview 
WITH (security_invoker = true) AS
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
