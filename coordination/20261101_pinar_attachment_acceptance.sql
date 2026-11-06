-- Bounded ordinary attachment worker: one owned work item, one file per call.
-- Run ordinal 1..3 sequentially, observing each response before the next.
BEGIN;
CREATE TABLE IF NOT EXISTS public.pinar_attachment_acceptance_20261101(
 ordinal int PRIMARY KEY CHECK(ordinal BETWEEN 1 AND 3),work_item_id uuid NOT NULL,
 request_id bigint NOT NULL,requested_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.pinar_attachment_acceptance_20261101 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pinar_attachment_acceptance_20261101 FROM PUBLIC,anon,authenticated,service_role;
DO $lock$ BEGIN PERFORM pg_advisory_xact_lock(19533,20261101); END $lock$;
INSERT INTO pinar_attachment_acceptance_20261101(ordinal,work_item_id,request_id)
SELECT :'ordinal'::int,w.id,net.http_post(
 url:=(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='SUPABASE_URL')||'/functions/v1/process-estado-attachments-queue',
 headers:=jsonb_build_object('Content-Type','application/json','x-cron-key',
 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='CRON_SERVICE_KEY')),
 body:=jsonb_build_object('work_item_ids',jsonb_build_array(w.id)),timeout_milliseconds:=60000)
FROM work_items w WHERE w.id='b422bbc4-23ca-4b18-9e7b-c2b067272cd2'::uuid
 AND w.radicado='66001418900120260088600' AND w.lifecycle_state='ACTIVE'
 AND w.monitoring_enabled AND w.deleted_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM pinar_attachment_acceptance_20261101 a WHERE a.ordinal=:'ordinal'::int)
 AND EXISTS(SELECT 1 FROM estado_attachment_queue q WHERE q.work_item_id=w.id
 AND q.status='pending' AND q.publicacion_id IN ('b842d174-a2cb-4734-8e12-4da98e7940ae','7554a90e-62cf-4a9d-8d5a-c0106903f10d'))
RETURNING ordinal,work_item_id,request_id;
COMMIT;
