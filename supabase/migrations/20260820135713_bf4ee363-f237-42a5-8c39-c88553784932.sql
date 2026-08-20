-- P0.2-bis: snapshot table decoupling health checks from cron.job_run_details
CREATE TABLE IF NOT EXISTS public.cron_health_snapshot (
  jobid bigint PRIMARY KEY,
  last_run timestamptz,
  last_status text,
  last_success timestamptz,
  first_run timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0,
  last_error text,
  refreshed_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.cron_health_snapshot TO authenticated;
GRANT ALL ON public.cron_health_snapshot TO service_role;
ALTER TABLE public.cron_health_snapshot ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform admins read cron health snapshot" ON public.cron_health_snapshot;
CREATE POLICY "platform admins read cron health snapshot"
  ON public.cron_health_snapshot FOR SELECT TO authenticated
  USING (public.is_platform_admin());

CREATE INDEX IF NOT EXISTS idx_cron_health_snapshot_refreshed
  ON public.cron_health_snapshot (refreshed_at DESC);

CREATE OR REPLACE FUNCTION public.refresh_cron_health_snapshot()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'cron'
AS $function$
DECLARE
  v_n integer;
BEGIN
  WITH recent AS (
    SELECT d.jobid, d.status::text AS status, d.start_time, d.return_message
    FROM cron.job_run_details d
    WHERE d.start_time > now() - interval '24 hours'
  ),
  agg AS (
    SELECT r.jobid,
           max(r.start_time) AS last_run,
           max(r.start_time) FILTER (WHERE r.status = 'succeeded') AS last_success,
           min(r.start_time) AS first_run
    FROM recent r GROUP BY r.jobid
  ),
  latest AS (
    SELECT DISTINCT ON (r.jobid) r.jobid, r.status, r.return_message
    FROM recent r ORDER BY r.jobid, r.start_time DESC
  ),
  fails AS (
    SELECT r.jobid, count(*)::int AS c
    FROM recent r JOIN agg a ON a.jobid = r.jobid
    WHERE r.status <> 'succeeded'
      AND (a.last_success IS NULL OR r.start_time > a.last_success)
    GROUP BY r.jobid
  ),
  snap AS (
    SELECT a.jobid, a.last_run, l.status AS last_status, a.last_success, a.first_run,
           COALESCE(f.c, 0) AS consecutive_failures,
           CASE WHEN l.status = 'succeeded' THEN NULL ELSE left(l.return_message, 300) END AS last_error
    FROM agg a
    LEFT JOIN latest l ON l.jobid = a.jobid
    LEFT JOIN fails f ON f.jobid = a.jobid
  )
  INSERT INTO public.cron_health_snapshot AS s
    (jobid, last_run, last_status, last_success, first_run, consecutive_failures, last_error, refreshed_at)
  SELECT snap.jobid, snap.last_run, snap.last_status, snap.last_success, snap.first_run,
         snap.consecutive_failures, snap.last_error, now()
  FROM snap
  ON CONFLICT (jobid) DO UPDATE SET
    last_run = EXCLUDED.last_run,
    last_status = EXCLUDED.last_status,
    last_success = COALESCE(EXCLUDED.last_success, s.last_success),
    first_run = LEAST(COALESCE(s.first_run, EXCLUDED.first_run), EXCLUDED.first_run),
    consecutive_failures = EXCLUDED.consecutive_failures,
    last_error = EXCLUDED.last_error,
    refreshed_at = now();

  GET DIAGNOSTICS v_n = ROW_COUNT;

  DELETE FROM public.cron_health_snapshot s
  WHERE NOT EXISTS (SELECT 1 FROM cron.job j WHERE j.jobid = s.jobid);

  RETURN v_n;
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_cron_health_snapshot() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_cron_health_snapshot() TO service_role;

-- P0.2: health check now reads the snapshot; signature unchanged
CREATE OR REPLACE FUNCTION public.cron_job_health()
 RETURNS TABLE(jobid bigint, jobname text, schedule text, active boolean, last_run timestamp with time zone, last_status text, last_success timestamp with time zone, consecutive_failures integer, never_succeeded boolean, failing_hours numeric, last_error text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'cron'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT j.jobid,
         j.jobname::text,
         j.schedule::text,
         j.active,
         s.last_run,
         s.last_status,
         s.last_success,
         COALESCE(s.consecutive_failures, 0),
         (s.last_success IS NULL AND s.last_run IS NOT NULL),
         CASE
           WHEN s.last_run IS NULL THEN 0::numeric
           WHEN s.last_success IS NULL THEN round(EXTRACT(epoch FROM (now() - s.first_run)) / 3600.0, 2)
           WHEN s.last_status <> 'succeeded' THEN round(EXTRACT(epoch FROM (now() - s.last_success)) / 3600.0, 2)
           ELSE 0::numeric
         END,
         s.last_error
  FROM cron.job j
  LEFT JOIN public.cron_health_snapshot s ON s.jobid = j.jobid
  ORDER BY j.jobname;
END;
$function$;

-- P0.4: bounded, batched telemetry retention
CREATE OR REPLACE FUNCTION public.purge_platform_telemetry()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'cron'
AS $function$
DECLARE
  v_result jsonb := '{}'::jsonb;
  v_n bigint;
  v_batch int := 20000;
BEGIN
  WITH doomed AS (
    SELECT ctid FROM cron.job_run_details
    WHERE start_time < now() - interval '7 days' LIMIT v_batch
  )
  DELETE FROM cron.job_run_details d USING doomed WHERE d.ctid = doomed.ctid;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_result := v_result || jsonb_build_object('cron.job_run_details', v_n);

  WITH doomed AS (SELECT id FROM public.atenia_cron_runs WHERE started_at < now() - interval '14 days' LIMIT v_batch)
  DELETE FROM public.atenia_cron_runs t USING doomed WHERE t.id = doomed.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_result := v_result || jsonb_build_object('atenia_cron_runs', v_n);

  WITH doomed AS (SELECT id FROM public.platform_job_heartbeats WHERE created_at < now() - interval '14 days' LIMIT v_batch)
  DELETE FROM public.platform_job_heartbeats t USING doomed WHERE t.id = doomed.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_result := v_result || jsonb_build_object('platform_job_heartbeats', v_n);

  WITH doomed AS (SELECT id FROM public.sync_traces WHERE created_at < now() - interval '14 days' LIMIT v_batch)
  DELETE FROM public.sync_traces t USING doomed WHERE t.id = doomed.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_result := v_result || jsonb_build_object('sync_traces', v_n);

  WITH doomed AS (SELECT id FROM public.provider_sync_traces WHERE created_at < now() - interval '14 days' LIMIT v_batch)
  DELETE FROM public.provider_sync_traces t USING doomed WHERE t.id = doomed.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_result := v_result || jsonb_build_object('provider_sync_traces', v_n);

  WITH doomed AS (SELECT id FROM public.provider_raw_snapshots WHERE fetched_at < now() - interval '14 days' LIMIT v_batch)
  DELETE FROM public.provider_raw_snapshots t USING doomed WHERE t.id = doomed.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_result := v_result || jsonb_build_object('provider_raw_snapshots', v_n);

  WITH doomed AS (SELECT id FROM public.atenia_preflight_checks WHERE created_at < now() - interval '14 days' LIMIT v_batch)
  DELETE FROM public.atenia_preflight_checks t USING doomed WHERE t.id = doomed.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_result := v_result || jsonb_build_object('atenia_preflight_checks', v_n);

  WITH doomed AS (SELECT id FROM public.external_sync_run_attempts WHERE recorded_at < now() - interval '14 days' LIMIT v_batch)
  DELETE FROM public.external_sync_run_attempts t USING doomed WHERE t.id = doomed.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_result := v_result || jsonb_build_object('external_sync_run_attempts', v_n);

  WITH doomed AS (SELECT id FROM public.external_sync_runs WHERE created_at < now() - interval '30 days' LIMIT v_batch)
  DELETE FROM public.external_sync_runs t USING doomed WHERE t.id = doomed.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_result := v_result || jsonb_build_object('external_sync_runs', v_n);

  WITH doomed AS (SELECT id FROM public.notification_dispatch_runs WHERE started_at < now() - interval '30 days' LIMIT v_batch)
  DELETE FROM public.notification_dispatch_runs t USING doomed WHERE t.id = doomed.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_result := v_result || jsonb_build_object('notification_dispatch_runs', v_n);

  WITH doomed AS (
    SELECT id FROM public.atenia_ai_actions
    WHERE created_at < now() - interval '30 days'
      AND coalesce(status, '') <> 'PLANNED'
      AND coalesce(action_result, '') <> 'pending_approval'
    LIMIT v_batch
  )
  DELETE FROM public.atenia_ai_actions t USING doomed WHERE t.id = doomed.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_result := v_result || jsonb_build_object('atenia_ai_actions', v_n);

  WITH doomed AS (
    SELECT id FROM public.atenia_ai_remediation_queue
    WHERE (status = 'DONE' AND created_at < now() - interval '14 days')
       OR (status = 'FAILED' AND created_at < now() - interval '30 days')
    LIMIT v_batch
  )
  DELETE FROM public.atenia_ai_remediation_queue t USING doomed WHERE t.id = doomed.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_result := v_result || jsonb_build_object('atenia_ai_remediation_queue', v_n);

  WITH doomed AS (SELECT id FROM public.atenia_daily_ops_reports WHERE created_at < now() - interval '90 days' LIMIT v_batch)
  DELETE FROM public.atenia_daily_ops_reports t USING doomed WHERE t.id = doomed.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_result := v_result || jsonb_build_object('atenia_daily_ops_reports', v_n);

  WITH doomed AS (SELECT id FROM public.atenia_ai_reports WHERE created_at < now() - interval '90 days' LIMIT v_batch)
  DELETE FROM public.atenia_ai_reports t USING doomed WHERE t.id = doomed.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_result := v_result || jsonb_build_object('atenia_ai_reports', v_n);

  WITH doomed AS (SELECT id FROM public.atenia_ai_observations WHERE created_at < now() - interval '90 days' LIMIT v_batch)
  DELETE FROM public.atenia_ai_observations t USING doomed WHERE t.id = doomed.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_result := v_result || jsonb_build_object('atenia_ai_observations', v_n);

  WITH doomed AS (SELECT id FROM public.demo_events WHERE created_at < now() - interval '90 days' LIMIT v_batch)
  DELETE FROM public.demo_events t USING doomed WHERE t.id = doomed.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_result := v_result || jsonb_build_object('demo_events', v_n);

  RETURN v_result || jsonb_build_object('ran_at', now());
END;
$function$;

REVOKE ALL ON FUNCTION public.purge_platform_telemetry() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_platform_telemetry() TO service_role;

-- P0.3: drop duplicate daily-sync jobs (jobid 1 untouched)
SELECT cron.unschedule(11);
SELECT cron.unschedule(12);

-- schedules
SELECT cron.schedule('purge-platform-telemetry-daily', '15 8 * * *', $$SELECT public.purge_platform_telemetry();$$);
SELECT cron.schedule('cron-health-snapshot-hourly', '5 * * * *', $$SELECT public.refresh_cron_health_snapshot();$$);