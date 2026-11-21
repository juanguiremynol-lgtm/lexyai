BEGIN;

SET LOCAL lock_timeout = '3s';

DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname='andromeda-daily-sync-after-restart' AND active
      AND btrim(command)='SELECT public.recover_daily_sync_after_restart_20261121(false);'
  ) OR to_regclass('public.guarded_acts_queue_audit_20261108') IS NULL
    OR strpos(pg_get_functiondef('public._admit_daily_update_at(date,uuid,text,text,text,text)'::regprocedure),
      'DAILY_ADMISSION_STALE_RECOVERED')=0 THEN
    RAISE EXCEPTION 'Missing guarded daily admissions or continuation recovery';
  END IF;
END
$guard$;

-- The ordinary ACT retry reaches the existing fenced stale admission handler.
-- A closed admission can only reuse an independently certified stored feed.
CREATE FUNCTION public.enqueue_stale_started_acts_20261121(_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_day date := (now() AT TIME ZONE 'America/Bogota')::date;
  v_used integer;
  v_examined integer := 0;
  v_added integer := 0;
  v_queue_id uuid;
  item record;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('guarded-missing-acts-20261108',0)) THEN
    RETURN jsonb_build_object('state','busy','added',0);
  END IF;
  SELECT count(*) INTO v_used FROM public.guarded_acts_queue_audit_20261108 WHERE run_date=v_day;

  FOR item IN
    SELECT w.id, w.organization_id, w.radicado, w.stage, w.workflow_type::text workflow
    FROM public.daily_update_cycles d JOIN public.work_items w ON w.id=d.work_item_id
      AND w.organization_id=d.organization_id
    WHERE d.run_date=v_day AND d.channels->'acts'->>'status'='STARTED'
      AND CASE WHEN pg_input_is_valid(d.channels->'acts'->>'started_at','timestamp with time zone')
        THEN (d.channels->'acts'->>'started_at')::timestamptz < now()-interval '15 minutes'
        ELSE false END
      AND w.lifecycle_state::text='ACTIVE' AND w.deleted_at IS NULL
      AND w.monitoring_enabled AND w.scraping_enabled AND w.owner_id=d.owner_id
      AND coalesce(w.scrape_status::text,'')<>'IN_PROGRESS'
      AND length(regexp_replace(coalesce(w.radicado,''),'[^0-9]','','g'))=23
      AND w.workflow_type::text IN ('CGP','LABORAL','CPACA','PENAL_906','EJECUTIVO','TUTELA')
      AND (w.stage IS NULL OR w.stage NOT IN ('ARCHIVADO','FINALIZADO','EJECUTORIADO',
        'PRECLUIDO_ARCHIVADO','FINALIZADO_ABSUELTO','FINALIZADO_CONDENADO'))
      AND NOT EXISTS (SELECT 1 FROM public.sync_retry_queue q WHERE q.work_item_id=w.id AND q.kind='ACT_SCRAPE_RETRY')
      AND NOT EXISTS (SELECT 1 FROM public.guarded_acts_queue_audit_20261108 a
        WHERE a.work_item_id=w.id AND a.run_date=v_day)
      AND coalesce(d.channels->'acts'->>'error_code','') NOT IN
        ('PROCESO_PRIVADO','PROVIDER_NOT_FOUND','PROVIDER_UNRESOLVED')
    ORDER BY d.channels->'acts'->>'started_at', w.id
    LIMIT greatest(0,least(5,10-v_used))
    FOR UPDATE OF d,w SKIP LOCKED
  LOOP
    v_examined := v_examined + 1;
    IF _dry_run IS DISTINCT FROM false THEN CONTINUE; END IF;
    v_queue_id := NULL;
    INSERT INTO public.sync_retry_queue
      (work_item_id,organization_id,radicado,stage,kind,provider,attempt,max_attempts,next_run_at)
    VALUES(item.id,item.organization_id,item.radicado,item.stage,'ACT_SCRAPE_RETRY',
      CASE WHEN item.workflow='CPACA' THEN 'samai' ELSE 'cpnu' END,0,3,now())
    ON CONFLICT(work_item_id,kind) DO NOTHING RETURNING id INTO v_queue_id;
    IF v_queue_id IS NOT NULL THEN
      INSERT INTO public.guarded_acts_queue_audit_20261108
        (work_item_id,organization_id,queue_id,run_date,reason)
      VALUES(item.id,item.organization_id,v_queue_id,v_day,'TRANSIENT_FAILURE');
      v_added := v_added + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('dry_run',_dry_run,'candidates',v_examined,'added',v_added,'provider_requests',0);
END
$function$;

REVOKE ALL ON FUNCTION public.enqueue_stale_started_acts_20261121(boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_stale_started_acts_20261121(boolean) TO service_role;

SELECT cron.alter_job(job_id:=jobid,command:=
  $cron$SELECT public.recover_daily_sync_after_restart_20261121(false), public.enqueue_stale_started_acts_20261121(false);$cron$)
FROM cron.job WHERE jobname='andromeda-daily-sync-after-restart';

COMMIT;
