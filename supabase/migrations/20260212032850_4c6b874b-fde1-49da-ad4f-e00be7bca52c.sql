
-- Function to get monitored work items missing sync in last 24h
CREATE OR REPLACE FUNCTION public.atenia_get_missing_sync_items()
RETURNS TABLE (id uuid, organization_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT wi.id, wi.organization_id
  FROM work_items wi
  WHERE wi.monitoring_enabled = true
    AND NOT EXISTS (
      SELECT 1 FROM sync_traces st
      WHERE st.work_item_id = wi.id
        AND st.created_at > now() - interval '24 hours'
    )
  LIMIT 100;
$$;
