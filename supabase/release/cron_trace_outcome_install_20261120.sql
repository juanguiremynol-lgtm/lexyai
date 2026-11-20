-- Compatibility for Edge versions that emit technical outcomes directly into status.
-- Canonical FAILED rows stay discoverable by existing reports. The exact outcome
-- and all counters are retained in details. Only new inserts from these jobs qualify.
BEGIN;
SET LOCAL lock_timeout = '2s';
CREATE FUNCTION public.normalize_atenia_cron_trace_outcome()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $body$
BEGIN
  NEW.details := NEW.details || jsonb_build_object('trace_outcome', NEW.status);
  NEW.status := 'FAILED';
  RETURN NEW;
END;
$body$;
REVOKE ALL ON FUNCTION public.normalize_atenia_cron_trace_outcome() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER tr_normalize_atenia_cron_trace_outcome
BEFORE INSERT ON public.atenia_cron_runs
FOR EACH ROW
WHEN (NEW.status IN ('ERROR','PARTIAL','TIMEOUT')
  AND NEW.job_name IN ('scheduled-daily-sync','fallback-sync-check','scheduled-alert-evaluator','dispatch-update-emails')
  AND jsonb_typeof(NEW.details) = 'object'
  AND NEW.details->>'run_mode' IN ('CRON','MANUAL','CONTINUATION','OVERFLOW','DRY_RUN'))
EXECUTE FUNCTION public.normalize_atenia_cron_trace_outcome();
COMMIT;
