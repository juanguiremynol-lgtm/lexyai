-- Renew only an expired current run; prioritize the oldest due item.
-- No cron, secret, source eligibility or judicial data changes.
BEGIN;
DO $guard$ BEGIN
 IF md5(pg_get_functiondef('claim_public_monitor_items(uuid,text,integer)'::regprocedure)) <> 'ad25188d4ff00026644b7941a85ff046'
 OR md5(pg_get_functiondef('dispatch_public_monitors(boolean)'::regprocedure)) <> 'b1d0b1f3f2feabe54ee2aeea2be2296c' THEN
 RAISE EXCEPTION 'Monitor resume protocol changed; reconcile before applying';
 END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.claim_public_monitor_items(_run_id uuid, _channel text, _limit integer DEFAULT 1)
 RETURNS TABLE(work_item_id uuid, ordinal integer, lease_token uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF _limit NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'invalid limit'; END IF;
 PERFORM 1 FROM estados_monitor_runs r WHERE r.id=_run_id AND r.channel=_channel FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'run/channel mismatch'; END IF;
 -- An orphan's final attempt must terminate rather than remain CLAIMED forever.
 UPDATE estados_monitor_run_items i SET status='FAILED',finished_at=now(),error_code='LEASE_ATTEMPTS_EXHAUSTED'
 WHERE i.run_id=_run_id AND i.status='CLAIMED' AND i.claimed_at<now()-interval '3 minutes' AND i.attempts>=3;
 RETURN QUERY WITH picked AS (
  SELECT i.run_id,i.work_item_id FROM estados_monitor_run_items i
  WHERE i.run_id=_run_id AND i.attempts<3 AND
   ((i.status='PENDING' AND i.next_attempt_at<=now()) OR (i.status='CLAIMED' AND i.claimed_at<now()-interval '3 minutes'))
  ORDER BY i.next_attempt_at,i.ordinal FOR UPDATE SKIP LOCKED LIMIT _limit
 ), claimed AS (
  UPDATE estados_monitor_run_items i SET status='CLAIMED',claimed_at=now(),attempts=i.attempts+1,lease_token=gen_random_uuid()
  FROM picked p WHERE i.run_id=p.run_id AND i.work_item_id=p.work_item_id RETURNING i.work_item_id,i.ordinal,i.lease_token
 ) SELECT c.work_item_id,c.ordinal,c.lease_token FROM claimed c;
END $function$;

CREATE OR REPLACE FUNCTION public.dispatch_public_monitors(_start_new boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    AND EXISTS(SELECT 1 FROM estados_monitor_run_items i WHERE i.run_id=r.id AND ((i.status='PENDING' AND i.next_attempt_at<=now()) OR (i.status='CLAIMED' AND i.claimed_at<now()-interval '3 minutes')))) THEN
   -- A due current-day snapshot must not wait behind several historical runs.
   SELECT r.id INTO current_run FROM estados_monitor_runs r
   WHERE r.channel=v_channel AND r.run_date=(now() AT TIME ZONE 'America/Bogota')::date
   AND r.status IN ('RUNNING','PARTIAL') AND r.lease_expires_at<=now()
   AND EXISTS(SELECT 1 FROM estados_monitor_run_items i WHERE i.run_id=r.id AND ((i.status='PENDING' AND i.next_attempt_at<=now()) OR (i.status='CLAIMED' AND i.claimed_at<now()-interval '3 minutes')));
   IF current_run IS NOT NULL THEN
    -- Renew the bounded hop budget before a resume bypasses start_public_monitor_run.
    -- The conditional UPDATE also fences concurrent dispatchers.
    UPDATE estados_monitor_runs SET depth_remaining=60,lease_expires_at=now()+interval '3 minutes',finished_at=NULL
    WHERE id=current_run AND lease_expires_at<=now();
    IF NOT FOUND THEN CONTINUE; END IF;
   END IF;
   SELECT net.http_post(url:=rtrim(base,'/')||'/functions/v1/'||
    CASE v_channel WHEN 'publicaciones' THEN 'scheduled-publicaciones-monitor' ELSE 'scheduled-samai-estados-monitor' END,
    headers:=jsonb_build_object('Content-Type','application/json','x-cron-key',secret),body:=CASE WHEN current_run IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('run_id',current_run) END,timeout_milliseconds:=140000) INTO request_id;
   INSERT INTO public_monitor_dispatch_requests(request_id,channel,start_new)
   VALUES(request_id,v_channel,_start_new);
   sent:=sent+1;
  END IF;
 END LOOP;
 RETURN sent;
END $function$;

REVOKE ALL ON FUNCTION public.claim_public_monitor_items(uuid,text,integer),public.dispatch_public_monitors(boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_public_monitor_items(uuid,text,integer),public.dispatch_public_monitors(boolean) TO service_role;
COMMIT;
