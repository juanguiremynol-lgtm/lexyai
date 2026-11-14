-- Nine exact, retained INVALID EMPTY failures. No source refresh.
-- Publish the valid-empty and CPNU semantic fixes before applying.
BEGIN;
CREATE TABLE IF NOT EXISTS public.monitor_cpnu_enum_recovery_20261101 (
 run_date date NOT NULL,work_item_id uuid NOT NULL,cycle_before jsonb NOT NULL,
 transport_epoch timestamptz NOT NULL DEFAULT pg_postmaster_start_time(),
 recovered_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(run_date,work_item_id)
);
ALTER TABLE public.monitor_cpnu_enum_recovery_20261101 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.monitor_cpnu_enum_recovery_20261101 FROM PUBLIC,anon,authenticated,service_role;
WITH expected(work_item_id,radicado,trace_id) AS (VALUES
('c3912ba4-0f1b-434b-9d9c-e40c372cd1e8'::uuid,'05001400301420260152800','c38368ba-115d-41f8-8189-7f5d2b10be37'),
('d9637e5c-5245-4fb5-99d5-fe4590db0015'::uuid,'05376408900120240055500','ff057025-3b4c-4086-8e4f-39c0a15d528d'),
('a345f035-78f9-4144-9db5-752ef2c076c3'::uuid,'05376408900120250087200','0318ebab-da70-4083-8d36-2aa5a9553403'),
('7ca96425-2f80-4fc6-98e0-6be4133dcca0'::uuid,'05376408900220250066300','f28710d4-b41d-4d73-8d29-343678aab765'),
('313c4af5-fc9d-4f1e-8182-d42250781128'::uuid,'05607408900120250017100','db2cf39e-577c-46df-99c8-9b3328ebc496'),
('5dd8f2fd-2629-4e09-b167-b413ba1a28fc'::uuid,'05607408900120260014900','708ff743-02ac-40b6-8c04-29f986d9ad2b'),
('c10fe9e6-78f8-4a82-8622-cac9ec81775f'::uuid,'05607408900120260045600','ab011437-0c5e-4f8c-a671-e54a6e4f7710'),
('f27e2442-07b5-4b7f-8448-c398d9fee9cf'::uuid,'08001405300620260071100','ee4d9ef0-7609-426f-8348-93a29421de82'),
('38e11e53-009a-4f9b-8a1b-f9986c970f1e'::uuid,'08001405301420240080600','cb02d4b7-4271-49e5-8558-6916a3e237d2')
), eligible AS (
 SELECT d.* FROM public.daily_update_cycles d
 JOIN expected x ON x.work_item_id=d.work_item_id
 JOIN public.work_items w ON w.id=d.work_item_id AND w.radicado=x.radicado
 WHERE d.run_date='2026-10-31' AND d.channels->'acts'->>'status'='FAILED'
  AND d.channels->'acts'->>'error_code'='INTERNAL_ERROR'
  AND d.channels->'acts'->>'trace_id'=x.trace_id
  AND w.monitoring_enabled IS TRUE AND w.lifecycle_state='ACTIVE' AND w.deleted_at IS NULL
  AND EXISTS(SELECT 1 FROM public.work_item_provider_enrollment e
    WHERE e.work_item_id=w.id AND e.provider_key='cpnu' AND e.scope='ACTS' AND e.enabled IS TRUE)
  AND EXISTS(SELECT 1 FROM public.sync_traces t WHERE t.trace_id::text=x.trace_id
    AND t.work_item_id=w.id AND t.error_code='INTERNAL_ERROR'
    AND t.message LIKE '%invalid input value for enum scrape_status: "EMPTY"%')
  AND NOT EXISTS(SELECT 1 FROM public.monitor_cpnu_enum_recovery_20261101 a
    WHERE a.work_item_id=d.work_item_id AND a.run_date=d.run_date)
 FOR UPDATE OF d
), audited AS (
 INSERT INTO public.monitor_cpnu_enum_recovery_20261101(run_date,work_item_id,cycle_before)
 SELECT run_date,work_item_id,to_jsonb(eligible) FROM eligible
 ON CONFLICT DO NOTHING RETURNING run_date,work_item_id
), recovered AS (
 UPDATE public.daily_update_cycles d SET
  channels=jsonb_set(d.channels-'acts',ARRAY['acts_before_empty_enum_20261101'],d.channels->'acts'),
  continuations=d.continuations+1,updated_at=now()
 FROM audited a WHERE d.work_item_id=a.work_item_id AND d.run_date=a.run_date
 RETURNING d.work_item_id
)
SELECT work_item_id,pg_postmaster_start_time() AS transport_epoch,net.http_post(
 url:=(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='SUPABASE_URL')||'/functions/v1/sync-by-work-item',
 headers:=jsonb_build_object('Content-Type','application/json','x-cron-key',
  (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='CRON_SERVICE_KEY'),
  'x-invoker-function','cpnu-enum-semantic-recovery-20261101'),
 body:=jsonb_build_object('work_item_id',work_item_id,'_scheduled',true,'allow_buscar',false,'force_refresh',false),
 timeout_milliseconds:=180000) AS request_id FROM recovered;
COMMIT;
