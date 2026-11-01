-- Controlled replay of two already certified, exact current-day PP readers.
-- Retains every gate counter, publication, fingerprint and attachment.
-- No POST to the judicial provider: the normal function follows these run IDs.
BEGIN;
CREATE TABLE IF NOT EXISTS public.pp_uuid_acceptance_20261101(
 work_item_id uuid PRIMARY KEY,backend_run_id uuid NOT NULL,gate_before jsonb NOT NULL,
 publication_ids_before jsonb NOT NULL,association_ids_before jsonb NOT NULL,
 accepted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pp_uuid_acceptance_20261101 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pp_uuid_acceptance_20261101 FROM PUBLIC,anon,authenticated,service_role;
WITH expected(work_item_id,radicado,backend_run_id) AS (VALUES
 ('db1b4198-b0ac-453d-98b5-44525f58bf23'::uuid,'05376311200120261033300','d6603a03-e416-4b8c-b488-c0b694cca95f'::uuid),
 ('13ee216e-8279-4224-850a-a332d97a2e5b'::uuid,'05376311200120230031400','586957fa-01bf-4333-b91b-78dfa6c3e659'::uuid)
), eligible AS (
 SELECT w.id AS work_item_id,x.backend_run_id,to_jsonb(c) AS gate_before,
  coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'hash',p.hash_fingerprint) ORDER BY p.id)
    FROM work_item_publicaciones p WHERE p.work_item_id=w.id),'[]') AS publications,
  coalesce((SELECT jsonb_agg(q.id ORDER BY q.id) FROM estado_attachment_queue q WHERE q.work_item_id=w.id),'[]') AS associations
 FROM expected x JOIN work_items w ON w.id=x.work_item_id AND w.radicado=x.radicado
 JOIN cron_state c ON c.key='pub_rescrape:'||w.id::text
 WHERE w.lifecycle_state='ACTIVE' AND w.monitoring_enabled IS TRUE AND w.deleted_at IS NULL
  AND c.value->>'backend_run_id'=x.backend_run_id::text
  AND c.value->>'followup_closed'='true'
  AND EXISTS(SELECT 1 FROM work_item_provider_enrollment e WHERE e.work_item_id=w.id
   AND e.provider_key='publicaciones' AND e.scope='PUBS' AND e.enabled IS TRUE)
  AND NOT EXISTS(SELECT 1 FROM pp_uuid_acceptance_20261101 a WHERE a.work_item_id=w.id)
 FOR UPDATE OF c
), audited AS (
 INSERT INTO pp_uuid_acceptance_20261101(work_item_id,backend_run_id,gate_before,publication_ids_before,association_ids_before)
 SELECT work_item_id,backend_run_id,gate_before,publications,associations FROM eligible
 ON CONFLICT DO NOTHING RETURNING work_item_id,backend_run_id
), opened AS (
 UPDATE cron_state c SET value=c.value||jsonb_build_object('followup_closed',false,
  'next_poll_at',now(),'uuid_acceptance_replay_at',now()),updated_at=now()
 FROM audited a WHERE c.key='pub_rescrape:'||a.work_item_id::text
  AND c.value->>'backend_run_id'=a.backend_run_id::text RETURNING a.work_item_id
)
SELECT work_item_id,pg_postmaster_start_time() AS transport_epoch,net.http_post(
 url:=(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='SUPABASE_URL')||'/functions/v1/sync-publicaciones-by-work-item',
 headers:=jsonb_build_object('Content-Type','application/json','x-cron-key',
  (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='CRON_SERVICE_KEY'),
  'x-invoker-function','uuid-receipt-acceptance-20261101'),
 body:=jsonb_build_object('work_item_id',work_item_id,'_scheduled',true),
 timeout_milliseconds:=180000) AS request_id FROM opened;
COMMIT;
