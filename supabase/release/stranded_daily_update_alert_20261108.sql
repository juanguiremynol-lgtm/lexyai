-- Alert on a daily admission without a terminal result. This detector does
-- not release the admission, alter a matter, retry a provider or certify data.
BEGIN;
DO $check$
BEGIN
  IF to_regprocedure('public.alert_stranded_daily_updates_20261108()') IS NOT NULL
    OR EXISTS(SELECT 1 FROM cron.job WHERE jobname='andromeda-stranded-update-watchdog-v1') THEN
    RAISE EXCEPTION 'watchdog release name already exists';
  END IF;
END
$check$;
CREATE FUNCTION public.alert_stranded_daily_updates_20261108()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE v_inserted integer;
BEGIN
  IF NOT pg_try_advisory_xact_lock(184257,281108) THEN RETURN 0; END IF;
  INSERT INTO public.system_health_events(organization_id,service,status,message,metadata)
  SELECT c.organization_id,'DAILY_UPDATE_WATCHDOG','WARN',
    CASE WHEN x.channel='acts' THEN
      'La consulta de actuaciones lleva más de 30 minutos sin resultado final registrado. La actualización no está acreditada; revise el intento.'
    ELSE
      'La consulta de estados lleva más de 30 minutos sin resultado final registrado. La actualización no está acreditada; revise el intento.' END,
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
REVOKE ALL ON FUNCTION public.alert_stranded_daily_updates_20261108() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.alert_stranded_daily_updates_20261108() TO service_role;
SELECT cron.schedule('andromeda-stranded-update-watchdog-v1','*/15 * * * *',
  'SELECT public.alert_stranded_daily_updates_20261108()');
COMMIT;
