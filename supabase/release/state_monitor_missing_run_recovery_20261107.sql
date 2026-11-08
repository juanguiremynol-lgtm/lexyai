-- Recover today's missing per-channel snapshot only. Existing runs, retries,
-- admissions, source coverage and historical records remain authoritative.
-- Default dry-run; the scheduler must explicitly pass false.
CREATE OR REPLACE FUNCTION public.dispatch_missing_state_runs_20261107(_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_day date := (now() AT TIME ZONE 'America/Bogota')::date;
  v_local_time time := (now() AT TIME ZONE 'America/Bogota')::time;
  v_channel text;
  v_attempts integer;
  v_last timestamptz;
  v_state text;
  v_results jsonb := '[]'::jsonb;
  v_base text;
  v_secret text;
  v_request bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('andromeda-missing-state-runs-v1'));
  FOREACH v_channel IN ARRAY ARRAY['publicaciones', 'samai_estados'] LOOP
    v_request := NULL;
    SELECT count(*)::integer, max(requested_at) INTO v_attempts, v_last
      FROM public.public_monitor_dispatch_requests
     WHERE channel = v_channel AND start_new IS TRUE
       AND requested_at >= (v_day::timestamp AT TIME ZONE 'America/Bogota')
       AND requested_at < ((v_day + 1)::timestamp AT TIME ZONE 'America/Bogota');
    v_state := CASE
      WHEN v_local_time < time '07:35' OR v_local_time >= time '21:00' THEN 'outside_window'
      WHEN EXISTS (SELECT 1 FROM public.estados_monitor_runs r
                   WHERE r.channel = v_channel AND r.run_date = v_day) THEN 'already_seeded'
      WHEN v_attempts >= 3 THEN 'attempt_limit'
      WHEN v_last IS NOT NULL AND v_last > now() - interval '19 minutes' THEN 'cooldown'
      ELSE 'ready'
    END;
    IF v_state = 'ready' AND NOT _dry_run THEN
      SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name='CRON_SERVICE_KEY' LIMIT 1;
      SELECT decrypted_secret INTO v_base FROM vault.decrypted_secrets WHERE name='SUPABASE_URL' LIMIT 1;
      IF coalesce(v_secret, '') = '' OR coalesce(v_base, '') = '' THEN
        RAISE EXCEPTION 'State-run recovery requires the existing Vault credentials';
      END IF;
      SELECT net.http_post(
        url := rtrim(v_base, '/') || '/functions/v1/' ||
          CASE v_channel WHEN 'publicaciones' THEN 'scheduled-publicaciones-monitor' ELSE 'scheduled-samai-estados-monitor' END,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', v_secret),
        body := '{}'::jsonb, timeout_milliseconds := 140000
      ) INTO v_request;
      INSERT INTO public.public_monitor_dispatch_requests(request_id, channel, start_new)
      VALUES(v_request, v_channel, true);
      v_state := 'requested';
    END IF;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'channel', v_channel, 'state', v_state, 'attempts_before', v_attempts,
      'request_id', v_request));
  END LOOP;
  RETURN jsonb_build_object('bogota_date', v_day, 'dry_run', _dry_run, 'channels', v_results);
END
$function$;

REVOKE ALL ON FUNCTION public.dispatch_missing_state_runs_20261107(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_missing_state_runs_20261107(boolean) TO service_role;
