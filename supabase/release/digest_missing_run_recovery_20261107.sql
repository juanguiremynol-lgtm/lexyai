-- Owner-scoped recovery. A null owner can never request mail for everyone.
-- The normal digest retains its unique (recipient, day) claim and outbox key.
CREATE OR REPLACE FUNCTION public.dispatch_missing_daily_digests_20261107(
  _dry_run boolean DEFAULT true, _owner uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_day date := (now() AT TIME ZONE 'America/Bogota')::date;
  v_local_time time := (now() AT TIME ZONE 'America/Bogota')::time;
  v_key text := 'digest-missing-recovery-v1:' || v_day::text;
  v_missing integer;
  v_attempts integer := 0;
  v_last timestamptz;
  v_busy boolean;
  v_state text;
  v_request bigint;
  v_secret text;
  v_base text;
  v_body jsonb;
BEGIN
  IF _owner IS NULL THEN
    RETURN jsonb_build_object('bogota_date',v_day,'dry_run',_dry_run,'state','owner_required');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('andromeda-missing-digest-v1'));
  SELECT count(*) INTO v_missing FROM (
    SELECT DISTINCT owner_id FROM public.v_monitored_work_items
    WHERE owner_id = _owner
  ) owners
  WHERE NOT EXISTS (SELECT 1 FROM public.daily_digest_runs r
                    WHERE r.recipient_user_id=owners.owner_id AND r.digest_date=v_day)
    AND NOT EXISTS (SELECT 1 FROM public.email_outbox o
                    WHERE o.dedupe_key='daily-digest-'||owners.owner_id::text||'-'||v_day::text);
  SELECT coalesce((value->>'attempts')::integer, 0), updated_at INTO v_attempts, v_last
    FROM public.cron_state WHERE key=v_key;
  v_attempts := coalesce(v_attempts, 0);
  SELECT EXISTS (SELECT 1 FROM public.platform_job_heartbeats h
    WHERE h.job_name='scheduled-daily-digest' AND h.status='RUNNING'
      AND h.started_at > now() - interval '5 minutes'
      AND h.metadata->>'digest_date'=v_day::text) INTO v_busy;
  v_state := CASE
    WHEN v_local_time < time '08:20' OR v_local_time >= time '21:00' THEN 'outside_window'
    WHEN v_missing=0 THEN 'no_missing_recipient'
    WHEN v_busy THEN 'digest_in_progress'
    WHEN v_attempts>=3 THEN 'attempt_limit'
    WHEN v_last IS NOT NULL AND v_last > now()-interval '19 minutes' THEN 'cooldown'
    ELSE 'ready'
  END;
  IF v_state='ready' AND NOT _dry_run THEN
    SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name='CRON_SERVICE_KEY' LIMIT 1;
    SELECT decrypted_secret INTO v_base FROM vault.decrypted_secrets WHERE name='SUPABASE_URL' LIMIT 1;
    IF coalesce(v_secret,'')='' OR coalesce(v_base,'')='' THEN
      RAISE EXCEPTION 'Digest recovery requires the existing Vault credentials';
    END IF;
    v_body := jsonb_build_object('source','digest_missing_recovery',
      'trigger_source','CRON_MISSING_DIGEST_RECOVERY');
    v_body := v_body || jsonb_build_object('user_id',_owner);
    SELECT net.http_post(url:=rtrim(v_base,'/')||'/functions/v1/scheduled-daily-digest',
      headers:=jsonb_build_object('Content-Type','application/json','x-cron-key',v_secret),
      body:=v_body, timeout_milliseconds:=135000) INTO v_request;
    INSERT INTO public.cron_state(key,value,updated_at)
      VALUES(v_key,jsonb_build_object('attempts',v_attempts+1,'request_id',v_request),now())
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
    v_state := 'requested';
  END IF;
  RETURN jsonb_build_object('bogota_date',v_day,'dry_run',_dry_run,
    'missing_recipients',v_missing,'attempts_before',v_attempts,'state',v_state,'request_id',v_request);
END
$function$;

REVOKE ALL ON FUNCTION public.dispatch_missing_daily_digests_20261107(boolean,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_missing_daily_digests_20261107(boolean,uuid) TO service_role;
