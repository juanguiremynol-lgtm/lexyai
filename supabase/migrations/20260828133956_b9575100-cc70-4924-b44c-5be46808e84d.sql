CREATE OR REPLACE FUNCTION public.atenia_get_missing_sync_items()
 RETURNS TABLE(id uuid, organization_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT wi.id, wi.organization_id
  FROM work_items wi
  WHERE wi.monitoring_enabled = true
    AND wi.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM sync_traces st
      WHERE st.work_item_id = wi.id
        AND st.created_at > now() - interval '24 hours'
    )
  LIMIT 100;
$function$;

CREATE OR REPLACE VIEW public.cpnu_freshness_overview AS
SELECT * FROM (
  SELECT o.* FROM public.cpnu_freshness_overview o
) x WHERE true;
