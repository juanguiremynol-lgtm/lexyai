BEGIN ISOLATION LEVEL REPEATABLE READ;
-- Restore the prior byte-for-byte commands.
-- Keep schedules, callers, headers and vault references unchanged. No worker invocation.
DO $release$
DECLARE
  j record;
  new_command text;
  from_hash text;
  to_hash text;
  gate constant text := $gate$ WHERE EXISTS (SELECT 1 FROM public.sync_retry_queue q WHERE q.next_run_at<=now() AND (q.claimed_at IS NULL OR q.claimed_at<now()-interval '10 minutes'));$gate$;
  old_id_test constant text := $expr$COALESCE(c.value->>'backend_run_id','')<>''$expr$;
  new_id_test constant text := $expr$COALESCE(c.value->>'backend_run_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'$expr$;
BEGIN
  IF (SELECT count(*) FROM cron.job WHERE jobid IN (95, 99)) <> 2 THEN
    RAISE EXCEPTION 'Expected retry scheduler jobs are missing';
  END IF;
  FOR j IN SELECT jobid, jobname, schedule, active, command
             FROM cron.job WHERE jobid IN (95, 99) ORDER BY jobid LOOP
    IF NOT j.active THEN RAISE EXCEPTION 'Unexpected inactive job %', j.jobid; END IF;
    IF j.jobid = 95 THEN
      IF j.jobname <> 'process-retry-queue-night-net' OR j.schedule <> '30 16 * * *' THEN
        RAISE EXCEPTION 'Unexpected final drain definition';
      END IF;
      from_hash := '3c65a7ae33338db1c2b5850840f9c613';
      to_hash := '4c67d49e32e2170d5f77541a9176500e';
      new_command := left(j.command, length(j.command) - length(gate)) || ';';
    ELSE
      IF j.jobname <> 'pp-run-followup-15m' OR j.schedule <> '7-59/15 12-16 * * *' THEN
        RAISE EXCEPTION 'Unexpected PP follow-up definition';
      END IF;
      from_hash := '06a9c9cd0a4e5b8c20025e01b2239578';
      to_hash := '06037be289114dce63546d37cb0d7caf';
      new_command := replace(j.command, new_id_test, old_id_test);
    END IF;
    IF md5(j.command) = to_hash THEN CONTINUE; END IF;
    IF md5(j.command) <> from_hash OR md5(new_command) <> to_hash THEN
      RAISE EXCEPTION 'Unrecognized command for job %', j.jobid;
    END IF;
    PERFORM cron.alter_job(j.jobid, command := new_command);
  END LOOP;
END
$release$;
COMMIT;
