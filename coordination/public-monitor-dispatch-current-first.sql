-- Narrow correction to the activated dispatcher; does not reapply0046.
CREATE OR REPLACE FUNCTION public.dispatch_public_monitors(_start_new boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE secret text; base text; v_channel text; sent integer:=0; request_id bigint; current_run uuid;
BEGIN
 SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets
 WHERE name IN ('CRON_SERVICE_KEY','cron_service_key') ORDER BY name LIMIT 1;
 SELECT decrypted_secret INTO base FROM vault.decrypted_secrets
 WHERE name IN ('SUPABASE_URL','supabase_url') ORDER BY name LIMIT 1;
 IF secret IS NULL OR base IS NULL THEN
  RAISE EXCEPTION 'Public monitor dispatch requires existing CRON_SERVICE_KEY and SUPABASE_URL in Vault';
 END IF;
 FOREACH v_channel IN ARRAY ARRAY['publicaciones','samai_estados'] LOOP
  IF _start_new OR EXISTS(SELECT 1 FROM estados_monitor_runs r
    WHERE r.channel=v_channel AND r.status IN ('RUNNING','PARTIAL') AND r.lease_expires_at<=now()
    AND EXISTS(SELECT 1 FROM estados_monitor_run_items i WHERE i.run_id=r.id AND i.status IN ('PENDING','CLAIMED'))) THEN
   -- A due current-day snapshot must not wait behind several historical runs.
   SELECT r.id INTO current_run FROM estados_monitor_runs r
   WHERE r.channel=v_channel AND r.run_date=(now() AT TIME ZONE 'America/Bogota')::date
   AND r.status IN ('RUNNING','PARTIAL') AND r.lease_expires_at<=now()
   AND EXISTS(SELECT 1 FROM estados_monitor_run_items i WHERE i.run_id=r.id AND i.status IN ('PENDING','CLAIMED'));
   SELECT net.http_post(url:=rtrim(base,'/')||'/functions/v1/'||
    CASE v_channel WHEN 'publicaciones' THEN 'scheduled-publicaciones-monitor' ELSE 'scheduled-samai-estados-monitor' END,
    headers:=jsonb_build_object('Content-Type','application/json','x-cron-key',secret),body:=CASE WHEN current_run IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('run_id',current_run) END,timeout_milliseconds:=140000) INTO request_id;
   INSERT INTO public_monitor_dispatch_requests(request_id,channel,start_new)
   VALUES(request_id,v_channel,_start_new);
   sent:=sent+1;
  END IF;
 END LOOP;
 RETURN sent;
END $$;
