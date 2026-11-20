BEGIN;
DO $install$
BEGIN
  IF to_regprocedure('public.claim_atenia_daily_preflight()') IS NOT NULL THEN
    IF md5(pg_get_functiondef('public.claim_atenia_daily_preflight()'::regprocedure)) <> '79eb920826972f3bc225c3180b2eb420' THEN RAISE EXCEPTION 'Unknown daily preflight revision'; END IF;
    RETURN;
  END IF;
  EXECUTE $ddl$CREATE FUNCTION public.claim_atenia_daily_preflight() RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $fn$
DECLARE
  ts timestamptz := statement_timestamp();
  day_key text := (ts AT TIME ZONE 'America/Bogota')::date::text;
  claimed integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.atenia_preflight_checks WHERE organization_id IS NULL
    AND trigger IN ('PRE_HEARTBEAT','PRE_DAILY_SYNC','CONTROLLED_DAILY_PREFLIGHT') AND finished_at IS NOT NULL
    AND started_at >= (day_key::date::timestamp AT TIME ZONE 'America/Bogota')
    AND started_at <= ts AND finished_at <= ts) THEN
    RETURN 'CACHED';
  END IF;
  INSERT INTO public.cron_state AS s(key,value,updated_at)
    VALUES ('atenia:platform:daily_preflight', jsonb_build_object('day',day_key,'attempts',1,'next_try_at',ts+interval '15 minutes'),ts)
    ON CONFLICT(key) DO UPDATE SET
      value = jsonb_build_object('day',day_key,'next_try_at',ts+interval '15 minutes','attempts',
        CASE WHEN s.value->>'day'=day_key THEN (s.value->>'attempts')::int+1 ELSE 1 END),
      updated_at=ts
    WHERE s.value->>'day' IS DISTINCT FROM day_key
       OR ((s.value->>'attempts')::int < 2 AND (s.value->>'next_try_at')::timestamptz <= ts);
  GET DIAGNOSTICS claimed = ROW_COUNT;
  RETURN CASE WHEN claimed=1 THEN 'RUN' ELSE 'DEFERRED' END;
END;
$fn$;$ddl$;
END;
$install$;
REVOKE ALL ON FUNCTION public.claim_atenia_daily_preflight() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_atenia_daily_preflight() TO service_role;
COMMIT;
