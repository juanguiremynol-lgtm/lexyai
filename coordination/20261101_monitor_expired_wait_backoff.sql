-- Existing monitor only: exhausted internal status polls remain diagnosed,
-- slow deferred checks; provider retries and their bounds are unchanged.
BEGIN;
SET LOCAL lock_timeout='3s';
CREATE TABLE IF NOT EXISTS public.monitor_wait_function_backup_20261101(
 key text PRIMARY KEY,definition text NOT NULL,owner_name name NOT NULL,acl text,recorded_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.monitor_wait_function_backup_20261101 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.monitor_wait_function_backup_20261101 FROM PUBLIC,anon,authenticated,service_role;
DO $guard$
DECLARE proc regprocedure := 'public.finish_public_monitor_item(uuid,uuid,uuid,boolean,boolean,text,jsonb)'::regprocedure;
BEGIN
 IF md5(pg_get_functiondef(proc)) NOT IN ('3e7e735910a60a264db4fd0ca2a8d799','074446065446f5d0e7203473258bd5d0') THEN
  RAISE EXCEPTION 'Monitor finisher changed: reconcile rather than overwrite';
 END IF;
 INSERT INTO monitor_wait_function_backup_20261101(key,definition,owner_name,acl)
 SELECT 'expired-wait-backoff-v1',pg_get_functiondef(proc),pg_get_userbyid(proowner),proacl::text FROM pg_proc WHERE oid=proc
 ON CONFLICT DO NOTHING;
END $guard$;
CREATE OR REPLACE FUNCTION public.finish_public_monitor_item(_run_id uuid, _work_item_id uuid, _lease_token uuid, _success boolean, _retryable boolean, _error_code text, _result jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE affected integer;
 exhausted boolean := coalesce(_result#>>'{backend_trace,followup_expired_needs_intervention}','false')='true';
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service only' USING ERRCODE='42501'; END IF;
 IF NOT _success AND _result->>'result_code'='PENDING_UPSTREAM'
   AND _result->>'pending_upstream'='true'
   AND _result#>>'{backend_trace,estado}' IN ('ADMITIDA','EN_CURSO')
   AND _result#>>'{backend_trace,run_status_http}'='200'
   AND _result#>>'{backend_trace,backend_run_id}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
   UPDATE public.estados_monitor_run_items i SET status='PENDING',attempts=greatest(i.attempts-1,0),
     claimed_at=NULL,lease_token=NULL,finished_at=NULL,next_attempt_at=now()+make_interval(secs=>CASE WHEN exhausted THEN 3600 ELSE 600 END),
     error_code=CASE WHEN exhausted THEN 'BACKEND_WAIT_BUDGET_EXHAUSTED' ELSE 'PENDING_UPSTREAM' END,
     result=_result||jsonb_strip_nulls(jsonb_build_object('monitor_deferred_without_read',true,
       'monitor_followup_budget_exhausted',exhausted,'monitor_requires_intervention',exhausted,
       'monitor_wait_exhausted_since',CASE WHEN exhausted THEN coalesce(i.result->'monitor_wait_exhausted_since',to_jsonb(now())) ELSE i.result->'monitor_wait_exhausted_since' END,
       'monitor_next_state_check_seconds',CASE WHEN exhausted THEN 3600 ELSE 600 END))
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
END $function$
;
REVOKE ALL ON FUNCTION public.finish_public_monitor_item(uuid,uuid,uuid,boolean,boolean,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_public_monitor_item(uuid,uuid,uuid,boolean,boolean,text,jsonb) TO service_role;
COMMENT ON FUNCTION public.finish_public_monitor_item(uuid,uuid,uuid,boolean,boolean,text,jsonb) IS
 '20261101: accepted-run status checks do not consume source attempts; exhausted followup stays diagnosed with hourly internal checks; all source failures remain bounded and completion stays fenced';
COMMIT;
