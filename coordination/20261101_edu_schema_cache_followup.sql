-- One cache-only follow-up of the demonstrated PostgREST schema-cache failure.
-- No provider refresh, retry counter reset or hearing/judicial data repair.
BEGIN;
WITH eligible AS (
 SELECT d.work_item_id,to_jsonb(d) AS cycle_now
 FROM daily_update_cycles d
 JOIN work_items w ON w.id=d.work_item_id
 JOIN monitor_effect_recheck_20261101 a ON a.work_item_id=w.id
 WHERE w.id='e4e761ac-9984-462d-ae6e-a25b244f79ea'
  AND w.radicado='05001333301020230019900'
  AND w.lifecycle_state='ACTIVE' AND w.monitoring_enabled IS TRUE AND w.deleted_at IS NULL
  AND d.run_date='2026-10-31'
  AND d.channels->'acts'->>'status'='PARTIAL'
  AND d.channels->'acts'->>'error_code'='PERSISTENCE_FAILED'
  AND d.channels->'acts'->>'trace_id'='ae9774a4-8375-44c0-bb04-a1eaf9702ddc'
  AND NOT (a.cycle_before ? 'schema_cache_followup')
  AND EXISTS(SELECT 1 FROM work_item_provider_enrollment e WHERE e.work_item_id=w.id
    AND e.provider_key='samai' AND e.scope='ACTS' AND e.enabled IS TRUE)
  AND EXISTS(SELECT 1 FROM net._http_response r WHERE r.id=240 AND r.status_code=500
    AND r.created>='2026-11-01T01:10:00Z' AND r.created<'2026-11-01T01:15:00Z'
    AND r.content::jsonb->'persistence_summary'->'outcomes' @>
    '[{"bucket":"ERROR","fingerprint":"wi_e4e761ac_1ffd535075b83e1a","reason":"enrichment fresh read failed: Could not query the database for the schema cache. Retrying."}]'::jsonb)
 FOR UPDATE OF d,a
), audited AS (
 UPDATE monitor_effect_recheck_20261101 a SET cycle_before=a.cycle_before||
  jsonb_build_object('schema_cache_followup',jsonb_build_object('at',now(),'before',e.cycle_now,
    'reason','PGRST_SCHEMA_CACHE_TRANSIENT','previous_http_request',240))
 FROM eligible e WHERE a.work_item_id=e.work_item_id RETURNING a.work_item_id
), recovered AS (
 UPDATE daily_update_cycles d SET channels=jsonb_set(d.channels-'acts',
  ARRAY['acts_before_schema_cache_followup_20261101'],d.channels->'acts'),
  continuations=d.continuations+1,updated_at=now()
 FROM audited a WHERE d.work_item_id=a.work_item_id AND d.run_date='2026-10-31'
 RETURNING d.work_item_id
)
SELECT work_item_id,pg_postmaster_start_time() AS transport_epoch,net.http_post(
 url:=(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='SUPABASE_URL')||'/functions/v1/sync-by-work-item',
 headers:=jsonb_build_object('Content-Type','application/json','x-cron-key',
  (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='CRON_SERVICE_KEY'),
  'x-invoker-function','edu-schema-cache-followup-20261101'),
 body:=jsonb_build_object('work_item_id',work_item_id,'_scheduled',true,'allow_buscar',false,'force_refresh',false),
 timeout_milliseconds:=180000) AS request_id FROM recovered;
COMMIT;
