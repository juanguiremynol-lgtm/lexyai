CREATE OR REPLACE FUNCTION public.acquire_daily_sync_lock_for_origin(p_organization_id uuid,p_run_id text,p_origin text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d date := (now() AT TIME ZONE 'America/Bogota')::date; scheduled timestamptz; a public.auto_sync_daily_ledger;
BEGIN
 scheduled:=(d||' 07:00:00')::timestamp AT TIME ZONE 'America/Bogota';
 IF p_origin='CRON' AND now()<scheduled THEN RETURN jsonb_build_object('acquired',false,'status','NOT_DUE','reason','Before automatic daily window'); END IF;
 PERFORM pg_advisory_xact_lock(hashtext('daily-sync:'||p_organization_id::text||':'||d::text));
 SELECT * INTO a FROM auto_sync_daily_ledger WHERE organization_id=p_organization_id AND run_date=d AND is_continuation IS NOT TRUE FOR UPDATE;
 IF a.id IS NULL THEN
 INSERT INTO auto_sync_daily_ledger(organization_id,run_date,scheduled_for,status,run_id,is_continuation) VALUES(p_organization_id,d,scheduled,'PENDING',p_run_id,false) RETURNING * INTO a;
 END IF;
 IF a.status='SUCCESS' AND a.items_failed=0 AND coalesce(a.items_skipped,0)=0 AND coalesce((a.metadata->>'items_dispatched')::integer,0)=0 AND a.items_succeeded>=a.items_targeted THEN
 RETURN jsonb_build_object('acquired',false,'ledger_id',a.id,'status','SUCCESS','reason','Confirmed completion'); END IF;
 IF a.status='RUNNING' AND a.last_heartbeat_at>now()-interval '3 minutes' THEN RETURN jsonb_build_object('acquired',false,'ledger_id',a.id,'status','RUNNING','reason','Active lease'); END IF;
 -- The organization counter is diagnostic, not proof that every source exhausted its attempts.
 IF EXISTS(SELECT 1 FROM daily_source_attempts WHERE organization_id=p_organization_id AND run_date=d)
 AND NOT EXISTS(SELECT 1 FROM work_items w WHERE w.organization_id=p_organization_id AND w.deleted_at IS NULL AND w.monitoring_enabled=true AND NOT EXISTS(
 SELECT 1 FROM daily_source_attempts s WHERE s.run_date=d AND s.work_item_id=w.id AND s.source=CASE WHEN w.workflow_type='CPACA' THEN 'samai' WHEN w.workflow_type='TUTELA' THEN 'tutelas' ELSE 'cpnu' END AND s.status IN ('SUCCESS','FAILED'))) THEN
 RETURN jsonb_build_object('acquired',false,'ledger_id',a.id,'status','FAILED','reason','No retryable source remains; exhausted sources are not successful'); END IF;
 UPDATE auto_sync_daily_ledger SET status='RUNNING',run_id=p_run_id,last_heartbeat_at=now(),started_at=coalesce(started_at,now()),completed_at=NULL,finished_at=NULL,
 retry_count=retry_count+CASE WHEN a.status IN ('SUCCESS','FAILED','PARTIAL','RUNNING') THEN 1 ELSE 0 END,updated_at=now() WHERE id=a.id;
 RETURN jsonb_build_object('acquired',true,'ledger_id',a.id,'status','RUNNING','previous_status',a.status);
END $$;
REVOKE ALL ON FUNCTION public.acquire_daily_sync_lock_for_origin(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_daily_sync_lock_for_origin(uuid,text,text) TO service_role;
CREATE OR REPLACE FUNCTION public.finish_daily_source_attempt(_date date,_work_item_id uuid,_source text,_token uuid,_success boolean,_retryable boolean,_error_code text,_result jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n integer;
BEGIN
 UPDATE daily_source_attempts SET status=CASE WHEN _success THEN 'SUCCESS' WHEN _retryable AND attempts<3 THEN 'PENDING' ELSE 'FAILED' END,
 next_attempt_at=now()+make_interval(secs=>30*attempts),result=coalesce(_result,'{}'::jsonb),error_code=_error_code,lease_expires_at=NULL,updated_at=now()
 WHERE run_date=_date AND work_item_id=_work_item_id AND source=_source AND status='CLAIMED' AND lease_token=_token AND lease_expires_at>now();
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n=1;
END $$;
REVOKE ALL ON FUNCTION public.finish_daily_source_attempt(date,uuid,text,uuid,boolean,boolean,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_daily_source_attempt(date,uuid,text,uuid,boolean,boolean,text,jsonb) TO service_role;