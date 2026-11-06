-- Consume two already-complete CPNU snapshots through the normal authenticated
-- application caller. This never schedules a new provider extraction.
BEGIN;
CREATE TABLE IF NOT EXISTS public.cpnu_stored_consumer_acceptance_20261101(
 key text PRIMARY KEY,work_item_id uuid NOT NULL,before_acts jsonb NOT NULL,
 before_timeline jsonb,request_id bigint,recorded_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.cpnu_stored_consumer_acceptance_20261101 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cpnu_stored_consumer_acceptance_20261101 FROM PUBLIC,anon,authenticated,service_role;
DO $invoke$ DECLARE w record; req bigint; k text; BEGIN
 FOR w IN SELECT id,radicado FROM public.work_items WHERE id IN
  ('6ec08071-eb35-49d7-9264-778fcb070947','ab251e24-ebe4-4fde-9c47-792d8bcedbe3')
  AND lifecycle_state='ACTIVE' AND monitoring_enabled AND deleted_at IS NULL
  AND EXISTS(SELECT 1 FROM work_item_provider_enrollment e WHERE e.work_item_id=work_items.id
   AND e.provider_key='cpnu' AND e.scope='ACTS' AND e.enabled)
 LOOP
  k:='freshness:'||w.id;
  IF EXISTS(SELECT 1 FROM cpnu_stored_consumer_acceptance_20261101 WHERE key=k) THEN CONTINUE; END IF;
  INSERT INTO cpnu_stored_consumer_acceptance_20261101(key,work_item_id,before_acts,before_timeline)
  SELECT k,w.id,coalesce((SELECT jsonb_agg(jsonb_build_array(id,hash_fingerprint) ORDER BY id)
    FROM work_item_acts WHERE work_item_id=w.id),'[]'::jsonb),
    (SELECT to_jsonb(t) FROM work_item_sync_timeline t WHERE t.work_item_id=w.id AND operation='acts'
     AND status<>'rejected' ORDER BY started_at DESC LIMIT 1);
  SELECT net.http_post(url:=(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='SUPABASE_URL')||'/functions/v1/sync-by-work-item',
   headers:=jsonb_build_object('Content-Type','application/json','x-cron-key',
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='CRON_SERVICE_KEY')),
   body:=jsonb_build_object('work_item_id',w.id,'_scheduled',true,'allow_buscar',false,'force_refresh',false),
   timeout_milliseconds:=120000) INTO req;
  UPDATE cpnu_stored_consumer_acceptance_20261101 SET request_id=req WHERE key=k;
 END LOOP;
END $invoke$;
SELECT key,work_item_id,request_id FROM cpnu_stored_consumer_acceptance_20261101 ORDER BY key;
COMMIT;
