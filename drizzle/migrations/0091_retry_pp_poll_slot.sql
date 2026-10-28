CREATE OR REPLACE FUNCTION public.claim_sync_retry_pp_poll(p_task_id uuid DEFAULT NULL)
 RETURNS SETOF public.sync_retry_queue LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service only' USING ERRCODE='42501'; END IF;
 RETURN QUERY WITH candidate AS (
  SELECT q.id FROM public.sync_retry_queue q
  JOIN public.cron_state c ON c.key = 'pub_rescrape:' || q.work_item_id::text
  WHERE q.kind='PUB_RETRY' AND q.next_run_at<=now()
    AND (q.claimed_at IS NULL OR q.claimed_at<now()-interval '10 minutes')
    AND (p_task_id IS NULL OR q.id=p_task_id)
    AND COALESCE(c.value->>'backend_run_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND COALESCE(c.value->>'followup_closed','false') <> 'true'
    AND COALESCE(NULLIF(c.value->>'poll_count','')::int,0) < 96
    AND CASE WHEN COALESCE(c.value->>'backend_admitted_at','') ~ '^\d{4}-\d{2}-\d{2}T'
             THEN (c.value->>'backend_admitted_at')::timestamptz > now()-interval '72 hours' ELSE false END
  ORDER BY q.next_run_at, q.created_at, q.id FOR UPDATE OF q SKIP LOCKED LIMIT 1
 ) UPDATE public.sync_retry_queue q SET claimed_at=now(),lease_token=gen_random_uuid() FROM candidate c WHERE q.id=c.id RETURNING q.*;
END $function$;
REVOKE ALL ON FUNCTION public.claim_sync_retry_pp_poll(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sync_retry_pp_poll(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_sync_retry(p_id uuid, p_token uuid, p_outcome text, p_error text, p_result jsonb, p_delay_seconds integer DEFAULT 900)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
DECLARE q public.sync_retry_queue%ROWTYPE; adm timestamptz;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service only' USING ERRCODE='42501'; END IF;
 IF p_outcome NOT IN ('SUCCESS','RETRY','EXHAUSTED','INELIGIBLE','DEFERRED') OR p_delay_seconds<0 OR p_delay_seconds>86400 THEN RAISE EXCEPTION 'invalid outcome'; END IF;
 SELECT * INTO q FROM public.sync_retry_queue WHERE id=p_id AND lease_token=p_token FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF p_outcome='DEFERRED' THEN
  IF p_error IS NULL OR p_error NOT IN ('PROVIDER_BREAKER_OPEN','PROVIDER_BREAKER_UNAVAILABLE','PROVIDER_BREAKER_LEASE_LOST','SOURCE_ENROLLMENT_UNAVAILABLE','MONITORING_PAUSED','PP_RUN_PENDING','PP_RUN_OVERDUE') THEN RAISE EXCEPTION 'invalid deferral'; END IF;
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
   next_run_at=now()+make_interval(secs=>greatest(5,least(p_delay_seconds,CASE WHEN p_error='MONITORING_PAUSED' THEN 86400 WHEN p_error='PP_RUN_OVERDUE' THEN 21600 ELSE 1800 END))),
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
REVOKE ALL ON FUNCTION public.finish_sync_retry(uuid,uuid,text,text,jsonb,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_sync_retry(uuid,uuid,text,text,jsonb,integer) TO service_role;