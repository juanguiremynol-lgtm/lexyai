-- Exact rollback of cron_retry_window_lexy_manual_20261117.sql: restores job 67 command (md5-verified
-- 4c67d49e32e2170d5f77541a9176500e) and schedule '30 12-15 * * *', and re-activates job 34.
DO $$
DECLARE cur record; orig text; gate constant text := ' WHERE EXISTS (SELECT 1 FROM public.sync_retry_queue q WHERE q.next_run_at<=now() AND (q.claimed_at IS NULL OR q.claimed_at<now()-interval ''10 minutes''));';
BEGIN
  SELECT command INTO cur FROM cron.job WHERE jobid=67;
  IF right(cur.command,length(gate))=gate THEN
    orig := left(cur.command, length(cur.command)-length(gate))||';';
    IF md5(orig)<>'4c67d49e32e2170d5f77541a9176500e' THEN RAISE EXCEPTION 'unwrap hash mismatch'; END IF;
    PERFORM cron.alter_job(67, schedule:='30 12-15 * * *', command:=orig);
  END IF;
  PERFORM cron.alter_job(34, active:=true);
END $$;
