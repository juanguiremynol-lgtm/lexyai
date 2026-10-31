-- One confirmed CPU-limited EDU attempt after the observed database restart.
-- This is not a general retry-counter reset or a judicial-data repair.
BEGIN;
CREATE TABLE IF NOT EXISTS public.monitor_gate_edu_cpu_backup_20261031 AS
  SELECT d.* FROM public.daily_update_cycles d
  WHERE d.run_date='2026-10-31'
    AND d.work_item_id='e4e761ac-9984-462d-ae6e-a25b244f79ea';
REVOKE ALL ON public.monitor_gate_edu_cpu_backup_20261031 FROM PUBLIC,anon,authenticated,service_role;
WITH recovered AS (
  UPDATE public.daily_update_cycles d SET
    channels=(d.channels-'acts') || jsonb_build_object('acts_confirmed_edu_cpu_recovery',
      ((d.channels->'acts')-'token') || jsonb_build_object(
        'outcome','CONFIRMED_CPU_FAILURE', 'transport_request_id',13,
        'observed_database_start',pg_postmaster_start_time(),
        'deployed_fix','b8262440962b60af751e58cf2cb48e2b66f7e287')),
    continuations=d.continuations+1,updated_at=now()
  WHERE d.run_date='2026-10-31'
    AND d.work_item_id='e4e761ac-9984-462d-ae6e-a25b244f79ea'
    AND d.channels->'acts'->>'status'='STARTED'
    AND d.channels->'acts'->>'trace_id'='a5b09fc3-6177-4f4c-a47e-4add48eefcfb'
    AND NOT d.channels ? 'acts_confirmed_edu_cpu_recovery'
    AND pg_postmaster_start_time()='2026-10-31T17:47:38.826004Z'::timestamptz
    AND EXISTS (SELECT 1 FROM net._http_response r WHERE r.id=13
      AND r.status_code=546 AND NOT r.timed_out
      AND r.content::jsonb->>'code'='WORKER_RESOURCE_LIMIT')
    AND EXISTS (SELECT 1 FROM public.work_items w WHERE w.id=d.work_item_id
      AND w.status='ACTIVE' AND w.monitoring_enabled IS TRUE AND w.deleted_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM public.work_item_sync_timeline t
      WHERE t.work_item_id=d.work_item_id AND t.operation='acts' AND t.status='success'
        AND t.started_at >= (d.channels->'acts'->>'started_at')::timestamptz)
  RETURNING d.work_item_id
)
SELECT work_item_id,net.http_post(
  url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='SUPABASE_URL') || '/functions/v1/sync-by-work-item',
  headers := jsonb_build_object('Content-Type','application/json',
    'x-cron-key',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='CRON_SERVICE_KEY'),
    'x-invoker-function','daily-confirmed-edu-cpu-recovery-20261031'),
  body := jsonb_build_object('work_item_id',work_item_id,'_scheduled',true,'allow_buscar',false),
  timeout_milliseconds := 180000) AS request_id
FROM recovered;
COMMIT;
