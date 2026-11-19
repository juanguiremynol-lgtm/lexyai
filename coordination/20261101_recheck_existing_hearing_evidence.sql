-- Cache-only ingestion regression of two complete-source/partial-effect reads.
-- Existing explicit hearing evidence is reused only for the same act ID.
-- No agenda, term, alert or judicial identity is repaired by this SQL.
BEGIN;
CREATE TABLE IF NOT EXISTS public.monitor_effect_recheck_20261101(
 work_item_id uuid PRIMARY KEY,cycle_before jsonb NOT NULL,
 recovered_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.monitor_effect_recheck_20261101 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.monitor_effect_recheck_20261101 FROM PUBLIC,anon,authenticated,service_role;
WITH expected(work_item_id,radicado,trace_id,provider_key) AS (VALUES
 ('e4e761ac-9984-462d-ae6e-a25b244f79ea'::uuid,'05001333301020230019900','68f875ef-1dab-4529-ac92-d9c38096e89e','samai'),
 ('7b038fac-f82a-4619-8c10-fe1fe22b8d57'::uuid,'05001400301120240210000','1f2d0b5b-691b-4315-946b-b9403b7e5237','cpnu')
), eligible AS (
 SELECT d.* FROM daily_update_cycles d JOIN expected x ON x.work_item_id=d.work_item_id
 JOIN work_items w ON w.id=d.work_item_id AND w.radicado=x.radicado
 WHERE d.run_date='2026-10-31' AND d.channels->'acts'->>'status'='PARTIAL'
  AND d.channels->'acts'->>'error_code'='POST_INGEST_EFFECTS_PENDING'
  AND d.channels->'acts'->>'trace_id'=x.trace_id
  AND w.lifecycle_state='ACTIVE' AND w.monitoring_enabled IS TRUE AND w.deleted_at IS NULL
  AND EXISTS(SELECT 1 FROM work_item_provider_enrollment e WHERE e.work_item_id=w.id
    AND e.provider_key=x.provider_key AND e.scope='ACTS' AND e.enabled IS TRUE)
  AND NOT EXISTS(SELECT 1 FROM monitor_effect_recheck_20261101 a WHERE a.work_item_id=w.id)
 FOR UPDATE OF d
), audited AS (
 INSERT INTO monitor_effect_recheck_20261101(work_item_id,cycle_before)
 SELECT work_item_id,to_jsonb(eligible) FROM eligible ON CONFLICT DO NOTHING RETURNING work_item_id
), recovered AS (
 UPDATE daily_update_cycles d SET channels=jsonb_set(d.channels-'acts',
  ARRAY['acts_before_effect_evidence_20261101'],d.channels->'acts'),continuations=d.continuations+1,updated_at=now()
 FROM audited a WHERE d.work_item_id=a.work_item_id AND d.run_date='2026-10-31' RETURNING d.work_item_id
)
SELECT work_item_id,pg_postmaster_start_time() AS transport_epoch,net.http_post(
 url:=(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='SUPABASE_URL')||'/functions/v1/sync-by-work-item',
 headers:=jsonb_build_object('Content-Type','application/json','x-cron-key',
  (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='CRON_SERVICE_KEY'),
  'x-invoker-function','existing-hearing-evidence-recheck-20261101'),
 body:=jsonb_build_object('work_item_id',work_item_id,'_scheduled',true,'allow_buscar',false,'force_refresh',false),
 timeout_milliseconds:=180000) AS request_id FROM recovered;
COMMIT;
