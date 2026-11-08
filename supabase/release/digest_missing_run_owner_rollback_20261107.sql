-- Stop future automatic owner-scoped recovery without deleting audit history.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'andromeda-owner-digest-catchup-v1';
