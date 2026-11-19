-- A daily admission/poll gate is not a source failure or a completed read.
BEGIN;
CREATE OR REPLACE FUNCTION public.defer_public_monitor_read(
  _run_id uuid,_work_item_id uuid,_lease_token uuid,_retry_at timestamptz,_result jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE n integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN
   RAISE EXCEPTION 'service only' USING ERRCODE='42501';
 END IF;
 IF _result->>'result_code' IS DISTINCT FROM 'DAILY_UPDATE_ALREADY_STARTED'
   OR _result->>'deduplicated' IS DISTINCT FROM 'true'
   OR _result#>>'{daily_update,admitted}' IS DISTINCT FROM 'false'
   OR _retry_at IS NULL THEN RAISE EXCEPTION 'not a deferred read'; END IF;
 UPDATE public.estados_monitor_run_items i SET status='PENDING',attempts=greatest(i.attempts-1,0),
   claimed_at=NULL,lease_token=NULL,finished_at=NULL,
   next_attempt_at=greatest(now()+interval '30 seconds',least(_retry_at,now()+interval '48 hours')),
   error_code='DAILY_UPDATE_ALREADY_STARTED',result=_result||'{"monitor_deferred_without_read":true}'::jsonb
 WHERE i.run_id=_run_id AND i.work_item_id=_work_item_id AND i.status='CLAIMED'
   AND i.lease_token=_lease_token AND i.claimed_at>now()-interval '3 minutes'
   AND EXISTS(SELECT 1 FROM public.estados_monitor_runs r WHERE r.id=i.run_id
     AND r.status IN ('RUNNING','PARTIAL'));
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n=1;
END $$;
REVOKE ALL ON FUNCTION public.defer_public_monitor_read(uuid,uuid,uuid,timestamptz,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.defer_public_monitor_read(uuid,uuid,uuid,timestamptz,jsonb) TO service_role;
COMMIT;
