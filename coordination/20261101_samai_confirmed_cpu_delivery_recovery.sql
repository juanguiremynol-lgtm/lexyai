-- Exactly one terminal Edge CPU failure, after publishing its code correction.
-- The normal function, its admission and its expected-value writes remain used.
BEGIN;
CREATE TABLE IF NOT EXISTS public.samai_cpu_delivery_recovery_20261101(
 work_item_id uuid PRIMARY KEY,run_date date NOT NULL,channels_before jsonb NOT NULL,
 failed_request_id bigint NOT NULL,transport_epoch timestamptz NOT NULL,
 recovered_at timestamptz NOT NULL DEFAULT now(),request_id bigint);
ALTER TABLE public.samai_cpu_delivery_recovery_20261101 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.samai_cpu_delivery_recovery_20261101 FROM PUBLIC,anon,authenticated,service_role;
WITH checked AS (
 SELECT c.work_item_id,c.run_date,c.channels,a.request_id
 FROM daily_update_cycles c JOIN samai_interrupted_admission_20261101 a USING(work_item_id)
 JOIN samai_delivery_acceptance_20261101 certified USING(work_item_id)
 JOIN net._http_response response ON response.id=a.request_id
 WHERE c.work_item_id='2a590db7-0330-4b8d-9403-5963e4bd15a1'::uuid
 AND a.request_id=21 AND response.status_code=546
 AND response.content::jsonb->>'code'='WORKER_RESOURCE_LIMIT'
 AND pg_postmaster_start_time()='2026-11-01T13:37:57.428452Z'::timestamptz
 AND c.run_date=(now() AT TIME ZONE 'America/Bogota')::date
 AND c.channels->'acts'->>'status'='STARTED'
 AND c.channels->'acts'->>'invoker'='recovered-samai-delivery-20261101'
 AND certified.source_read_at>now()-interval '24 hours'
 AND NOT EXISTS(SELECT 1 FROM work_item_sync_timeline t WHERE t.work_item_id=c.work_item_id
 AND t.operation='acts' AND t.provider='samai'
 AND t.started_at>=(c.channels->'acts'->>'started_at')::timestamptz)
 AND NOT EXISTS(SELECT 1 FROM atenia_ai_remediation_queue q WHERE q.work_item_id=c.work_item_id
 AND q.action_type='RETRY_ACTS' AND q.status='RUNNING')
 FOR UPDATE OF c
), backed AS (
 INSERT INTO samai_cpu_delivery_recovery_20261101(work_item_id,run_date,channels_before,failed_request_id,transport_epoch)
 SELECT work_item_id,run_date,channels,request_id,pg_postmaster_start_time() FROM checked
 ON CONFLICT DO NOTHING RETURNING work_item_id,run_date
)
UPDATE daily_update_cycles c SET channels=(c.channels-'acts')||jsonb_build_object(
 'acts_resource_failed',jsonb_build_object('status','FAILED','error_code','VERIFIED_EDGE_CPU_LIMIT',
 'interrupted_attempt',(c.channels->'acts')-'token','finished_at',now())),updated_at=now()
FROM backed b WHERE c.work_item_id=b.work_item_id AND c.run_date=b.run_date;
-- Separate statement: newly inserted audit rows must be visible to this UPDATE.
UPDATE samai_cpu_delivery_recovery_20261101 a SET request_id=net.http_post(
 url:=(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='SUPABASE_URL')||'/functions/v1/sync-by-work-item',
 headers:=jsonb_build_object('Content-Type','application/json','x-cron-key',
 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='CRON_SERVICE_KEY'),
 'x-invoker-function','cpu-corrected-samai-delivery-20261101'),
 body:=jsonb_build_object('work_item_id',a.work_item_id,'force_refresh',false,'_scheduled',true),
 timeout_milliseconds:=180000)
WHERE a.request_id IS NULL AND a.work_item_id='2a590db7-0330-4b8d-9403-5963e4bd15a1'::uuid
RETURNING a.work_item_id,a.request_id;
COMMIT;
