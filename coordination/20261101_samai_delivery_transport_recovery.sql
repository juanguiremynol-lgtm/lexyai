-- Only the five accepted consumers lost across a demonstrated DB restart.
-- Bound to two replacement epochs; the normal daily admission remains active.
BEGIN;
CREATE TABLE IF NOT EXISTS public.samai_delivery_transport_20261101(
 work_item_id uuid NOT NULL,transport_epoch timestamptz NOT NULL,
 prior_admission timestamptz NOT NULL,reason text NOT NULL,request_id bigint,
 replayed_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(work_item_id,transport_epoch));
ALTER TABLE public.samai_delivery_transport_20261101 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.samai_delivery_transport_20261101 FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO samai_delivery_transport_20261101(work_item_id,transport_epoch,prior_admission,reason)
 SELECT a.work_item_id,pg_postmaster_start_time(),a.admitted_at,'TRANSPORT_RESTART_AFTER_ADMISSION'
 FROM samai_delivery_acceptance_20261101 a JOIN work_items w ON w.id=a.work_item_id AND w.radicado=a.radicado
 WHERE a.admitted_at<pg_postmaster_start_time()
 AND w.lifecycle_state='ACTIVE' AND w.monitoring_enabled AND w.deleted_at IS NULL
 AND a.source_read_at>now()-interval '24 hours'
 AND (SELECT count(*) FROM samai_delivery_transport_20261101 r WHERE r.work_item_id=a.work_item_id)<2
 AND NOT EXISTS(SELECT 1 FROM work_item_sync_timeline t WHERE t.work_item_id=a.work_item_id
 AND t.operation='acts' AND t.provider='samai' AND t.started_at>=a.admitted_at)
 AND NOT EXISTS(SELECT 1 FROM atenia_ai_remediation_queue q WHERE q.work_item_id=a.work_item_id
 AND q.action_type='RETRY_ACTS' AND q.status='RUNNING')
 ON CONFLICT DO NOTHING;
-- A second statement sees rows inserted above; a data-modifying CTE cannot
-- UPDATE the same newly inserted row through its original command snapshot.
UPDATE samai_delivery_transport_20261101 a SET request_id=net.http_post(
 url:=(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='SUPABASE_URL')||'/functions/v1/sync-by-work-item',
 headers:=jsonb_build_object('Content-Type','application/json','x-cron-key',
 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='CRON_SERVICE_KEY'),
 'x-invoker-function','fresh-samai-delivery-transport-20261101'),
 body:=jsonb_build_object('work_item_id',a.work_item_id,'force_refresh',false,'_scheduled',true),
 timeout_milliseconds:=180000)
WHERE a.transport_epoch=pg_postmaster_start_time() AND a.request_id IS NULL
AND NOT EXISTS(SELECT 1 FROM work_item_sync_timeline t WHERE t.work_item_id=a.work_item_id
 AND t.operation='acts' AND t.provider='samai' AND t.started_at>=a.prior_admission)
AND NOT EXISTS(SELECT 1 FROM atenia_ai_remediation_queue q WHERE q.work_item_id=a.work_item_id
 AND q.action_type='RETRY_ACTS' AND q.status='RUNNING')
RETURNING a.work_item_id,a.request_id,a.transport_epoch;
COMMIT;
