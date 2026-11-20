-- Remove only the exact installed compatibility path. Retain all written traces.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL search_path = pg_catalog;
LOCK TABLE public.atenia_cron_runs IN SHARE ROW EXCLUSIVE MODE;
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE t.tgrelid = 'public.atenia_cron_runs'::regclass
      AND t.tgname = 'tr_normalize_atenia_cron_trace_outcome'
      AND p.oid = 'public.normalize_atenia_cron_trace_outcome()'::regprocedure
      AND NOT p.prosecdef AND p.proconfig = ARRAY['search_path=pg_catalog'] AND t.tgenabled = 'O'
      AND md5(p.prosrc) = 'b8984241433fef66c3ac64263d6a5f61'
      AND md5(pg_get_triggerdef(t.oid)) = '3facbd5d78bb0eae9bf307d4f2818e3f'
  ) THEN
    RAISE EXCEPTION 'Cron trace definition changed; inspect before rollback';
  END IF;
END;
$guard$;
DROP TRIGGER tr_normalize_atenia_cron_trace_outcome ON public.atenia_cron_runs;
DROP FUNCTION public.normalize_atenia_cron_trace_outcome();
COMMIT;
