-- Scoped recovery of five consumers interrupted by the observed 13:37 DB
-- restart. Retain the prior admission; rotate the fence via normal admission.
-- No judicial rows, provider clocks or retry counters are changed.
BEGIN;
CREATE TABLE IF NOT EXISTS public.samai_interrupted_admission_20261101(
 work_item_id uuid PRIMARY KEY,run_date date NOT NULL,channels_before jsonb NOT NULL,
 transport_epoch timestamptz NOT NULL,recovered_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.samai_interrupted_admission_20261101 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.samai_interrupted_admission_20261101 FROM PUBLIC,anon,authenticated,service_role;
WITH candidates AS (
 SELECT c.work_item_id,c.run_date,c.channels
 FROM daily_update_cycles c JOIN samai_delivery_acceptance_20261101 a USING(work_item_id)
 JOIN work_items w ON w.id=c.work_item_id AND w.radicado=a.radicado
 WHERE c.run_date=(now() AT TIME ZONE 'America/Bogota')::date
 AND w.lifecycle_state='ACTIVE' AND w.monitoring_enabled AND w.deleted_at IS NULL
 AND c.channels->'acts'->>'status'='STARTED'
 AND c.channels->'acts'->>'invoker'='fresh-samai-delivery-acceptance-20261101'
 AND (c.channels->'acts'->>'started_at')::timestamptz BETWEEN a.admitted_at AND pg_postmaster_start_time()
 AND (c.channels->'acts'->>'started_at')::timestamptz<now()-interval '20 minutes'
 AND a.source_read_at>now()-interval '24 hours'
 AND EXISTS(SELECT 1 FROM work_item_provider_enrollment e WHERE e.work_item_id=w.id
 AND e.provider_key='samai' AND e.enabled AND e.scope='ACTS')
 AND NOT EXISTS(SELECT 1 FROM work_item_sync_timeline t WHERE t.work_item_id=w.id
 AND t.operation='acts' AND t.provider='samai' AND t.started_at>=a.admitted_at)
 AND NOT EXISTS(SELECT 1 FROM atenia_ai_remediation_queue q WHERE q.work_item_id=w.id
 AND q.action_type='RETRY_ACTS' AND q.status='RUNNING')
 FOR UPDATE OF c
), audited AS (
 INSERT INTO samai_interrupted_admission_20261101(work_item_id,run_date,channels_before,transport_epoch)
 SELECT work_item_id,run_date,channels,pg_postmaster_start_time() FROM candidates
 ON CONFLICT DO NOTHING RETURNING work_item_id,run_date
)
UPDATE daily_update_cycles c SET channels=(c.channels-'acts')||jsonb_build_object(
 'acts_interrupted',jsonb_build_object('status','FAILED','error_code','DELIVERY_INTERRUPTED_BY_DB_RESTART',
 'interrupted_attempt',(c.channels->'acts')-'token','finished_at',now())),updated_at=now()
FROM audited a WHERE c.work_item_id=a.work_item_id AND c.run_date=a.run_date
RETURNING c.work_item_id,c.run_date;
COMMIT;
