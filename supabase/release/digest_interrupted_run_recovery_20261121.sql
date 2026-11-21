BEGIN;

SET LOCAL lock_timeout = '3s';

DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.digest_recovery_eligible_recipients_20261107()'::regprocedure))
      IS DISTINCT FROM '21f99face7921533ac6fb22420648ad2'
    OR md5(pg_get_functiondef('public.dispatch_missing_eligible_digests_20261107(boolean)'::regprocedure))
      IS DISTINCT FROM '4a02f45ba6b79701881d0a4f382cbaa0'
    OR EXISTS (SELECT 1 FROM pg_constraint WHERE confrelid='public.daily_digest_runs'::regclass) THEN
    RAISE EXCEPTION 'Unexpected daily digest recovery schema';
  END IF;
END
$guard$;

CREATE TABLE public.daily_digest_interrupted_runs (
  original_id uuid PRIMARY KEY,
  recipient_user_id uuid NOT NULL,
  digest_date date NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  original_run jsonb NOT NULL
);
ALTER TABLE public.daily_digest_interrupted_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.daily_digest_interrupted_runs FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.daily_digest_has_outbox_20261121(_recipient uuid, _day date)
RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.email_outbox o
    WHERE o.dedupe_key='daily-digest-'||_recipient::text||'-'||_day::text
      OR (o.to_user_id=_recipient AND o.trigger_reason='DAILY_CONSOLIDATED_DIGEST'
        AND o.created_at>=(_day::timestamp AT TIME ZONE 'America/Bogota')
        AND o.created_at<((_day+1)::timestamp AT TIME ZONE 'America/Bogota'))
  );
$function$;

CREATE OR REPLACE FUNCTION public.digest_recovery_eligible_recipients_20261107()
RETURNS TABLE(recipient_user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  WITH today AS (
    SELECT (now() AT TIME ZONE 'America/Bogota')::date AS digest_date
  ), owners AS (
    SELECT DISTINCT owner_id FROM public.v_monitored_work_items WHERE owner_id IS NOT NULL
  ), candidates AS (
    SELECT owners.owner_id,
      coalesce(nullif(btrim(p.default_alert_email), ''), nullif(btrim(p.email), '')) AS email
    FROM owners JOIN public.profiles p ON p.id=owners.owner_id CROSS JOIN today
    WHERE NOT EXISTS (
      SELECT 1 FROM public.alert_preferences ap
      WHERE ap.user_id=owners.owner_id
        AND ap.preferences ? 'email_enabled'
        AND ap.preferences->'email_enabled' IS DISTINCT FROM 'true'::jsonb
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.v_monitored_work_items m
      LEFT JOIN public.org_alert_defaults d ON d.organization_id=m.organization_id
      WHERE m.owner_id=owners.owner_id AND d.email_digest_enabled IS DISTINCT FROM true
    )
    AND EXISTS (
      SELECT 1 FROM public.daily_digest_runs h
      JOIN public.email_outbox sent ON sent.id=h.email_outbox_id
        AND sent.to_user_id=h.recipient_user_id AND sent.status='SENT'
      WHERE h.recipient_user_id=owners.owner_id AND h.status='SENT'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.daily_digest_runs r
      WHERE r.recipient_user_id=owners.owner_id AND r.digest_date=today.digest_date
        AND NOT (r.status='RUNNING' AND r.created_at <= now()-interval '12 minutes'
          AND r.finished_at IS NULL AND r.email_outbox_id IS NULL)
    )
    AND NOT public.daily_digest_has_outbox_20261121(owners.owner_id,today.digest_date)
  )
  SELECT c.owner_id FROM candidates c
  WHERE c.email IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.v_monitored_work_items m
    JOIN public.email_suppressions s ON s.organization_id=m.organization_id
    WHERE m.owner_id=c.owner_id AND lower(btrim(s.email))=lower(c.email)
  );
$function$;

CREATE FUNCTION public.dispatch_daily_digest_recovery_20261121(_dry_run boolean, _recipient uuid DEFAULT NULL)
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
  v_archived integer := 0;
  v_current_archive integer;
  v_secret text;
  v_base text;
  v_request bigint;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('andromeda-missing-eligible-digest-v2')) THEN
    RETURN jsonb_build_object('state','recovery_in_progress','dry_run',_dry_run);
  END IF;
  IF v_local_time < time '08:20' OR v_local_time >= time '21:00' THEN
    RETURN jsonb_build_object('state','outside_window','dry_run',_dry_run,'bogota_date',v_day);
  END IF;
  IF (SELECT email_enabled FROM public.platform_settings WHERE id='singleton') IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('state','global_email_disabled_or_unknown','dry_run',_dry_run,'bogota_date',v_day);
  END IF;
  IF EXISTS (SELECT 1 FROM public.platform_job_heartbeats h
    WHERE h.job_name='scheduled-daily-digest' AND h.status='RUNNING'
      AND h.started_at > now()-interval '8 minutes'
      AND h.metadata->>'digest_date'=v_day::text) THEN
    RETURN jsonb_build_object('state','digest_in_progress','dry_run',_dry_run,'bogota_date',v_day);
  END IF;

  FOR v_owner IN SELECT recipient_user_id FROM public.digest_recovery_eligible_recipients_20261107()
                 WHERE _recipient IS NULL OR recipient_user_id=_recipient
                 ORDER BY recipient_user_id
  LOOP
    v_candidates := v_candidates+1;
    v_key := 'digest-eligible-recovery-v2:'||v_day::text||':'||v_owner::text;
    SELECT coalesce((value->>'attempts')::integer,0),updated_at INTO v_attempts,v_last
      FROM public.cron_state WHERE key=v_key;
    v_attempts := coalesce(v_attempts,0);
    IF v_attempts>=3 OR (v_last IS NOT NULL AND v_last>now()-interval '19 minutes') THEN CONTINUE; END IF;
    IF v_ready>=50 THEN EXIT; END IF;
    v_ready := v_ready+1;
    IF _dry_run IS DISTINCT FROM false THEN CONTINUE; END IF;

    IF v_secret IS NULL THEN
      SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name='CRON_SERVICE_KEY' LIMIT 1;
      SELECT decrypted_secret INTO v_base FROM vault.decrypted_secrets WHERE name='SUPABASE_URL' LIMIT 1;
      IF coalesce(v_secret,'')='' OR coalesce(v_base,'')='' THEN
        RAISE EXCEPTION 'Digest recovery requires the existing Vault credentials';
      END IF;
    END IF;

    -- Save the exact interrupted run before the producer reclaims its unique
    -- recipient/day slot. Moving the slot, saving the receipt and enqueuing
    -- the transport are part of the same transaction.
    WITH interrupted AS (
      DELETE FROM public.daily_digest_runs r
      WHERE r.recipient_user_id=v_owner AND r.digest_date=v_day AND r.status='RUNNING'
        AND r.created_at<=now()-interval '12 minutes' AND r.finished_at IS NULL AND r.email_outbox_id IS NULL
        AND NOT public.daily_digest_has_outbox_20261121(v_owner,v_day)
      RETURNING r.*
    )
    INSERT INTO public.daily_digest_interrupted_runs(original_id,recipient_user_id,digest_date,original_run)
      SELECT i.id,i.recipient_user_id,i.digest_date,to_jsonb(i) FROM interrupted i;
    GET DIAGNOSTICS v_current_archive = ROW_COUNT;
    v_archived := v_archived + v_current_archive;
    IF EXISTS (SELECT 1 FROM public.daily_digest_runs r WHERE r.recipient_user_id=v_owner AND r.digest_date=v_day)
      OR public.daily_digest_has_outbox_20261121(v_owner,v_day) THEN
      CONTINUE;
    END IF;

    SELECT net.http_post(url:=rtrim(v_base,'/')||'/functions/v1/scheduled-daily-digest',
      headers:=jsonb_build_object('Content-Type','application/json','x-cron-key',v_secret),
      body:=jsonb_build_object('source','eligible_digest_recovery',
        'trigger_source','CRON_MISSING_DIGEST_RECOVERY','user_id',v_owner,'digest_date',v_day::text),
      timeout_milliseconds:=135000) INTO v_request;
    IF v_request IS NULL THEN RAISE EXCEPTION 'No digest recovery transport receipt'; END IF;
    INSERT INTO public.cron_state(key,value,updated_at)
      VALUES(v_key,jsonb_build_object('attempts',v_attempts+1,'request_id',v_request),now())
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
    v_requested := v_requested+1;
  END LOOP;
  RETURN jsonb_build_object('state',CASE WHEN v_candidates=0 THEN 'no_eligible_missing_recipients'
    WHEN v_ready=0 THEN 'cooldown_or_limit' WHEN _dry_run IS DISTINCT FROM false THEN 'ready' ELSE 'requested' END,
    'dry_run',_dry_run,'bogota_date',v_day,'candidates',v_candidates,'ready',v_ready,
    'requested',v_requested,'archived',v_archived);
END
$function$;

CREATE OR REPLACE FUNCTION public.dispatch_missing_eligible_digests_20261107(_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  SELECT public.dispatch_daily_digest_recovery_20261121(_dry_run);
$function$;

REVOKE ALL ON FUNCTION public.daily_digest_has_outbox_20261121(uuid,date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dispatch_daily_digest_recovery_20261121(boolean,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_daily_digest_recovery_20261121(boolean,uuid) TO service_role;

SELECT cron.schedule('andromeda-interrupted-digest-recovery-v3', '0,20 14 * * *',
  $cron$SELECT public.dispatch_missing_eligible_digests_20261107(false);$cron$);

COMMIT;
