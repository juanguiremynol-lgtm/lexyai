-- psql: set selected_work_item_id to one of the five recovered admissions.
-- Execute one row, observe its response and persisted result, then the next.
BEGIN;
ALTER TABLE samai_interrupted_admission_20261101
 ADD COLUMN IF NOT EXISTS request_id bigint,
 ADD COLUMN IF NOT EXISTS requested_at timestamptz;
UPDATE samai_interrupted_admission_20261101 a
SET requested_at=now(),request_id=net.http_post(
 url:=(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='SUPABASE_URL')||'/functions/v1/sync-by-work-item',
 headers:=jsonb_build_object('Content-Type','application/json','x-cron-key',
 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='CRON_SERVICE_KEY'),
 'x-invoker-function','recovered-samai-delivery-20261101'),
 body:=jsonb_build_object('work_item_id',a.work_item_id,'force_refresh',false,'_scheduled',true),
 timeout_milliseconds:=180000)
WHERE a.work_item_id=:'selected_work_item_id'::uuid AND a.request_id IS NULL
AND EXISTS(SELECT 1 FROM work_items w WHERE w.id=a.work_item_id AND w.lifecycle_state='ACTIVE'
 AND w.monitoring_enabled AND w.deleted_at IS NULL)
AND NOT EXISTS(SELECT 1 FROM atenia_ai_remediation_queue q WHERE q.work_item_id=a.work_item_id
 AND q.action_type='RETRY_ACTS' AND q.status='RUNNING')
RETURNING a.work_item_id,a.request_id;
COMMIT;
