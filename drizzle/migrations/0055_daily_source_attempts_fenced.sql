CREATE TABLE public.daily_source_attempts (
 run_date date NOT NULL, work_item_id uuid NOT NULL REFERENCES public.work_items(id), source text NOT NULL,
 organization_id uuid NOT NULL, status text NOT NULL DEFAULT 'PENDING', attempts integer NOT NULL DEFAULT 0,
 lease_token uuid, lease_expires_at timestamptz, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 result jsonb NOT NULL DEFAULT '{}'::jsonb, error_code text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(run_date,work_item_id,source), CHECK(source IN ('cpnu','samai','tutelas')), CHECK(attempts BETWEEN 0 AND 3), CHECK(status IN ('PENDING','CLAIMED','SUCCESS','FAILED'))
);
GRANT ALL ON public.daily_source_attempts TO service_role;
ALTER TABLE public.daily_source_attempts ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION public.claim_daily_source_attempt(_work_item_id uuid,_source text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d date := (now() AT TIME ZONE 'America/Bogota')::date; a public.daily_source_attempts; org uuid;
BEGIN
 SELECT organization_id INTO org FROM work_items WHERE id=_work_item_id AND deleted_at IS NULL;
 IF org IS NULL THEN RAISE EXCEPTION 'WORK_ITEM_NOT_FOUND'; END IF;
 INSERT INTO daily_source_attempts(run_date,work_item_id,source,organization_id) VALUES(d,_work_item_id,_source,org) ON CONFLICT DO NOTHING;
 SELECT * INTO a FROM daily_source_attempts WHERE run_date=d AND work_item_id=_work_item_id AND source=_source FOR UPDATE;
 IF a.status='SUCCESS' THEN RETURN jsonb_build_object('acquired',false,'status','SUCCESS','result',a.result); END IF;
 IF a.status='CLAIMED' AND a.lease_expires_at>now() THEN RETURN jsonb_build_object('acquired',false,'status','CLAIMED'); END IF;
 IF a.attempts>=3 THEN
 UPDATE daily_source_attempts SET status='FAILED',error_code=coalesce(error_code,'ATTEMPTS_EXHAUSTED'),updated_at=now() WHERE run_date=d AND work_item_id=_work_item_id AND source=_source;
 RETURN jsonb_build_object('acquired',false,'status','FAILED','error_code','ATTEMPTS_EXHAUSTED'); END IF;
 IF a.next_attempt_at>now() THEN RETURN jsonb_build_object('acquired',false,'status','PENDING','error_code','RETRY_NOT_DUE'); END IF;
 UPDATE daily_source_attempts SET status='CLAIMED',attempts=attempts+1,lease_token=gen_random_uuid(),lease_expires_at=now()+interval '3 minutes',updated_at=now()
 WHERE run_date=d AND work_item_id=_work_item_id AND source=_source RETURNING * INTO a;
 RETURN jsonb_build_object('acquired',true,'run_date',d,'lease_token',a.lease_token,'attempts',a.attempts);
END $$;
CREATE FUNCTION public.finish_daily_source_attempt(_date date,_work_item_id uuid,_source text,_token uuid,_success boolean,_retryable boolean,_error_code text,_result jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n integer;
BEGIN
 UPDATE daily_source_attempts SET status=CASE WHEN _success THEN 'SUCCESS' WHEN _retryable AND attempts<3 THEN 'PENDING' ELSE 'FAILED' END,
 next_attempt_at=now()+make_interval(secs=>30*attempts),result=coalesce(_result,'{}'::jsonb),error_code=_error_code,lease_expires_at=NULL,updated_at=now()
 WHERE run_date=_date AND work_item_id=_work_item_id AND source=_source AND status='CLAIMED' AND lease_token=_token;
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n=1;
END $$;
REVOKE ALL ON FUNCTION public.claim_daily_source_attempt(uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.finish_daily_source_attempt(date,uuid,text,uuid,boolean,boolean,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_daily_source_attempt(uuid,text),public.finish_daily_source_attempt(date,uuid,text,uuid,boolean,boolean,text,jsonb) TO service_role;
CREATE FUNCTION public.acquire_daily_sync_lock_for_origin(p_organization_id uuid,p_run_id text,p_origin text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
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
 IF a.retry_count>=3 THEN RETURN jsonb_build_object('acquired',false,'ledger_id',a.id,'status','FAILED','reason','Bounded recovery exhausted'); END IF;
 UPDATE auto_sync_daily_ledger SET status='RUNNING',run_id=p_run_id,last_heartbeat_at=now(),started_at=coalesce(started_at,now()),completed_at=NULL,finished_at=NULL,
 retry_count=retry_count+CASE WHEN a.status IN ('SUCCESS','FAILED','PARTIAL','RUNNING') THEN 1 ELSE 0 END,updated_at=now() WHERE id=a.id;
 RETURN jsonb_build_object('acquired',true,'ledger_id',a.id,'status','RUNNING','previous_status',a.status);
END $$;
CREATE OR REPLACE FUNCTION public.acquire_daily_sync_lock(p_organization_id uuid,p_run_id text DEFAULT NULL) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ SELECT public.acquire_daily_sync_lock_for_origin(p_organization_id,coalesce(p_run_id,gen_random_uuid()::text),'CRON') $$;
REVOKE ALL ON FUNCTION public.acquire_daily_sync_lock_for_origin(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_daily_sync_lock_for_origin(uuid,text,text) TO service_role;