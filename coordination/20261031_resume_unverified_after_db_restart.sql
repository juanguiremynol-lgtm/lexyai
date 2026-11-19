-- Exact two durable starts with no terminal result across a confirmed database
-- restart. Absence of a transport response is not classified as judicial or
-- provider failure. Preserve before-images and fence the replaced starts.
BEGIN;
CREATE TABLE IF NOT EXISTS public.monitor_gate_restart_backup_20261031 AS
  SELECT d.* FROM public.daily_update_cycles d WHERE run_date='2026-10-31'
    AND work_item_id IN ('2a590db7-0330-4b8d-9403-5963e4bd15a1','e4e761ac-9984-462d-ae6e-a25b244f79ea');
REVOKE ALL ON public.monitor_gate_restart_backup_20261031 FROM PUBLIC,anon,authenticated,service_role;
WITH approved(work_item_id,trace_id) AS (VALUES
  ('2a590db7-0330-4b8d-9403-5963e4bd15a1'::uuid,'efab44ed-0c38-4d3c-a25f-e02b47747ed0'),
  ('e4e761ac-9984-462d-ae6e-a25b244f79ea'::uuid,'2e46e62b-5f71-4376-b9b2-0795e1cafb08')
), recovered AS (
  UPDATE public.daily_update_cycles d SET
    channels=(d.channels-'acts') || jsonb_build_object('acts_db_restart_recovery',
      ((d.channels->'acts')-'token') || jsonb_build_object(
        'outcome','UNVERIFIED_BEFORE_DATABASE_RESTART',
        'observed_database_start',pg_postmaster_start_time())),
    continuations=d.continuations+1,updated_at=now()
  FROM approved a WHERE d.run_date='2026-10-31' AND d.work_item_id=a.work_item_id
    AND d.channels->'acts'->>'status'='STARTED'
    AND d.channels->'acts'->>'trace_id'=a.trace_id
    AND NOT d.channels ? 'acts_db_restart_recovery'
    AND pg_postmaster_start_time() > (d.channels->'acts'->>'started_at')::timestamptz
    AND now() > pg_postmaster_start_time()+interval '5 minutes'
    AND NOT EXISTS (SELECT 1 FROM public.work_item_sync_timeline t
      WHERE t.work_item_id=d.work_item_id AND t.operation='acts' AND t.status='success'
        AND t.started_at >= (d.channels->'acts'->>'started_at')::timestamptz)
  RETURNING d.work_item_id
)
SELECT work_item_id,net.http_post(
  url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='SUPABASE_URL') || '/functions/v1/sync-by-work-item',
  headers := jsonb_build_object('Content-Type','application/json',
    'x-cron-key',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='CRON_SERVICE_KEY'),
    'x-invoker-function','daily-post-restart-recovery-20261031'),
  body := jsonb_build_object('work_item_id',work_item_id,'_scheduled',true,'allow_buscar',false),
  timeout_milliseconds := 180000) AS request_id
FROM recovered;
COMMIT;
