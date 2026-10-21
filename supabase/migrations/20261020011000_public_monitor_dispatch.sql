-- Integrate AFTER the V2 RPC migration and both monitor functions are deployed.
-- Uses the existing technical cron credential, never a user's portal account.
CREATE FUNCTION public.dispatch_public_monitors(_start_new boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE secret text; base text; v_channel text; sent integer:=0;
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
   PERFORM net.http_post(url:=rtrim(base,'/')||'/functions/v1/'||
    CASE v_channel WHEN 'publicaciones' THEN 'scheduled-publicaciones-monitor' ELSE 'scheduled-samai-estados-monitor' END,
    headers:=jsonb_build_object('Content-Type','application/json','x-cron-key',secret),body:='{}'::jsonb);
   sent:=sent+1;
  END IF;
 END LOOP;
 RETURN sent;
END $$;
REVOKE ALL ON FUNCTION public.dispatch_public_monitors(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dispatch_public_monitors(boolean) TO service_role;
-- Replace the old bounded direct loop; one daily snapshot per source.
SELECT cron.schedule('andromeda-daily-estados','20 12 * * *','SELECT public.dispatch_public_monitors(true)');
SELECT cron.schedule('andromeda-public-estados-resume','*/5 * * * *','SELECT public.dispatch_public_monitors(false)');
