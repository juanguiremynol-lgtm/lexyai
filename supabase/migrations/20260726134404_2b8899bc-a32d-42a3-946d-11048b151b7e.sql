-- _canon_backfill_report, demo_radicado_cache, demo_rate_limit_counters:
-- written and read exclusively by edge functions running with the service role
-- (demo-telemetry, demo-radicado-lookup, syncOrchestrator). No UI access.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['_canon_backfill_report','demo_radicado_cache','demo_rate_limit_counters']
  LOOP
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
       WHERE c.relname = t AND p.polname = 'Service role full access'
    ) THEN
      EXECUTE format(
        'CREATE POLICY "Service role full access" ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t);
    END IF;
  END LOOP;
END;
$$;