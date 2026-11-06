-- One-time, preimage-guarded change. Only known live durable PP runs qualify.
-- Waiting for such a run does not consume a failed provider-query attempt.
BEGIN;
DO $guard$ BEGIN
 IF md5(pg_get_functiondef('public.finish_public_monitor_item(uuid,uuid,uuid,boolean,boolean,text,jsonb)'::regprocedure))
   <> 'c0f9a685af2133e8437fde5c279713f9' THEN
   RAISE EXCEPTION 'Monitor completion changed; reconcile before applying';
 END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.finish_public_monitor_item(
 _run_id uuid,_work_item_id uuid,_lease_token uuid,_success boolean,_retryable boolean,_error_code text,_result jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE affected integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service only' USING ERRCODE='42501'; END IF;
 IF NOT _success AND _result->>'result_code'='PENDING_UPSTREAM'
   AND _result->>'pending_upstream'='true'
   AND _result#>>'{backend_trace,estado}' IN ('ADMITIDA','EN_CURSO')
   AND _result#>>'{backend_trace,run_status_http}'='200'
   AND _result#>>'{backend_trace,followup_expired_needs_intervention}'='false'
   AND _result#>>'{backend_trace,backend_run_id}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
   UPDATE public.estados_monitor_run_items i SET status='PENDING',attempts=greatest(i.attempts-1,0),
     claimed_at=NULL,lease_token=NULL,finished_at=NULL,next_attempt_at=now()+interval '10 minutes',
     error_code='PENDING_UPSTREAM',result=_result||'{"monitor_deferred_without_read":true}'::jsonb
   WHERE i.run_id=_run_id AND i.work_item_id=_work_item_id AND i.status='CLAIMED'
     AND i.lease_token=_lease_token AND i.claimed_at>now()-interval '3 minutes';
 ELSE
   -- Retain the existing bounded policy for real errors and terminal partials.
   UPDATE public.estados_monitor_run_items i
   SET status=CASE WHEN _success THEN 'SUCCESS' WHEN _retryable AND i.attempts<3 THEN 'PENDING' ELSE 'FAILED' END,
     finished_at=CASE WHEN NOT _success AND _retryable AND i.attempts<3 THEN NULL ELSE now() END,
     next_attempt_at=now()+make_interval(secs=>30*i.attempts),error_code=_error_code,result=coalesce(_result,'{}'::jsonb)
   WHERE i.run_id=_run_id AND i.work_item_id=_work_item_id AND i.status='CLAIMED'
     AND i.lease_token=_lease_token AND i.claimed_at>now()-interval '3 minutes';
 END IF;
 GET DIAGNOSTICS affected=ROW_COUNT; RETURN affected=1;
END $$;
REVOKE ALL ON FUNCTION public.finish_public_monitor_item(uuid,uuid,uuid,boolean,boolean,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_public_monitor_item(uuid,uuid,uuid,boolean,boolean,text,jsonb) TO service_role;
COMMENT ON FUNCTION public.finish_public_monitor_item(uuid,uuid,uuid,boolean,boolean,text,jsonb)
 IS '20261031: admitted PP waits are pending, not failed reads; service-only, fenced, source failures remain bounded';
COMMIT;
