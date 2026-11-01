-- Backend UUIDs below were independently re-read as COMPLETA after6470ed6.
-- Reopen only their readers, not their source jobs. Preserve monitor attempts,
-- source admission time, poll count, publications, hashes and associations.
BEGIN;
CREATE TABLE IF NOT EXISTS public.pp_laboral_consumer_resume_20261101(
 work_item_id uuid PRIMARY KEY,backend_run_id uuid NOT NULL,item_before jsonb NOT NULL,
 gate_before jsonb NOT NULL,publications_before jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.pp_laboral_consumer_resume_20261101 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pp_laboral_consumer_resume_20261101 FROM PUBLIC,anon,authenticated,service_role;
WITH expected(work_item_id,radicado,backend_run_id) AS (VALUES
 ('3acb1a72-2f74-4627-be5d-5eea6c9dc1cc'::uuid,'05001400500620260049900','a0ead2c2-9751-4f0b-87f3-cf267a4317c8'::uuid),
 ('b2f9f64e-cc1c-49cc-91a9-0d5bf42bf7e7'::uuid,'05001400501320260003600','c5d050be-4248-4557-b198-8bf5eaf7abab'::uuid)
), eligible AS (
 SELECT i.*,x.backend_run_id,to_jsonb(c) AS gate_before FROM expected x
 JOIN work_items w ON w.id=x.work_item_id AND w.radicado=x.radicado
 JOIN estados_monitor_run_items i ON i.work_item_id=w.id
 JOIN estados_monitor_runs r ON r.id=i.run_id AND r.channel='publicaciones' AND r.run_date='2026-11-01'
 JOIN cron_state c ON c.key='pub_rescrape:'||w.id::text
 WHERE w.lifecycle_state='ACTIVE' AND w.monitoring_enabled AND w.deleted_at IS NULL
 AND i.status='FAILED' AND i.attempts=2 AND i.error_code='PROVIDER_UNAVAILABLE'
 AND c.value->>'backend_run_id'=x.backend_run_id::text AND c.value->>'last_poll_estado'='PARCIAL'
 AND EXISTS(SELECT 1 FROM work_item_provider_enrollment e WHERE e.work_item_id=w.id
  AND e.provider_key='publicaciones' AND e.scope='PUBS' AND e.enabled)
 FOR UPDATE OF i,c
), audited AS (
 INSERT INTO pp_laboral_consumer_resume_20261101(work_item_id,backend_run_id,item_before,gate_before,publications_before)
 SELECT work_item_id,backend_run_id,to_jsonb(e)-'gate_before'-'backend_run_id',gate_before,
 coalesce((SELECT jsonb_agg(jsonb_build_array(p.id,p.hash_fingerprint) ORDER BY p.id)
  FROM work_item_publicaciones p WHERE p.work_item_id=e.work_item_id),'[]') FROM eligible e
 ON CONFLICT DO NOTHING RETURNING work_item_id,item_before
), opened AS (
 UPDATE cron_state c SET value=value||jsonb_build_object('followup_closed',false,'next_poll_at',now()),updated_at=now()
 FROM audited a WHERE c.key='pub_rescrape:'||a.work_item_id::text RETURNING a.work_item_id
)
SELECT work_item_id FROM opened;
-- A separate statement sees audit rows inserted by the CTE above, and also
-- safely completes a recovery interrupted after reopening the reader gate.
UPDATE estados_monitor_run_items i SET status='PENDING',next_attempt_at=now(),claimed_at=NULL,lease_token=NULL,
 finished_at=NULL FROM pp_laboral_consumer_resume_20261101 a WHERE i.work_item_id=a.work_item_id
 AND i.run_id=(a.item_before->>'run_id')::uuid AND i.status='FAILED' AND i.attempts=2
 AND i.error_code='PROVIDER_UNAVAILABLE'
RETURNING i.run_id,i.work_item_id,i.status,i.attempts;
COMMIT;
