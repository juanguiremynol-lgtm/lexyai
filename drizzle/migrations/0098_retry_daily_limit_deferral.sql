CREATE OR REPLACE FUNCTION public.finish_sync_retry(p_id uuid, p_token uuid, p_outcome text, p_error text, p_result jsonb, p_delay_seconds integer DEFAULT 900)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE q public.sync_retry_queue%ROWTYPE; adm timestamptz;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service only' USING ERRCODE='42501'; END IF;
 IF p_outcome NOT IN ('SUCCESS','RETRY','EXHAUSTED','INELIGIBLE','DEFERRED') OR p_delay_seconds<0 OR p_delay_seconds>86400 THEN RAISE EXCEPTION 'invalid outcome'; END IF;
 SELECT * INTO q FROM public.sync_retry_queue WHERE id=p_id AND lease_token=p_token FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF p_outcome='DEFERRED' THEN
  IF p_error IS NULL OR p_error NOT IN ('PROVIDER_BREAKER_OPEN','PROVIDER_BREAKER_UNAVAILABLE','PROVIDER_BREAKER_LEASE_LOST','SOURCE_ENROLLMENT_UNAVAILABLE','MONITORING_PAUSED','PP_RUN_PENDING','PP_RUN_OVERDUE','DAILY_UPDATE_ALREADY_STARTED','DAILY_ADMISSION_UNAVAILABLE') THEN RAISE EXCEPTION 'invalid deferral'; END IF;
  IF p_error IN ('PP_RUN_PENDING','PP_RUN_OVERDUE') THEN
   IF q.kind <> 'PUB_RETRY'
    OR COALESCE(p_result#>>'{response,pending_upstream}','') <> 'true'
    OR COALESCE(p_result#>>'{response,backend_trace,backend_run_id}','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR NOT (COALESCE(p_result#>>'{response,backend_trace,estado}','') IN ('ADMITIDA','EN_CURSO') OR COALESCE(p_result#>>'{response,backend_trace,run_status}','') = 'PENDING')
    OR COALESCE(p_result#>>'{response,backend_trace,backend_admitted_at}','') = ''
   THEN RAISE EXCEPTION 'invalid PP durable deferral'; END IF;
   adm := (p_result#>>'{response,backend_trace,backend_admitted_at}')::timestamptz;
   IF adm > now()+interval '1 minute'
    OR (p_error='PP_RUN_PENDING' AND adm <= now()-interval '24 hours')
    OR (p_error='PP_RUN_OVERDUE' AND (adm > now()-interval '24 hours' OR adm <= now()-interval '72 hours'))
   THEN RAISE EXCEPTION 'expired PP durable deferral'; END IF;
  END IF;
  UPDATE public.sync_retry_queue SET claimed_at=NULL,lease_token=NULL,
   next_run_at=now()+make_interval(secs=>greatest(5,least(p_delay_seconds,CASE WHEN p_error IN ('MONITORING_PAUSED','DAILY_UPDATE_ALREADY_STARTED') THEN 86400 WHEN p_error='PP_RUN_OVERDUE' THEN 21600 ELSE 1800 END))),
   last_error_code=p_error,last_error_message=left(p_result::text,1000) WHERE id=q.id;
 ELSIF p_outcome='RETRY' AND q.attempt+1<q.max_attempts THEN
  UPDATE public.sync_retry_queue SET attempt=attempt+1,claimed_at=NULL,lease_token=NULL,next_run_at=now()+make_interval(secs=>p_delay_seconds),last_error_code=p_error,last_error_message=left(p_result::text,1000) WHERE id=q.id;
 ELSE
  INSERT INTO public.sync_retry_outcomes(task_id,work_item_id,kind,attempt,outcome,error_code,result)
   VALUES(q.id,q.work_item_id,q.kind,CASE WHEN p_outcome='INELIGIBLE' THEN q.attempt ELSE q.attempt+1 END,CASE WHEN p_outcome='RETRY' THEN 'EXHAUSTED' ELSE p_outcome END,p_error,COALESCE(p_result,'{}'::jsonb)) ON CONFLICT(task_id) DO NOTHING;
  DELETE FROM public.sync_retry_queue WHERE id=q.id AND lease_token=p_token;
 END IF;
 RETURN true;
END $function$;