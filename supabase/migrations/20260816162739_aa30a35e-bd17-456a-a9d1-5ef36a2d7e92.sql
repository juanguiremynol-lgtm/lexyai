
CREATE OR REPLACE FUNCTION public.portfolio_silent_success(p_days int DEFAULT 30)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH live AS (
    SELECT w.id, w.radicado, w.authority_name, w.workflow_type::text AS workflow_type,
           w.organization_id, w.last_synced_at,
           (SELECT max(COALESCE(a.act_date,a.event_date)) FROM public.work_item_acts a
             WHERE a.work_item_id=w.id AND a.is_archived IS NOT TRUE) AS last_act,
           (SELECT max(COALESCE(p.fecha_fijacion::date,p.published_at::date)) FROM public.work_item_publicaciones p
             WHERE p.work_item_id=w.id AND p.is_archived IS NOT TRUE) AS last_pub
      FROM public.work_items w
     WHERE COALESCE(w.lifecycle_state::text,'ACTIVE')='ACTIVE'
       AND w.deleted_at IS NULL
       AND w.monitoring_enabled IS TRUE
       AND w.radicado IS NOT NULL
       AND w.last_synced_at > now() - interval '48 hours'
  ), silent AS (
    SELECT *, GREATEST(COALESCE(last_act,'1900-01-01'::date), COALESCE(last_pub,'1900-01-01'::date)) AS last_movement
      FROM live
  )
  SELECT jsonb_build_object(
    'threshold_days', p_days,
    'count', count(*),
    'items', COALESCE(jsonb_agg(jsonb_build_object(
        'work_item_id', id, 'radicado', radicado, 'despacho', authority_name,
        'workflow_type', workflow_type, 'organization_id', organization_id,
        'last_synced_at', last_synced_at, 'last_movement', last_movement,
        'dias_sin_movimiento', (CURRENT_DATE - last_movement))
      ORDER BY last_movement) FILTER (WHERE true), '[]'::jsonb),
    'computed_at', now())
  FROM silent
  WHERE (CURRENT_DATE - last_movement) >= p_days;
$$;

GRANT EXECUTE ON FUNCTION public.portfolio_silent_success(int) TO authenticated, service_role;
