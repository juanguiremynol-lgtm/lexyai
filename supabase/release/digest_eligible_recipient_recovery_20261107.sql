-- Recover only an existing recipient's missing daily digest. The scheduler
-- calls this with _dry_run=false; the default is safe for ad-hoc inspection.
-- The candidate function is service-only because it returns private user IDs.
CREATE OR REPLACE FUNCTION public.digest_recovery_eligible_recipients_20261107()
RETURNS TABLE(recipient_user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  WITH owners AS (
    SELECT DISTINCT owner_id
    FROM public.v_monitored_work_items
    WHERE owner_id IS NOT NULL
  ), candidates AS (
    SELECT owners.owner_id,
      coalesce(nullif(btrim(p.default_alert_email), ''), nullif(btrim(p.email), '')) AS email
    FROM owners JOIN public.profiles p ON p.id=owners.owner_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.alert_preferences ap
      WHERE ap.user_id=owners.owner_id
        AND ap.preferences ? 'email_enabled'
        AND ap.preferences->'email_enabled' IS DISTINCT FROM 'true'::jsonb
    )
      -- A disabled or unknown organization setting must not be overridden by
      -- another monitored organization that happens to have it enabled.
      AND NOT EXISTS (
        SELECT 1 FROM public.v_monitored_work_items m
        LEFT JOIN public.org_alert_defaults d ON d.organization_id=m.organization_id
        WHERE m.owner_id=owners.owner_id AND d.email_digest_enabled IS DISTINCT FROM true
      )
      -- This is recovery for existing recipients, not enrollment of new ones.
      AND EXISTS (
        SELECT 1 FROM public.daily_digest_runs h
        JOIN public.email_outbox sent ON sent.id=h.email_outbox_id
          AND sent.to_user_id=h.recipient_user_id AND sent.status='SENT'
        WHERE h.recipient_user_id=owners.owner_id AND h.status='SENT'
      )
      -- A claimed, failed, opted-out or sent run is not a missing run.
      AND NOT EXISTS (
        SELECT 1 FROM public.daily_digest_runs r
        WHERE r.recipient_user_id=owners.owner_id
          AND r.digest_date=(now() AT TIME ZONE 'America/Bogota')::date
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox o
        WHERE o.dedupe_key='daily-digest-'||owners.owner_id::text||'-'||
          (now() AT TIME ZONE 'America/Bogota')::date::text
      )
  )
  SELECT c.owner_id FROM candidates c
  WHERE c.email IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.v_monitored_work_items m
    JOIN public.email_suppressions s ON s.organization_id=m.organization_id
    WHERE m.owner_id=c.owner_id AND lower(btrim(s.email))=lower(c.email)
  );
$function$;

CREATE OR REPLACE FUNCTION public.dispatch_missing_eligible_digests_20261107(_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_day date := (now() AT TIME ZONE 'America/Bogota')::date;
  v_local_time time := (now() AT TIME ZONE 'America/Bogota')::time;
  v_owner uuid;
  v_key text;
  v_attempts integer;
  v_last timestamptz;
  v_candidates integer := 0;
  v_ready integer := 0;
  v_requested integer := 0;
  v_busy boolean;
  v_enabled boolean;
  v_secret text;
  v_base text;
  v_request bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('andromeda-missing-eligible-digest-v2'));
  IF v_local_time < time '08:20' OR v_local_time >= time '21:00' THEN
    RETURN jsonb_build_object('state','outside_window','dry_run',_dry_run,'bogota_date',v_day);
  END IF;
  SELECT email_enabled INTO v_enabled FROM public.platform_settings WHERE id='singleton';
  IF v_enabled IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('state','global_email_disabled_or_unknown','dry_run',_dry_run,'bogota_date',v_day);
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.platform_job_heartbeats h
    WHERE h.job_name='scheduled-daily-digest' AND h.status='RUNNING'
      AND h.started_at > now()-interval '5 minutes'
      AND h.metadata->>'digest_date'=v_day::text) INTO v_busy;
  IF v_busy THEN
    RETURN jsonb_build_object('state','digest_in_progress','dry_run',_dry_run,'bogota_date',v_day);
  END IF;
  FOR v_owner IN SELECT recipient_user_id FROM public.digest_recovery_eligible_recipients_20261107()
                 ORDER BY recipient_user_id
  LOOP
    v_candidates := v_candidates+1;
    v_key := 'digest-eligible-recovery-v2:'||v_day::text||':'||v_owner::text;
    v_attempts := 0; v_last := NULL;
    SELECT coalesce((value->>'attempts')::integer,0),updated_at INTO v_attempts,v_last
      FROM public.cron_state WHERE key=v_key;
    v_attempts := coalesce(v_attempts,0);
    IF v_attempts>=3 OR (v_last IS NOT NULL AND v_last>now()-interval '19 minutes') THEN
      CONTINUE;
    END IF;
    -- Apply the batch cap to ready recipients, not the first 50 candidates:
    -- exhausted users must not starve later recipients.
    IF v_ready>=50 THEN EXIT; END IF;
    v_ready := v_ready+1;
    IF NOT _dry_run THEN
      IF v_secret IS NULL THEN
        SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name='CRON_SERVICE_KEY' LIMIT 1;
        SELECT decrypted_secret INTO v_base FROM vault.decrypted_secrets WHERE name='SUPABASE_URL' LIMIT 1;
        IF coalesce(v_secret,'')='' OR coalesce(v_base,'')='' THEN
          RAISE EXCEPTION 'Digest recovery requires the existing Vault credentials';
        END IF;
      END IF;
      SELECT net.http_post(url:=rtrim(v_base,'/')||'/functions/v1/scheduled-daily-digest',
        headers:=jsonb_build_object('Content-Type','application/json','x-cron-key',v_secret),
        body:=jsonb_build_object('source','eligible_digest_recovery',
          'trigger_source','CRON_MISSING_DIGEST_RECOVERY','user_id',v_owner,'digest_date',v_day::text),
        timeout_milliseconds:=135000) INTO v_request;
      INSERT INTO public.cron_state(key,value,updated_at)
        VALUES(v_key,jsonb_build_object('attempts',v_attempts+1,'request_id',v_request),now())
        ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
      v_requested := v_requested+1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('state',CASE WHEN v_candidates=0 THEN 'no_eligible_missing_recipients'
    WHEN v_ready=0 THEN 'cooldown_or_limit' WHEN _dry_run THEN 'ready' ELSE 'requested' END,
    'dry_run',_dry_run,'bogota_date',v_day,'candidates',v_candidates,'ready',v_ready,'requested',v_requested);
END;
$function$;

REVOKE ALL ON FUNCTION public.digest_recovery_eligible_recipients_20261107() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dispatch_missing_eligible_digests_20261107(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.digest_recovery_eligible_recipients_20261107() TO service_role;
GRANT EXECUTE ON FUNCTION public.dispatch_missing_eligible_digests_20261107(boolean) TO service_role;
