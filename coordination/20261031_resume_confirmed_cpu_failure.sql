-- One controlled recovery after deploying the CPU fix (13792536).
-- Technical gate state only. No judicial records, identities, retry counters,
-- enrollments or legal terms are modified. Retain the complete before-image.
BEGIN;
CREATE TABLE IF NOT EXISTS public.monitor_gate_cpu_backup_20261031 AS
  SELECT d.* FROM public.daily_update_cycles d
  WHERE run_date='2026-10-31' AND work_item_id='2a590db7-0330-4b8d-9403-5963e4bd15a1';
REVOKE ALL ON public.monitor_gate_cpu_backup_20261031 FROM PUBLIC,anon,authenticated,service_role;
WITH recovered AS (
  UPDATE public.daily_update_cycles d SET
    channels=(channels-'acts') || jsonb_build_object('acts_cpu_recovery_previous',
      ((channels->'acts')-'token') || jsonb_build_object(
        'status','FAILED','error_code','WORKER_RESOURCE_LIMIT','failed_http_request',961,
        'recovery_source_revision','13792536ec9a1a631c9c295981b7f1c63d90e486')),
    continuations=continuations+1,updated_at=now()
  WHERE run_date='2026-10-31' AND work_item_id='2a590db7-0330-4b8d-9403-5963e4bd15a1'
    AND channels->'acts'->>'status'='STARTED'
    AND channels->'acts'->>'trace_id'='e14e3ee7-ef39-4406-b66b-e2d12c19b6db'
    AND NOT channels ? 'acts_cpu_recovery_previous'
    AND EXISTS (SELECT 1 FROM net._http_response n WHERE n.id=961
      AND n.status_code=546 AND n.content::jsonb->>'code'='WORKER_RESOURCE_LIMIT')
  RETURNING work_item_id
)
SELECT net.http_post(
  url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='SUPABASE_URL') || '/functions/v1/sync-by-work-item',
  headers := jsonb_build_object('Content-Type','application/json',
    'x-cron-key',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='CRON_SERVICE_KEY'),
    'x-invoker-function','daily-cpu-recovery-20261031'),
  body := jsonb_build_object('work_item_id',work_item_id,'_scheduled',true,'allow_buscar',false),
  timeout_milliseconds := 180000) AS request_id
FROM recovered;
COMMIT;
