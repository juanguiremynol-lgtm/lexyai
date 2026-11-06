-- Keep the existing daily schedule and job identity. The old anonymous JWT
-- was rejected by requirePrivilegedCaller, even though pg_cron recorded that
-- its asynchronous HTTP request had been queued successfully.
-- Secrets are resolved inside Postgres at execution time and are not embedded
-- in the job command, source control, or logs.
DO $migration$
DECLARE
  target_job bigint;
  matched_jobs integer;
BEGIN
  SELECT count(*), min(jobid) INTO matched_jobs, target_job
  FROM cron.job WHERE jobname = 'daily-sync';
  IF matched_jobs <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one daily-sync job, found %', matched_jobs;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL')
    OR NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'CRON_SERVICE_KEY') THEN
    RAISE EXCEPTION 'Daily sync requires the existing URL and cron credentials';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobid = target_job AND command LIKE '%/functions/v1/scheduled-daily-sync%') THEN
    RAISE EXCEPTION 'The existing job does not target scheduled-daily-sync';
  END IF;

  PERFORM cron.alter_job(job_id := target_job, command := $job$
    SELECT net.http_post(
      url := rtrim((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1), '/')
        || '/functions/v1/scheduled-daily-sync',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key',
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SERVICE_KEY' LIMIT 1)),
      body := '{"source":"cron"}'::jsonb,
      timeout_milliseconds := 135000
    );
  $job$);
END
$migration$;
