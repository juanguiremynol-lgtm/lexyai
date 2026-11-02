-- Public backend certificates only: no provider request and no new daily
-- extraction admission. Apply before the compatible sync-publicaciones caller.
BEGIN;
CREATE OR REPLACE FUNCTION public.claim_pp_stored_result_read(
 _work_item_id uuid,_min_interval_seconds integer DEFAULT 3600)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE v jsonb; k text := 'pp_stored_result_read:'||_work_item_id::text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service role required'; END IF;
 IF _min_interval_seconds<600 OR _min_interval_seconds>7200 THEN RAISE EXCEPTION 'invalid read interval'; END IF;
 IF NOT EXISTS(SELECT 1 FROM work_items w WHERE w.id=_work_item_id AND w.deleted_at IS NULL
   AND w.lifecycle_state='ACTIVE' AND w.monitoring_enabled AND w.scraping_enabled
   AND w.workflow_type IS DISTINCT FROM 'CPACA'
   AND EXISTS(SELECT 1 FROM work_item_provider_enrollment e WHERE e.work_item_id=w.id AND e.provider_key='publicaciones' AND e.enabled)) THEN
  RETURN jsonb_build_object('claimed',false,'reason','NOT_ELIGIBLE');
 END IF;
 INSERT INTO cron_state(key,value,updated_at) VALUES(k,jsonb_build_object(
   'claimed_at',clock_timestamp(),'next_read_at',now()+make_interval(secs=>_min_interval_seconds),'reads',1),now())
 ON CONFLICT(key) DO UPDATE SET updated_at=now(),value=cron_state.value||jsonb_build_object(
   'claimed_at',clock_timestamp(),'next_read_at',now()+make_interval(secs=>_min_interval_seconds),
   'reads',coalesce((cron_state.value->>'reads')::bigint,0)+1)
 WHERE coalesce((cron_state.value->>'next_read_at')::timestamptz,'-infinity'::timestamptz)<=now()
 RETURNING value INTO v;
 IF v IS NOT NULL THEN RETURN jsonb_build_object('claimed',true,'next_read_at',v->>'next_read_at'); END IF;
 SELECT value INTO v FROM cron_state WHERE key=k;
 RETURN jsonb_build_object('claimed',false,'reason','NOT_DUE','next_read_at',v->>'next_read_at');
END $function$;
REVOKE ALL ON FUNCTION public.claim_pp_stored_result_read(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pp_stored_result_read(uuid,integer) TO service_role;
COMMIT;
