DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT cl.relname AS tbl, p.polname AS pol
      FROM pg_policy p
      JOIN pg_class cl ON cl.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = cl.relnamespace
     WHERE n.nspname = 'public'
       AND p.polroles = '{0}'                    -- PUBLIC (includes anon + authenticated)
       AND p.polname ILIKE 'Service role%'
       AND p.polcmd IN ('a','w','d','*')
  LOOP
    EXECUTE format('ALTER POLICY %I ON public.%I TO service_role', r.pol, r.tbl);
  END LOOP;
END;
$$;