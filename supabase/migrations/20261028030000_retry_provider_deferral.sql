-- A fenced retry can be deferred when a shared breaker denies its permit.
-- The provider was not contacted, so do not consume its retry budget.
CREATE OR REPLACE FUNCTION public.finish_sync_retry(p_id uuid, p_token uuid, p_outcome text, p_error text, p_result jsonb, p_delay_seconds integer DEFAULT 900)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
DECLARE q public.sync_retry_queue%ROWTYPE;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service only' USING ERRCODE='42501'; END IF;
 IF p_outcome NOT IN ('SUCCESS','RETRY','EXHAUSTED','INELIGIBLE','DEFERRED') OR p_delay_seconds<0 OR p_delay_seconds>86400 THEN RAISE EXCEPTION 'invalid outcome'; END IF;
 SELECT * INTO q FROM public.sync_retry_queue WHERE id=p_id AND lease_token=p_token FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF p_outcome='DEFERRED' THEN
  IF p_error IS NULL OR p_error NOT IN ('PROVIDER_BREAKER_OPEN','PROVIDER_BREAKER_UNAVAILABLE','PROVIDER_BREAKER_LEASE_LOST','SOURCE_ENROLLMENT_UNAVAILABLE') THEN RAISE EXCEPTION 'invalid deferral'; END IF;
  UPDATE public.sync_retry_queue SET claimed_at=NULL,lease_token=NULL,
   next_run_at=now()+make_interval(secs=>greatest(5,least(p_delay_seconds,1800))),
   last_error_code=p_error,last_error_message=left(p_result::text,1000) WHERE id=q.id;
 ELSIF p_outcome='RETRY' AND q.attempt+1<q.max_attempts THEN
  UPDATE public.sync_retry_queue SET attempt=attempt+1,claimed_at=NULL,lease_token=NULL,next_run_at=now()+make_interval(secs=>p_delay_seconds),last_error_code=p_error,last_error_message=left(p_result::text,1000) WHERE id=q.id;
 ELSE
  INSERT INTO public.sync_retry_outcomes(task_id,work_item_id,kind,attempt,outcome,error_code,result)
   VALUES(q.id,q.work_item_id,q.kind,q.attempt+1,CASE WHEN p_outcome='RETRY' THEN 'EXHAUSTED' ELSE p_outcome END,p_error,COALESCE(p_result,'{}'::jsonb)) ON CONFLICT(task_id) DO NOTHING;
  DELETE FROM public.sync_retry_queue WHERE id=q.id AND lease_token=p_token;
 END IF;
 RETURN true;
END $function$;
REVOKE ALL ON FUNCTION public.finish_sync_retry(uuid,uuid,text,text,jsonb,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_sync_retry(uuid,uuid,text,text,jsonb,integer) TO service_role;
