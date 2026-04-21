-- Helper RPC for the drift-guard regression test in
-- _shared/alertTypeConstants_test.ts. Returns the source of all
-- notifiability-related trigger functions so the test can scan for
-- non-canonical alert_type literals.
CREATE OR REPLACE FUNCTION public.get_notifiability_function_bodies()
RETURNS TABLE (proname text, prosrc text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
  SELECT p.proname::text, p.prosrc::text
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND (p.proname LIKE 'handle_%notifiab%'
          OR p.proname LIKE 'set_%notifiable%');
$$;

REVOKE ALL ON FUNCTION public.get_notifiability_function_bodies() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_notifiability_function_bodies() TO service_role;