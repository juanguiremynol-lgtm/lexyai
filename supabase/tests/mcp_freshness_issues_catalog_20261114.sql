-- Read-only catalog checks for mcp_list_freshness_issues (no writes, no fixtures).
-- Not an OAuth/session test; behavioral RLS was verified separately by a real MCP call.
SELECT md5(pg_get_functiondef(to_regprocedure('public.mcp_list_freshness_issues(uuid,integer,uuid)')::oid)) = '4bd7db655d8b4258749ed903cee3a391' AS hash_ok,
       NOT p.prosecdef AS invoker_ok,
       NOT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_denied,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_allowed,
       pg_get_functiondef(p.oid) ~ 'lifecycle_state=''ACTIVE'' AND w.monitoring_enabled' AS scope_ok,
       pg_get_functiondef(p.oid) ~ 'IS DISTINCT FROM ''true''' AS plan_gap_listed
FROM pg_proc p WHERE p.oid = to_regprocedure('public.mcp_list_freshness_issues(uuid,integer,uuid)');
