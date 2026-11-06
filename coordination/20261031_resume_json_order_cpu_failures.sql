-- Two exact failed runtime requests; run only after source revision beea4b1b
-- was deployed. Before-images and all failed attempts remain available.
BEGIN;
CREATE TABLE IF NOT EXISTS public.monitor_gate_json_cpu_backup_20261031 AS
  SELECT d.* FROM public.daily_update_cycles d WHERE run_date='2026-10-31'
    AND work_item_id IN ('2a590db7-0330-4b8d-9403-5963e4bd15a1','e4e761ac-9984-462d-ae6e-a25b244f79ea');
REVOKE ALL ON public.monitor_gate_json_cpu_backup_20261031 FROM PUBLIC,anon,authenticated,service_role;
WITH approved(work_item_id,trace_id,failed_request) AS (VALUES
  ('2a590db7-0330-4b8d-9403-5963e4bd15a1'::uuid,'0782f353-69fa-4fd2-ab12-f16a045aecd6',965),
  ('e4e761ac-9984-462d-ae6e-a25b244f79ea'::uuid,'761c8e6d-1538-4435-b710-14606130c0dc',971)
), recovered AS (
  UPDATE public.daily_update_cycles d SET
    channels=(d.channels-'acts') || jsonb_build_object('acts_json_cpu_recovery',
      ((d.channels->'acts')-'token') || jsonb_build_object(
        'status','FAILED','error_code','WORKER_RESOURCE_LIMIT',
        'failed_http_request',a.failed_request,
        'recovery_source_revision','beea4b1b9418cdb45ad3d576ea0957f04b7457a4')),
    continuations=d.continuations+1,updated_at=now()
  FROM approved a WHERE d.run_date='2026-10-31' AND d.work_item_id=a.work_item_id
    AND d.channels->'acts'->>'status'='STARTED'
    AND d.channels->'acts'->>'trace_id'=a.trace_id
    AND NOT d.channels ? 'acts_json_cpu_recovery'
    AND EXISTS (SELECT 1 FROM net._http_response n WHERE n.id=a.failed_request
      AND n.status_code=546 AND n.content::jsonb->>'code'='WORKER_RESOURCE_LIMIT')
  RETURNING d.work_item_id
)
SELECT work_item_id,net.http_post(
  url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='SUPABASE_URL') || '/functions/v1/sync-by-work-item',
  headers := jsonb_build_object('Content-Type','application/json',
    'x-cron-key',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='CRON_SERVICE_KEY'),
    'x-invoker-function','daily-json-cpu-recovery-20261031'),
  body := jsonb_build_object('work_item_id',work_item_id,'_scheduled',true,'allow_buscar',false),
  timeout_milliseconds := 180000) AS request_id
FROM recovered;
COMMIT;
