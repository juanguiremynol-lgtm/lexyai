-- One previously deferred item, after the stored-reader fix was deployed.
-- No success is manufactured: the ordinary fenced monitor must ingest it.
BEGIN;
SET LOCAL lock_timeout='3s';
CREATE TABLE IF NOT EXISTS public.monitor_stored_read_repair_20261101(
 key text PRIMARY KEY,work_item_id uuid NOT NULL,run_id uuid NOT NULL,
 item_before jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now(),request_id bigint);
ALTER TABLE public.monitor_stored_read_repair_20261101 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.monitor_stored_read_repair_20261101 FROM PUBLIC,anon,authenticated,service_role;
DO $repair$
DECLARE item public.estados_monitor_run_items; v_request_id bigint;
BEGIN
 SELECT i.* INTO item FROM public.estados_monitor_run_items i JOIN public.estados_monitor_runs r ON r.id=i.run_id
 JOIN public.work_items w ON w.id=i.work_item_id
 WHERE i.work_item_id='530e0e88-81be-4927-bcbe-ebbcbdbe674a' AND w.radicado='05001333300520250001900'
 AND w.lifecycle_state='ACTIVE' AND w.monitoring_enabled AND w.deleted_at IS NULL
 AND r.channel='samai_estados' AND r.run_date='2026-11-01'
 AND i.status='PENDING' AND i.attempts=0 AND i.error_code='DAILY_UPDATE_ALREADY_STARTED'
 AND i.next_attempt_at='2026-11-02T05:00:00Z'::timestamptz
 AND NOT EXISTS(SELECT 1 FROM public.monitor_stored_read_repair_20261101 WHERE key='j5-certified-stored-read')
 FOR UPDATE OF i;
 IF NOT FOUND THEN RETURN; END IF;
 INSERT INTO public.monitor_stored_read_repair_20261101(key,work_item_id,run_id,item_before)
 VALUES('j5-certified-stored-read',item.work_item_id,item.run_id,to_jsonb(item));
 UPDATE public.estados_monitor_run_items SET next_attempt_at=now()
 WHERE run_id=item.run_id AND work_item_id=item.work_item_id;
 SELECT net.http_post(url:=(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='SUPABASE_URL')||'/functions/v1/scheduled-samai-estados-monitor',
   headers:=jsonb_build_object('Content-Type','application/json','x-cron-key',
     (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='CRON_SERVICE_KEY')),
   body:=jsonb_build_object('run_id',item.run_id),timeout_milliseconds:=140000) INTO v_request_id;
 UPDATE public.monitor_stored_read_repair_20261101 SET request_id=v_request_id
 WHERE key='j5-certified-stored-read';
END $repair$;
SELECT key,work_item_id,run_id,request_id FROM public.monitor_stored_read_repair_20261101 WHERE key='j5-certified-stored-read';
COMMIT;
