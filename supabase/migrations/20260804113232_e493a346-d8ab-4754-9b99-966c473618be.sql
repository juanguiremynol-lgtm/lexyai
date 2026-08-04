CREATE OR REPLACE FUNCTION public.cron_job_health()
RETURNS TABLE (
  jobid bigint,
  jobname text,
  schedule text,
  active boolean,
  last_run timestamptz,
  last_status text,
  last_success timestamptz,
  consecutive_failures integer,
  never_succeeded boolean,
  failing_hours numeric,
  last_error text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, cron
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT j.jobid, j.jobname::text AS jobname, j.schedule::text AS schedule, j.active,
      (SELECT max(d.start_time) FROM cron.job_run_details d WHERE d.jobid = j.jobid) AS last_run,
      (SELECT d.status::text FROM cron.job_run_details d WHERE d.jobid = j.jobid ORDER BY d.start_time DESC LIMIT 1) AS last_status,
      (SELECT left(d.return_message, 300) FROM cron.job_run_details d WHERE d.jobid = j.jobid ORDER BY d.start_time DESC LIMIT 1) AS last_error,
      (SELECT max(d.start_time) FROM cron.job_run_details d WHERE d.jobid = j.jobid AND d.status = 'succeeded') AS last_success
    FROM cron.job j
  )
  SELECT b.jobid, b.jobname, b.schedule, b.active, b.last_run, b.last_status, b.last_success,
    COALESCE((
      SELECT count(*)::int FROM cron.job_run_details d
      WHERE d.jobid = b.jobid
        AND d.status <> 'succeeded'
        AND (b.last_success IS NULL OR d.start_time > b.last_success)
    ), 0) AS consecutive_failures,
    (b.last_success IS NULL AND b.last_run IS NOT NULL) AS never_succeeded,
    CASE WHEN b.last_run IS NULL THEN 0
         WHEN b.last_success IS NULL THEN round(EXTRACT(epoch FROM (now() - (SELECT min(d.start_time) FROM cron.job_run_details d WHERE d.jobid = b.jobid))) / 3600.0, 2)
         WHEN b.last_status <> 'succeeded' THEN round(EXTRACT(epoch FROM (now() - b.last_success)) / 3600.0, 2)
         ELSE 0 END AS failing_hours,
    CASE WHEN b.last_status = 'succeeded' THEN NULL ELSE b.last_error END AS last_error
  FROM base b
  ORDER BY b.jobname;
END;
$$;

REVOKE ALL ON FUNCTION public.cron_job_health() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cron_job_health() TO service_role;
GRANT EXECUTE ON FUNCTION public.cron_job_health() TO authenticated;