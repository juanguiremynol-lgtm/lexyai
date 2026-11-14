-- One follow-up of the same committed reader after backend cc39699 adds
-- original/page bindings to separately identified derivative documents.
-- No source POST, retry reset, judicial data update or new daily admission.
BEGIN;
WITH eligible AS (
 SELECT c.key,to_jsonb(c) AS gate_before,a.run_id,a.work_item_id
 FROM cron_state c JOIN monitor_pp_reader_recovery_20261101 a
   ON c.key='pub_rescrape:'||a.work_item_id::text
 WHERE a.work_item_id='75b1625c-69e4-40f7-849f-63f6a9b775e6'
   AND c.value->>'backend_run_id'='1eddbd28-202a-4f94-b7be-260705f7858a'
   AND c.value->>'followup_closed'='true'
   AND NOT (a.gate_before ? 'derived_binding_followup')
 FOR UPDATE OF a,c
), audited AS (
 UPDATE monitor_pp_reader_recovery_20261101 a
 SET gate_before=a.gate_before||jsonb_build_object('derived_binding_followup',
    jsonb_build_object('gate_before',e.gate_before,'at',now(),'source','cc39699'))
 FROM eligible e WHERE a.run_id=e.run_id AND a.work_item_id=e.work_item_id
 RETURNING a.work_item_id
), continued AS (
 UPDATE cron_state c SET value=c.value||jsonb_build_object('followup_closed',false,
   'next_poll_at',now(),'derived_binding_followup_at',now()),updated_at=now()
 FROM audited a WHERE c.key='pub_rescrape:'||a.work_item_id::text RETURNING a.work_item_id
)
SELECT work_item_id,pg_postmaster_start_time() AS transport_epoch,net.http_post(
 url:=(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='SUPABASE_URL')||'/functions/v1/sync-publicaciones-by-work-item',
 headers:=jsonb_build_object('Content-Type','application/json','x-cron-key',
  (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='CRON_SERVICE_KEY'),
  'x-invoker-function','amaga-derived-binding-followup-20261101'),
 body:=jsonb_build_object('work_item_id',work_item_id,'_scheduled',true),timeout_milliseconds:=180000) AS request_id
FROM continued;
COMMIT;
