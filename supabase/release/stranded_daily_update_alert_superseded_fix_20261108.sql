-- Replace only the watchdog function; the existing schedule remains active.
BEGIN;
CREATE OR REPLACE FUNCTION public.alert_stranded_daily_updates_20261108()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE v_inserted integer;
BEGIN
  IF NOT pg_try_advisory_xact_lock(184257,281108) THEN RETURN 0; END IF;
  -- Resolve existing warnings only with a later certified observation of the
  -- same channel and applicable provider. Preserve the original warning.
  WITH recovered AS (
    SELECT DISTINCT ON(e.id) e.id,t.id AS timeline_id,t.metadata->>'source_observed_at' AS observed_at
    FROM public.system_health_events e
    JOIN public.work_items w ON w.id::text=e.metadata->>'work_item_id'
      AND w.organization_id=e.organization_id
    CROSS JOIN LATERAL (SELECT CASE
      WHEN pg_input_is_valid(e.metadata->>'reference_time','timestamp with time zone')
      THEN (e.metadata->>'reference_time')::timestamptz ELSE NULL END AS reference_time) ref
    JOIN public.work_item_sync_timeline t ON t.work_item_id=w.id AND t.organization_id=e.organization_id
      AND t.operation=CASE WHEN e.metadata->>'channel'='acts' THEN 'acts' ELSE 'publicaciones' END
      AND lower(t.provider)=CASE WHEN e.metadata->>'channel'='acts' THEN
        CASE WHEN w.workflow_type::text='CPACA' THEN 'samai' ELSE 'cpnu' END
        ELSE CASE WHEN w.workflow_type::text='CPACA' THEN 'samai_estados' ELSE 'publicaciones' END END
      AND t.status='success' AND t.error_code IS NULL AND t.metadata->>'source_complete'='true'
      AND t.finished_at>ref.reference_time
      AND CASE WHEN pg_input_is_valid(t.metadata->>'source_observed_at','timestamp with time zone')
        THEN (t.metadata->>'source_observed_at')::timestamptz>ref.reference_time ELSE false END
    WHERE e.service='DAILY_UPDATE_WATCHDOG' AND e.status='WARN'
      AND e.metadata->>'kind'='DAILY_UPDATE_WITHOUT_TERMINAL_RESULT'
      -- Publicaciones needs the full daily-plan certificate, which is not
      -- carried by this timeline. Never auto-resolve that channel from it.
      AND e.metadata->>'channel'='acts' AND ref.reference_time IS NOT NULL
    ORDER BY e.id,t.finished_at DESC
  )
  UPDATE public.system_health_events e SET status='OK',
    message='El intento histórico no registró cierre; una observación posterior completa del proveedor acredita la lectura posterior.',
    metadata=e.metadata||jsonb_build_object('original_status',e.status,'original_message',e.message,
      'resolution','LATER_CERTIFIED_SOURCE_OBSERVATION','resolution_recorded_at',now(),
      'resolution_timeline_id',r.timeline_id,'resolution_source_observed_at',r.observed_at)
  FROM recovered r WHERE e.id=r.id;
  INSERT INTO public.system_health_events(organization_id,service,status,message,metadata)
  SELECT c.organization_id,'DAILY_UPDATE_WATCHDOG','WARN',
    CASE WHEN x.channel='acts' THEN
      'La consulta de actuaciones del '||c.run_date::text||' lleva más de 30 minutos sin resultado final. Ese intento no acredita la actualización; revise también las consultas posteriores.'
    ELSE
      'La consulta de estados del '||c.run_date::text||' lleva más de 30 minutos sin resultado final. Ese intento no acredita la actualización; revise también las consultas posteriores.' END,
    jsonb_build_object('kind','DAILY_UPDATE_WITHOUT_TERMINAL_RESULT',
      'work_item_id',c.work_item_id,'channel',x.channel,'run_date',c.run_date,
      'started_at',s.started_at,'reference_time',coalesce(s.started_at,c.updated_at),
      'reference_kind',CASE WHEN s.started_at IS NULL THEN 'last_update' ELSE 'started_at' END,
      'trace_id',x.value->>'trace_id')
  FROM public.daily_update_cycles c
  JOIN public.work_items w ON w.id=c.work_item_id
  CROSS JOIN LATERAL jsonb_each(c.channels) AS x(channel,value)
  CROSS JOIN LATERAL (SELECT CASE
    WHEN pg_input_is_valid(x.value->>'started_at','timestamp with time zone')
    THEN (x.value->>'started_at')::timestamptz ELSE NULL END AS started_at) s
  WHERE c.run_date BETWEEN (now() AT TIME ZONE 'America/Bogota')::date-2
      AND (now() AT TIME ZONE 'America/Bogota')::date
    AND c.organization_id IS NOT NULL AND w.deleted_at IS NULL
    AND w.lifecycle_state='ACTIVE' AND w.monitoring_enabled IS TRUE
    AND x.channel IN ('acts','pubs') AND x.value->>'status'='STARTED'
    AND coalesce(s.started_at,c.updated_at)<now()-interval '30 minutes'
    -- A later complete observation by the applicable source supersedes the
    -- historical open attempt. A generic timestamp or another channel cannot.
    AND NOT EXISTS (SELECT 1 FROM public.work_item_sync_timeline t
      WHERE t.work_item_id=c.work_item_id
        AND x.channel='acts'
        AND t.operation=CASE WHEN x.channel='acts' THEN 'acts' ELSE 'publicaciones' END
        AND lower(t.provider)=CASE WHEN x.channel='acts' THEN
          CASE WHEN w.workflow_type::text='CPACA' THEN 'samai' ELSE 'cpnu' END
          ELSE CASE WHEN w.workflow_type::text='CPACA' THEN 'samai_estados' ELSE 'publicaciones' END END
        AND t.status='success' AND t.error_code IS NULL AND t.metadata->>'source_complete'='true'
        AND t.finished_at>coalesce(s.started_at,c.updated_at)
        AND CASE WHEN pg_input_is_valid(t.metadata->>'source_observed_at','timestamp with time zone')
          THEN (t.metadata->>'source_observed_at')::timestamptz>coalesce(s.started_at,c.updated_at)
          ELSE false END)
    AND NOT EXISTS (SELECT 1 FROM public.system_health_events e
      WHERE e.service='DAILY_UPDATE_WATCHDOG' AND e.status='WARN'
        AND e.created_at>=now()-interval '4 days'
        AND e.metadata->>'kind'='DAILY_UPDATE_WITHOUT_TERMINAL_RESULT'
        AND e.metadata->>'work_item_id'=c.work_item_id::text
        AND e.metadata->>'channel'=x.channel AND e.metadata->>'run_date'=c.run_date::text
        AND coalesce(e.metadata->>'trace_id','')=coalesce(x.value->>'trace_id',''));
  GET DIAGNOSTICS v_inserted=ROW_COUNT;
  RETURN v_inserted;
END
$fn$;
COMMIT;

