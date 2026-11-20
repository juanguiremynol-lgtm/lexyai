BEGIN;
DO $undo$ BEGIN
  IF to_regprocedure('public.claim_atenia_daily_preflight()') IS NULL THEN RETURN; END IF;
  IF md5(pg_get_functiondef('public.claim_atenia_daily_preflight()'::regprocedure)) <> '79eb920826972f3bc225c3180b2eb420' THEN RAISE EXCEPTION 'Unknown daily preflight revision'; END IF;
  DROP FUNCTION public.claim_atenia_daily_preflight();
END $undo$;
COMMIT;
