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
  WITH recent AS (
    SELECT d.jobid, d.status::text AS status, d.start_time, d.return_message
    FROM cron.job_run_details d
    WHERE d.start_time > now() - interval '7 days'
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
  )
  SELECT j.jobid,
         j.jobname::text,
         j.schedule::text,
         j.active,
         a.last_run,
         l.status,
         a.last_success,
         COALESCE(f.c, 0),
         (a.last_success IS NULL AND a.last_run IS NOT NULL),
         CASE
           WHEN a.last_run IS NULL THEN 0::numeric
           WHEN a.last_success IS NULL THEN round(EXTRACT(epoch FROM (now() - a.first_run)) / 3600.0, 2)
           WHEN l.status <> 'succeeded' THEN round(EXTRACT(epoch FROM (now() - a.last_success)) / 3600.0, 2)
           ELSE 0::numeric
         END,
         CASE WHEN l.status = 'succeeded' THEN NULL ELSE left(l.return_message, 300) END
  FROM cron.job j
  LEFT JOIN agg a ON a.jobid = j.jobid
  LEFT JOIN latest l ON l.jobid = j.jobid
  LEFT JOIN fails f ON f.jobid = j.jobid
  ORDER BY j.jobname;
END;
$$;

REVOKE ALL ON FUNCTION public.cron_job_health() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cron_job_health() TO service_role;
GRANT EXECUTE ON FUNCTION public.cron_job_health() TO authenticated;