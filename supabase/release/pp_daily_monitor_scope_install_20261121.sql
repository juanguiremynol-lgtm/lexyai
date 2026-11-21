BEGIN;
SET LOCAL lock_timeout = '5s';

-- Apply to the deployed durable-monitor definitions only. Existing states and
-- provider receipts are preserved. Historical extraction jobs keep their own
-- run-ID follow-up path, separate from the current day's monitor snapshot.
DO $patch$
DECLARE
  reserve regprocedure := 'public.reserve_due_public_monitor_run(text,date)'::regprocedure;
  claim regprocedure := 'public.claim_public_monitor_items(uuid,text,integer)'::regprocedure;
  start_run regprocedure := 'public.start_public_monitor_run(text,date,text[])'::regprocedure;
  finish_item regprocedure := 'public.finish_public_monitor_item(uuid,uuid,uuid,boolean,boolean,text,jsonb)'::regprocedure;
  def text;
BEGIN
  def := pg_get_functiondef(reserve);
  IF md5(def) <> 'f7424d60dd7663e196e5a3844abbb1d7' THEN RAISE EXCEPTION 'Unexpected reserve definition'; END IF;
  EXECUTE replace(def, $old$ WHERE r.channel=_channel AND r.status IN ('RUNNING','PARTIAL')$old$,
    $new$ WHERE r.channel=_channel AND r.status IN ('RUNNING','PARTIAL')
 AND (_channel <> 'publicaciones' OR r.run_date = _priority_date)$new$);

  def := pg_get_functiondef(claim);
  IF md5(def) <> '9c228fc3a0f11d86a03e07c91e76b553' THEN RAISE EXCEPTION 'Unexpected claim definition'; END IF;
  EXECUTE replace(def, $old$WHERE r.id=_run_id AND r.channel=_channel FOR UPDATE;$old$,
    $new$WHERE r.id=_run_id AND r.channel=_channel
   AND (_channel <> 'publicaciones' OR r.run_date = (now() AT TIME ZONE 'America/Bogota')::date)
 FOR UPDATE;$new$);

  def := pg_get_functiondef(start_run);
  IF md5(def) <> 'dad722d610c1b87fbef2ce9524816744' THEN RAISE EXCEPTION 'Unexpected start definition'; END IF;
  EXECUTE replace(def, $old$   AND w.workflow_type::text=ANY(_workflows)$old$,
    $new$   AND w.workflow_type::text=ANY(_workflows)
   AND (_channel <> 'publicaciones' OR (w.scraping_enabled AND EXISTS (
     SELECT 1 FROM public.work_item_provider_enrollment e
     WHERE e.work_item_id=w.id AND e.provider_key='publicaciones' AND e.scope='PUBS' AND e.enabled
   )))$new$);

  def := pg_get_functiondef(finish_item);
  IF md5(def) <> '074446065446f5d0e7203473258bd5d0' THEN RAISE EXCEPTION 'Unexpected finish definition'; END IF;
  EXECUTE replace(def, $old$     next_attempt_at=now()+make_interval(secs=>30*i.attempts),error_code=_error_code,result=coalesce(_result,'{}'::jsonb)$old$,
    $new$     next_attempt_at=now()+CASE WHEN _error_code='PP_DAILY_PLAN_UNVERIFIED' THEN interval '70 minutes'
       ELSE make_interval(secs=>30*i.attempts) END,error_code=_error_code,result=coalesce(_result,'{}'::jsonb)$new$);

  IF position('r.run_date = _priority_date' in pg_get_functiondef(reserve)) = 0 OR
     position('r.run_date = (now() AT TIME ZONE' in pg_get_functiondef(claim)) = 0 OR
     position('w.scraping_enabled AND EXISTS' in pg_get_functiondef(start_run)) = 0 OR
     position('70 minutes' in pg_get_functiondef(finish_item)) = 0 THEN
    RAISE EXCEPTION 'Incomplete Publicaciones monitor patch';
  END IF;
END;
$patch$;

COMMIT;
