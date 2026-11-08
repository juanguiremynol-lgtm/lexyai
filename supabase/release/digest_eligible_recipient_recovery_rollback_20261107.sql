-- Stop the broader scheduler. Reactivating the former owner-only job would
-- ignore the organization's preference and is intentionally not automatic.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='andromeda-eligible-digest-catchup-v2';
