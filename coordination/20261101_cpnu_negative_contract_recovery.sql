-- One cache-only re-read of six exactly identified technical 410 failures.
-- Run only after the CPNU_PROVIDER_NOT_FOUND consumer is published. This does
-- not assert successful source coverage or refresh the provider observation.
BEGIN;
CREATE TABLE IF NOT EXISTS public.monitor_cpnu_negative_recovery_20261101 (
 run_date date NOT NULL,work_item_id uuid NOT NULL,cycle_before jsonb NOT NULL,
 transport_epoch timestamptz NOT NULL DEFAULT pg_postmaster_start_time(),
 recovered_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(run_date,work_item_id)
);
ALTER TABLE public.monitor_cpnu_negative_recovery_20261101 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.monitor_cpnu_negative_recovery_20261101 FROM PUBLIC,anon,authenticated,service_role;
WITH expected(work_item_id,radicado,trace_id) AS (VALUES
 ('d9637e5c-5245-4fb5-99d5-fe4590db0015'::uuid,'05376408900120240055500','622af1df-a820-48c4-9a4a-eca7cd567e70'),
 ('a345f035-78f9-4144-9db5-752ef2c076c3'::uuid,'05376408900120250087200','5f903108-51c8-41bd-8713-3e9f5c62c49a'),
 ('7ca96425-2f80-4fc6-98e0-6be4133dcca0'::uuid,'05376408900220250066300','6ef42e65-50e9-45d1-8f62-f0cfef18f006'),
 ('313c4af5-fc9d-4f1e-8182-d42250781128'::uuid,'05607408900120250017100','e0405da8-cc32-4a8f-921b-11456e5ae44d'),
 ('5dd8f2fd-2629-4e09-b167-b413ba1a28fc'::uuid,'05607408900120260014900','7f27f1e7-b46a-4c01-8f77-8728a532b727'),
 ('c10fe9e6-78f8-4a82-8622-cac9ec81775f'::uuid,'05607408900120260045600','ad066eb3-e005-4e96-9f36-c5e5e5204f60')
), eligible AS (
 SELECT d.* FROM public.daily_update_cycles d
 JOIN expected x ON x.work_item_id=d.work_item_id
 JOIN public.work_items w ON w.id=d.work_item_id AND w.radicado=x.radicado
 WHERE d.run_date='2026-10-31' AND d.channels->'acts'->>'status'='FAILED'
  AND d.channels->'acts'->>'error_code'='PROVIDER_ERROR'
  AND d.channels->'acts'->>'trace_id'=x.trace_id
  AND w.monitoring_enabled IS TRUE AND w.lifecycle_state='ACTIVE' AND w.deleted_at IS NULL
  AND EXISTS(SELECT 1 FROM public.work_item_provider_enrollment e WHERE e.work_item_id=w.id
    AND e.provider_key='cpnu' AND e.scope='ACTS' AND e.enabled IS TRUE)
  AND EXISTS(SELECT 1 FROM public.sync_traces t WHERE t.trace_id::text=x.trace_id
    AND t.work_item_id=w.id AND t.step='SYNC_FAILED' AND t.http_status=410
    AND t.message='CPNU: UPSTREAM_HTTP_410')
  AND NOT EXISTS(SELECT 1 FROM public.monitor_cpnu_negative_recovery_20261101 a
    WHERE a.work_item_id=d.work_item_id AND a.run_date=d.run_date)
 FOR UPDATE OF d
), audited AS (
 INSERT INTO public.monitor_cpnu_negative_recovery_20261101(run_date,work_item_id,cycle_before)
 SELECT run_date,work_item_id,to_jsonb(eligible) FROM eligible
 ON CONFLICT DO NOTHING RETURNING run_date,work_item_id
), recovered AS (
 UPDATE public.daily_update_cycles d SET
  channels=jsonb_set(d.channels-'acts',ARRAY['acts_before_negative_contract_20261101'],d.channels->'acts'),
  continuations=d.continuations+1,updated_at=now()
 FROM audited a WHERE d.work_item_id=a.work_item_id AND d.run_date=a.run_date
 RETURNING d.work_item_id
)
SELECT work_item_id,pg_postmaster_start_time() AS transport_epoch,net.http_post(
 url:=(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='SUPABASE_URL')||'/functions/v1/sync-by-work-item',
 headers:=jsonb_build_object('Content-Type','application/json','x-cron-key',
  (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='CRON_SERVICE_KEY'),
  'x-invoker-function','cpnu-negative-contract-recovery-20261101'),
 body:=jsonb_build_object('work_item_id',work_item_id,'_scheduled',true,'allow_buscar',false,'force_refresh',false),
 timeout_milliseconds:=180000) AS request_id FROM recovered;
COMMIT;
