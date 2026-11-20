-- Detect missing, stale and incomplete daily evidence per enabled provider.
-- Changes the existing invoker body only. No provider requests or case writes.
BEGIN;
DO $change$
DECLARE
  fn regprocedure := 'public.mcp_list_freshness_issues(uuid,integer,uuid)'::regprocedure;
  body text := pg_get_functiondef(fn);
  old_fragment text;
  new_fragment text;
BEGIN
  IF md5(body) = 'f0a71fdfe649cfbfe9096b32a9e1f459' THEN RETURN; END IF;
  IF md5(body) <> '4bd7db655d8b4258749ed903cee3a391' THEN RAISE EXCEPTION 'Unexpected RPC revision: %', md5(body); END IF;
  old_fragment := replace($before$ ), candidates AS ($before$, chr(13), '');
  new_fragment := replace($after$ ), expected_sources AS (
 SELECT e.work_item_id, lower(e.provider_key) AS provider,
        CASE e.scope WHEN 'ACTS' THEN 'acts' WHEN 'PUBS' THEN 'publicaciones' END AS operation
 FROM public.work_item_provider_enrollment e
 JOIN scope s ON s.id=e.work_item_id
 JOIN public.work_items w ON w.id=s.id AND w.organization_id=e.organization_id
 WHERE e.enabled AND w.radicado IS NOT NULL
   AND length(regexp_replace(w.radicado, '[^0-9]', '', 'g'))=23
   AND (w.stage IS NULL OR w.stage NOT IN ('ARCHIVADO','FINALIZADO','EJECUTORIADO','PRECLUIDO_ARCHIVADO','FINALIZADO_ABSUELTO','FINALIZADO_CONDENADO'))
   AND w.workflow_type::text IN ('CGP','EJECUTIVO','LABORAL','PENAL_906','TUTELA','CPACA')
   AND e.provider_key=ANY(public.provider_chain_for_workflow(w.workflow_type::text))
   AND e.scope=public.provider_scope(e.provider_key)
 ), daily_gaps AS (
 SELECT e.work_item_id, e.provider, e.operation, l.id AS timeline_id,
        CASE
          WHEN l.id IS NULL THEN 'DAILY_SOURCE_WITHOUT_INDIVIDUAL_TRACE'
          WHEN l.status IS DISTINCT FROM 'success' OR l.error_code IS NOT NULL
            THEN 'DAILY_SOURCE_CHECK_UNVERIFIED'
          WHEN l.metadata->>'source_complete' IS DISTINCT FROM 'true'
            THEN 'DAILY_SOURCE_INCOMPLETE'
          WHEN obs.ts IS NULL THEN 'DAILY_SOURCE_OBSERVATION_UNVERIFIED'
          WHEN (obs.ts AT TIME ZONE 'America/Bogota')::date <> (now() AT TIME ZONE 'America/Bogota')::date
            OR obs.ts > now() THEN 'DAILY_SOURCE_OBSERVATION_OUTSIDE_TODAY'
          WHEN l.finished_at IS NULL OR l.finished_at < obs.ts OR l.finished_at > now()
            THEN 'DAILY_SOURCE_COMPLETION_UNVERIFIED'
          WHEN e.provider='publicaciones' AND l.metadata#>>'{pp_window,daily_plan_complete}' IS DISTINCT FROM 'true'
            THEN 'DAILY_SOURCE_PLAN_INCOMPLETE'
        END AS reason
 FROM expected_sources e
 LEFT JOIN latest l USING(work_item_id,provider,operation)
 CROSS JOIN LATERAL (SELECT CASE
   WHEN l.metadata->>'source_observed_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}(:[0-9]{2})?)$'
    AND pg_catalog.pg_input_is_valid(l.metadata->>'source_observed_at','timestamp with time zone')
   THEN (l.metadata->>'source_observed_at')::timestamptz END AS ts) obs
 ), candidates AS ($after$, chr(13), '');
  IF strpos(body,old_fragment)=0 THEN RAISE EXCEPTION 'RPC change anchor missing'; END IF;
  body := replace(body,old_fragment,new_fragment);
  old_fragment := replace($before$ (s.monitoring_enabled AND NOT EXISTS(SELECT 1 FROM latest l WHERE l.work_item_id=s.id))$before$, chr(13), '');
  new_fragment := replace($after$ EXISTS (SELECT 1 FROM daily_gaps g WHERE g.work_item_id=s.id AND g.reason IS NOT NULL) OR
 (s.monitoring_enabled AND NOT EXISTS(SELECT 1 FROM latest l WHERE l.work_item_id=s.id))$after$, chr(13), '');
  IF strpos(body,old_fragment)=0 THEN RAISE EXCEPTION 'RPC change anchor missing'; END IF;
  body := replace(body,old_fragment,new_fragment);
  old_fragment := replace($before$ 'sync_checks',COALESCE($before$, chr(13), '');
  new_fragment := replace($after$ 'daily_source_issues',COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'provider',g.provider,'operation',g.operation,'reason',g.reason,'timeline_id',g.timeline_id)
    ORDER BY g.provider,g.operation) FROM daily_gaps g
    WHERE g.work_item_id=p.id AND g.reason IS NOT NULL),'[]'::jsonb),
 'sync_checks',COALESCE($after$, chr(13), '');
  IF strpos(body,old_fragment)=0 THEN RAISE EXCEPTION 'RPC change anchor missing'; END IF;
  body := replace(body,old_fragment,new_fragment);
  EXECUTE body;
  IF md5(pg_get_functiondef(fn)) <> 'f0a71fdfe649cfbfe9096b32a9e1f459'
    OR (SELECT prosecdef FROM pg_proc WHERE oid=fn)
    OR has_function_privilege('anon',fn,'EXECUTE')
    OR NOT has_function_privilege('authenticated',fn,'EXECUTE')
  THEN RAISE EXCEPTION 'RPC integrity or privilege check failed'; END IF;
END;
$change$;
COMMIT;
