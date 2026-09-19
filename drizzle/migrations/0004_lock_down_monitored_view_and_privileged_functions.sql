-- Audit finding 1: v_monitored_work_items is owner-privileged (postgres bypasses
-- RLS), automatically updatable, and granted to anon/authenticated with full
-- DML. No client code reads it: every consumer is a service-role edge function.
-- Close it to clients entirely and make it caller-scoped if it is ever reopened.
ALTER VIEW public.v_monitored_work_items SET (security_invoker = on, security_barrier = on);

REVOKE ALL ON public.v_monitored_work_items FROM PUBLIC;
REVOKE ALL ON public.v_monitored_work_items FROM anon;
REVOKE ALL ON public.v_monitored_work_items FROM authenticated;
GRANT SELECT ON public.v_monitored_work_items TO service_role;

-- Audit finding 3: privileged SECURITY DEFINER / analytical functions are
-- executable by anonymous callers. They read mailbox connections, write alerts,
-- and return case identifiers. Restrict them to the backend identity.
REVOKE ALL ON FUNCTION public.detect_email_connection_failures(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.detect_email_connection_failures(integer, integer) TO service_role;

DO $$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('source_coverage_exceptions', 'source_coverage_persistence', 'client_wa_generate_drafts')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.sig);
  END LOOP;
END $$;