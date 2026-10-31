-- One exact active case: a later complete native read has one process, no
-- actuaciones, restringido=false, detalleCompleto=true, and no provider errors.
-- Native run6583 was verified before this release. Do not infer why the old
-- 06:00 INTERNAL_ERROR occurred or change its retained history to success.
BEGIN;
CREATE TABLE IF NOT EXISTS public.monitor_cpnu_empty_backup_20261031 AS
 SELECT d.* FROM public.daily_update_cycles d
 WHERE d.work_item_id='3acb1a72-2f74-4627-be5d-5eea6c9dc1cc' AND d.run_date='2026-10-31';
ALTER TABLE public.monitor_cpnu_empty_backup_20261031 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.monitor_cpnu_empty_backup_20261031 FROM PUBLIC,anon,authenticated,service_role;
WITH recovered AS (
 UPDATE public.daily_update_cycles d SET
 channels=(d.channels-'acts')||jsonb_build_object('acts_prior_empty_snapshot_failure',
   ((d.channels->'acts')-'token')||jsonb_build_object('outcome','PRIOR_FAILURE_CAUSE_UNDETERMINED',
     'recovery_reason','LATER_COMPLETE_EMPTY_SOURCE_SNAPSHOT','native_source_run_id',6583,
     'native_source_observed_at','2026-10-31T07:17:35.192Z','recovery_authorized_at',now())),
 continuations=d.continuations+1,updated_at=now()
 WHERE d.work_item_id='3acb1a72-2f74-4627-be5d-5eea6c9dc1cc' AND d.run_date='2026-10-31'
   AND d.channels->'acts'->>'status'='FAILED' AND d.channels->'acts'->>'error_code'='INTERNAL_ERROR'
   AND d.channels->'acts'->>'trace_id'='9bc7cd13-bae2-4d89-9df1-87dce30b50d0'
   AND NOT d.channels ? 'acts_prior_empty_snapshot_failure'
   AND EXISTS(SELECT 1 FROM public.work_items w JOIN public.work_item_provider_enrollment e ON e.work_item_id=w.id
     WHERE w.id=d.work_item_id AND w.radicado='05001400500620260049900' AND w.lifecycle_state='ACTIVE'
       AND w.monitoring_enabled=true AND w.deleted_at IS NULL AND e.provider_key='cpnu' AND e.enabled=true)
 RETURNING d.work_item_id
)
SELECT work_item_id,net.http_post(
 url:=(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='SUPABASE_URL')||'/functions/v1/sync-by-work-item',
 headers:=jsonb_build_object('Content-Type','application/json','x-cron-key',
  (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='CRON_SERVICE_KEY'),
  'x-invoker-function','daily-current-empty-snapshot-recovery-20261031'),
 body:=jsonb_build_object('work_item_id',work_item_id,'_scheduled',true,'allow_buscar',false,'force_refresh',false),
 timeout_milliseconds:=180000) AS request_id FROM recovered;
COMMIT;
