BEGIN;
CREATE TEMP TABLE work_items (
 id uuid PRIMARY KEY, organization_id uuid, radicado text, stage text, workflow_type text,
 deleted_at timestamptz, lifecycle_state text, monitoring_enabled boolean
);
CREATE TEMP TABLE sync_item_failure_tracker (
 work_item_id uuid,organization_id uuid,dead_lettered boolean,last_failure_reason text,last_failure_at timestamptz
);
CREATE TEMP TABLE work_item_sync_timeline (
 id uuid,work_item_id uuid,operation text,error_code text,started_at timestamptz
);
CREATE TEMP TABLE sync_retry_queue (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),work_item_id uuid,organization_id uuid,
 radicado text,stage text,kind text,provider text,attempt integer,max_attempts integer,
 next_run_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),
 claimed_at timestamptz,lease_token uuid, UNIQUE(work_item_id,kind)
);
CREATE TEMP TABLE guarded_acts_queue_audit_20261108 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),work_item_id uuid,organization_id uuid,
 queue_id uuid,run_date date,reason text,created_at timestamptz DEFAULT now(), UNIQUE(work_item_id,run_date)
);
CREATE TEMP TABLE admitted(id uuid);
CREATE FUNCTION pg_temp.peek_daily_update(uuid,text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('started',EXISTS(SELECT 1 FROM admitted WHERE id=$1))
$$;
-- FUNCTION_BODY inserted by the test runner from the release verbatim.
-- FUNCTION_BODY
DO $test$
DECLARE
 org uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 v_result jsonb;
 n integer;
BEGIN
 INSERT INTO work_items
 SELECT ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,org,'05001400301120260144800',
   'ACTIVO',CASE WHEN i=1 THEN 'EJECUTIVO' WHEN i=8 THEN 'CPACA' ELSE 'CGP' END,
   NULL,'ACTIVE',i<>6
 FROM generate_series(1,10) i;
 UPDATE work_items SET radicado='1' WHERE id='00000000-0000-4000-8000-000000000009';
 INSERT INTO sync_item_failure_tracker
 SELECT id,org,true,CASE WHEN id='00000000-0000-4000-8000-000000000007'
   THEN 'PROCESO_PRIVADO' ELSE 'PROVIDER_ERROR' END,now()-interval '1 day'
 FROM work_items WHERE id<>'00000000-0000-4000-8000-000000000001';
 INSERT INTO work_item_sync_timeline VALUES
  (gen_random_uuid(),'00000000-0000-4000-8000-000000000003','acts','PROCESO_PRIVADO',now());
 INSERT INTO admitted VALUES('00000000-0000-4000-8000-000000000004');
 INSERT INTO sync_retry_queue(work_item_id,organization_id,kind,provider,attempt,max_attempts,next_run_at)
 VALUES('00000000-0000-4000-8000-000000000005',org,'ACT_SCRAPE_RETRY','cpnu',2,3,now());
 INSERT INTO guarded_acts_queue_audit_20261108(work_item_id,organization_id,queue_id,run_date,reason)
 VALUES('00000000-0000-4000-8000-000000000010',org,gen_random_uuid(),
   (now() AT TIME ZONE 'America/Bogota')::date-1,'TRANSIENT_FAILURE');
 v_result:=pg_temp.enqueue_guarded_missing_acts_20261108(true,10);
 IF (v_result->>'candidates')::int<>3 OR (SELECT count(*) FROM sync_retry_queue)<>1 THEN
   RAISE EXCEPTION 'dry run or eligibility failed: %',v_result;
 END IF;
 v_result:=pg_temp.enqueue_guarded_missing_acts_20261108(false,10);
 IF (v_result->>'enqueued')::int<>3 THEN RAISE EXCEPTION 'enqueue failed: %',v_result; END IF;
 IF NOT EXISTS(SELECT 1 FROM sync_retry_queue WHERE work_item_id='00000000-0000-4000-8000-000000000008'
   AND provider='samai' AND attempt=0) THEN RAISE EXCEPTION 'CPACA routing failed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM sync_retry_queue WHERE work_item_id='00000000-0000-4000-8000-000000000001'
   AND provider='cpnu' AND attempt=0) THEN RAISE EXCEPTION 'executive routing failed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM sync_retry_queue WHERE work_item_id='00000000-0000-4000-8000-000000000005'
   AND attempt=2) THEN RAISE EXCEPTION 'existing queue overwritten'; END IF;
 v_result:=pg_temp.enqueue_guarded_missing_acts_20261108(false,10);
 IF (v_result->>'enqueued')::int<>0 THEN RAISE EXCEPTION 'not idempotent'; END IF;
 INSERT INTO work_items
 SELECT ('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,org,'05001400301120260144800',
   'ACTIVO','EJECUTIVO',NULL,'ACTIVE',true FROM generate_series(1,15) i;
 v_result:=pg_temp.enqueue_guarded_missing_acts_20261108(false,10);
 IF (v_result->>'enqueued')::int<>7 THEN RAISE EXCEPTION 'daily cap failed: %',v_result; END IF;
 v_result:=pg_temp.enqueue_guarded_missing_acts_20261108(false,10);
 IF (v_result->>'enqueued')::int<>0 THEN RAISE EXCEPTION 'daily cap repeat failed'; END IF;
 BEGIN
   PERFORM pg_temp.enqueue_guarded_missing_acts_20261108(false,11);
   RAISE EXCEPTION 'invalid limit accepted';
 EXCEPTION WHEN raise_exception THEN
   IF SQLERRM<>'invalid queue options' THEN RAISE; END IF;
 END;
 RAISE NOTICE 'PASS: dry run, eligibility, privacy, admission, routing, existing queue, cooldown, idempotence, daily limit';
END
$test$;
ROLLBACK;
