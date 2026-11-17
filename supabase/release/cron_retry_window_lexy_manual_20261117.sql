-- Follow-up to cron_daily_cadence_20261117.sql (owner-authorized, 2026-11-17).
-- 1) Job 67 process-retry-queue: due-only continuation window '2-59/5 12-15 * * *' (48 calls/day),
--    with a cheap EXISTS gate mirroring claim_sync_retry eligibility (due, unleased or lease >10 min),
--    kind-agnostic so ACT/PUB/PP-poll slots all stay reachable; empty queue => no HTTP.
--    The original command reads its URL/key from vault (no credential in this file); the gate is a
--    literal suffix, removed exactly by the rollback with md5 verification.
-- 2) Job 34 lexy-daily-message (optional AI narrative greeting): deactivated, definition kept.
DO $$
DECLARE cur record; gate constant text := ' WHERE EXISTS (SELECT 1 FROM public.sync_retry_queue q WHERE q.next_run_at<=now() AND (q.claimed_at IS NULL OR q.claimed_at<now()-interval ''10 minutes''));';
BEGIN
  SELECT schedule, active, command, md5(command) h INTO cur FROM cron.job WHERE jobid=67 AND jobname='process-retry-queue';
  IF NOT FOUND OR NOT cur.active THEN RAISE EXCEPTION 'job 67 missing/inactive'; END IF;
  IF cur.h='4c67d49e32e2170d5f77541a9176500e' AND cur.schedule='30 12-15 * * *' THEN
    PERFORM cron.alter_job(67, schedule:='2-59/5 12-15 * * *',
      command:=left(rtrim(cur.command), length(rtrim(cur.command))-1)||gate);
  ELSIF NOT (cur.schedule='2-59/5 12-15 * * *' AND right(cur.command,length(gate))=gate) THEN
    RAISE EXCEPTION 'job 67 state unknown, aborting';
  END IF;
  SELECT active, md5(command) h INTO cur FROM cron.job WHERE jobid=34 AND jobname='lexy-daily-message-generation';
  IF NOT FOUND OR cur.h<>'975ead04e59ac3d5993e0d408ebbf4e6' THEN RAISE EXCEPTION 'job 34 state unknown'; END IF;
  PERFORM cron.alter_job(34, active:=false);
END $$;
