-- Add missing executive and transiently excluded matters to the existing
-- bounded retry queue. Does not perform provider requests or clear failures.
BEGIN;
DO $check$
BEGIN
  IF to_regclass('public.guarded_acts_queue_audit_20261108') IS NOT NULL OR
     to_regprocedure('public.enqueue_guarded_missing_acts_20261108(boolean,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'queue recovery release name already exists';
  END IF;
END
$check$;

CREATE TABLE public.guarded_acts_queue_audit_20261108 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  queue_id uuid NOT NULL,
  run_date date NOT NULL,
  reason text NOT NULL CHECK (reason IN ('EXECUTIVE','TRANSIENT_FAILURE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(work_item_id,run_date)
);
ALTER TABLE public.guarded_acts_queue_audit_20261108 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.guarded_acts_queue_audit_20261108 FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.guarded_acts_queue_audit_20261108 TO service_role;

CREATE FUNCTION public.enqueue_guarded_missing_acts_20261108(
  _dry_run boolean DEFAULT true, _limit integer DEFAULT 10
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  c record;
  v_day date := (now() AT TIME ZONE 'America/Bogota')::date;
  v_used integer;
  v_examined integer := 0;
  v_added integer := 0;
  v_queue_id uuid;
BEGIN
  IF _dry_run IS NULL OR _limit IS NULL OR _limit<1 OR _limit>10 THEN
    RAISE EXCEPTION 'invalid queue options';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('guarded-missing-acts-20261108',0));
  SELECT count(*) INTO v_used FROM public.guarded_acts_queue_audit_20261108 WHERE run_date=v_day;
  FOR c IN
    SELECT w.id,w.organization_id,w.radicado,w.stage,w.workflow_type::text AS workflow,
      CASE WHEN w.workflow_type::text='EJECUTIVO' THEN 'EXECUTIVE' ELSE 'TRANSIENT_FAILURE' END reason
    FROM public.work_items w
    LEFT JOIN public.sync_item_failure_tracker t ON t.work_item_id=w.id AND t.organization_id=w.organization_id
    LEFT JOIN LATERAL (
      SELECT s.error_code FROM public.work_item_sync_timeline s
      WHERE s.work_item_id=w.id AND s.operation='acts'
      ORDER BY s.started_at DESC NULLS LAST,s.id DESC LIMIT 1
    ) last_event ON true
    WHERE w.organization_id IS NOT NULL AND w.deleted_at IS NULL
      AND w.lifecycle_state::text='ACTIVE' AND w.monitoring_enabled=true
      AND length(regexp_replace(coalesce(w.radicado,''),'[^0-9]','','g'))=23
      AND (w.stage IS NULL OR w.stage NOT IN ('ARCHIVADO','FINALIZADO','EJECUTORIADO',
        'PRECLUIDO_ARCHIVADO','FINALIZADO_ABSUELTO','FINALIZADO_CONDENADO'))
      AND w.workflow_type::text IN ('CGP','LABORAL','CPACA','PENAL_906','EJECUTIVO')
      AND (w.workflow_type::text='EJECUTIVO' OR
        (t.dead_lettered=true AND (t.last_failure_reason='PROVIDER_ERROR'
          OR t.last_failure_reason LIKE 'ITEM_TIMEOUT:%'
          OR t.last_failure_reason='Edge Function returned a non-2xx status code')))
      AND coalesce(last_event.error_code,'') NOT IN
        ('PROCESO_PRIVADO','PROVIDER_NOT_FOUND','PROVIDER_UNRESOLVED')
      AND coalesce((public.peek_daily_update(w.id,'acts')->>'started')::boolean,true)=false
      AND NOT EXISTS (SELECT 1 FROM public.sync_retry_queue q
        WHERE q.work_item_id=w.id AND q.kind='ACT_SCRAPE_RETRY')
      AND NOT EXISTS (SELECT 1 FROM public.guarded_acts_queue_audit_20261108 a
        WHERE a.work_item_id=w.id AND
          (a.run_date=v_day OR (w.workflow_type::text<>'EJECUTIVO' AND a.run_date>v_day-7)))
    ORDER BY t.last_failure_at ASC NULLS LAST,w.id
    LIMIT greatest(0,least(_limit,10-v_used))
    FOR UPDATE OF w SKIP LOCKED
  LOOP
    v_examined := v_examined+1;
    IF NOT _dry_run THEN
      INSERT INTO public.sync_retry_queue
        (work_item_id,organization_id,radicado,stage,kind,provider,attempt,max_attempts,next_run_at)
      VALUES(c.id,c.organization_id,c.radicado,c.stage,'ACT_SCRAPE_RETRY',
        CASE WHEN c.workflow='CPACA' THEN 'samai' ELSE 'cpnu' END,0,3,now())
      ON CONFLICT(work_item_id,kind) DO NOTHING RETURNING id INTO v_queue_id;
      IF v_queue_id IS NOT NULL THEN
        INSERT INTO public.guarded_acts_queue_audit_20261108
          (work_item_id,organization_id,queue_id,run_date,reason)
        VALUES(c.id,c.organization_id,v_queue_id,v_day,c.reason);
        v_added := v_added+1;
      END IF;
      v_queue_id := NULL;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('dry_run',_dry_run,'candidates',v_examined,'enqueued',v_added,
    'already_added_today',v_used,'daily_limit',10,'provider_requests',0,
    'scope','normal_retry_queue_only');
END
$fn$;
REVOKE ALL ON FUNCTION public.enqueue_guarded_missing_acts_20261108(boolean,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_guarded_missing_acts_20261108(boolean,integer) TO service_role;
COMMIT;
