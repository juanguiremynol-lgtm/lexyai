-- DB-backed acceptance test for MCP per-user management (migrations 0060/0061).
-- Runs entirely inside one transaction and ALWAYS rolls back by raising
-- TEST_RESULTS at the end: fixtures are synthetic users/sessions/OAuth client;
-- no real portfolio record is read or written. Run as the database owner.
DO $test$
DECLARE
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); cl uuid := gen_random_uuid();
  s_native uuid := gen_random_uuid(); s_oauth uuid := gen_random_uuid(); s_b uuid := gen_random_uuid();
  consent uuid := gen_random_uuid();
  log text := ''; fails int := 0; r jsonb; r2 jsonb; wi uuid; wi_upd timestamptz; v text; n int;
  nat jsonb; oau jsonb; bnat jsonb;
BEGIN
  INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (a, 'authenticated', 'authenticated', 'mcp-test-a-' || a || '@example.invalid', now(), '{}', '{}', now(), now()),
         (b, 'authenticated', 'authenticated', 'mcp-test-b-' || b || '@example.invalid', now(), '{}', '{}', now(), now());
  INSERT INTO auth.oauth_clients (id, registration_type, redirect_uris, grant_types, client_name, token_endpoint_auth_method)
  VALUES (cl, 'dynamic', 'https://example.invalid/cb', 'authorization_code,refresh_token', 'Test agent', 'none');
  INSERT INTO auth.oauth_consents (id, user_id, client_id, scopes, granted_at) VALUES (consent, a, cl, 'openid email', now());
  INSERT INTO auth.sessions (id, user_id, oauth_client_id) VALUES (s_native, a, NULL), (s_oauth, a, cl), (s_b, b, NULL);

  nat  := jsonb_build_object('sub', a, 'role', 'authenticated', 'session_id', s_native);
  oau  := jsonb_build_object('sub', a, 'role', 'authenticated', 'session_id', s_oauth, 'client_id', cl);
  bnat := jsonb_build_object('sub', b, 'role', 'authenticated', 'session_id', s_b);

  -- helper macro pattern: set claims + role, call, reset
  -- 1. surfaces
  PERFORM set_config('request.jwt.claims', nat::text, true); SET LOCAL ROLE authenticated;
  v := public.mcp_access_level(); RESET ROLE;
  IF v <> 'first_party' THEN fails := fails + 1; log := log || 'FAIL native level=' || v || E'\n'; ELSE log := log || E'ok native=first_party\n'; END IF;
  PERFORM set_config('request.jwt.claims', oau::text, true); SET LOCAL ROLE authenticated;
  v := public.mcp_access_level(); RESET ROLE;
  IF v <> 'read' THEN fails := fails + 1; log := log || 'FAIL oauth default=' || v || E'\n'; ELSE log := log || E'ok oauth default=read (no backfill)\n'; END IF;
  -- claim without client but session belongs to OAuth client -> still oauth
  PERFORM set_config('request.jwt.claims', (oau - 'client_id')::text, true); SET LOCAL ROLE authenticated;
  v := public.mcp_access_level(); RESET ROLE;
  IF v <> 'read' THEN fails := fails + 1; log := log || 'FAIL oauth w/o client claim=' || v || E'\n'; ELSE log := log || E'ok oauth session resolved without client claim\n'; END IF;

  -- 2. OAuth cannot self-escalate
  BEGIN
    PERFORM set_config('request.jwt.claims', oau::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.grant_mcp_client_access(cl, 'manage'); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL oauth self-grant succeeded\n';
  EXCEPTION WHEN others THEN RESET ROLE; log := log || 'ok oauth self-grant denied: ' || left(SQLERRM, 40) || E'\n'; END;

  -- 3. Read-only OAuth: direct REST write and RPC write blocked (zero mutation)
  PERFORM set_config('request.jwt.claims', nat::text, true); SET LOCAL ROLE authenticated;
  r := public.mcp_create_work_item('CGP', 'BORRADOR', NULL, 'Prueba MCP aislada', NULL, NULL, NULL, NULL, 'PENDIENTE_DE_RADICACION', 'create-key-0001');
  RESET ROLE;
  wi := (r->'work_item'->>'id')::uuid;
  IF wi IS NULL THEN fails := fails + 1; log := log || 'FAIL native create ' || r::text || E'\n'; ELSE log := log || E'ok first-party create via RPC\n'; END IF;
  SELECT updated_at INTO wi_upd FROM public.work_items WHERE id = wi;

  PERFORM set_config('request.jwt.claims', oau::text, true); SET LOCAL ROLE authenticated;
  UPDATE public.work_items SET title = 'hacked' WHERE id = wi; GET DIAGNOSTICS n = ROW_COUNT; RESET ROLE;
  IF n <> 0 THEN fails := fails + 1; log := log || E'FAIL read-only oauth direct UPDATE affected rows\n'; ELSE log := log || E'ok read-only oauth direct UPDATE affected 0 rows\n'; END IF;
  BEGIN
    PERFORM set_config('request.jwt.claims', oau::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.set_work_item_lifecycle(wi, 'ARCHIVED', 'x', 'USER', NULL, '{}'); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL read-only oauth direct lifecycle RPC\n';
  EXCEPTION WHEN others THEN RESET ROLE; log := log || E'ok read-only oauth direct lifecycle RPC denied\n'; END;
  BEGIN
    PERFORM set_config('request.jwt.claims', oau::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.mcp_work_item_lifecycle(wi, 'archive', wi_upd, 'arch-key-0001'); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL read-only oauth mcp lifecycle\n';
  EXCEPTION WHEN others THEN RESET ROLE; log := log || 'ok read-only oauth mcp lifecycle denied (' || SQLSTATE || E')\n'; END;
  IF (SELECT lifecycle_state::text FROM public.work_items WHERE id = wi) <> 'ACTIVE'
     OR EXISTS (SELECT 1 FROM public.mcp_idempotency WHERE user_id = a AND action = 'work_item_lifecycle') THEN
    fails := fails + 1; log := log || E'FAIL mutation/idempotency row left after denial\n';
  ELSE log := log || E'ok zero mutation after denial\n'; END IF;

  -- 4. Grant manage from first-party; OAuth now allowed
  PERFORM set_config('request.jwt.claims', nat::text, true); SET LOCAL ROLE authenticated;
  r := public.grant_mcp_client_access(cl, 'manage'); RESET ROLE;
  PERFORM set_config('request.jwt.claims', oau::text, true); SET LOCAL ROLE authenticated;
  v := public.mcp_access_level(); RESET ROLE;
  IF v <> 'manage' THEN fails := fails + 1; log := log || 'FAIL after grant level=' || v || E'\n'; ELSE log := log || E'ok first-party grant -> manage\n'; END IF;

  -- 5. Cross-owner: B cannot act on A's matter
  BEGIN
    PERFORM set_config('request.jwt.claims', bnat::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.mcp_work_item_lifecycle(wi, 'archive', wi_upd, 'arch-key-b001'); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL cross-owner archive\n';
  EXCEPTION WHEN others THEN RESET ROLE; log := log || 'ok cross-owner denied (' || SQLSTATE || E')\n'; END;
  BEGIN
    PERFORM set_config('request.jwt.claims', bnat::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.set_work_item_lifecycle(wi, 'DELETED', 'x', 'USER', a, '{}'); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL cross-owner direct lifecycle\n';
  EXCEPTION WHEN others THEN RESET ROLE; log := log || E'ok cross-owner direct lifecycle denied\n'; END;
  -- anonymous
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true); SET LOCAL ROLE anon;
    PERFORM public.mcp_work_item_lifecycle(wi, 'archive', wi_upd, 'arch-key-anon'); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL anon call\n';
  EXCEPTION WHEN others THEN RESET ROLE; log := log || E'ok anonymous denied\n'; END;

  -- 6. Stale revision
  BEGIN
    PERFORM set_config('request.jwt.claims', oau::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.mcp_work_item_lifecycle(wi, 'archive', wi_upd - interval '1 second', 'arch-key-stale'); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL stale revision accepted\n';
  EXCEPTION WHEN others THEN RESET ROLE; log := log || 'ok stale revision rejected (' || SQLSTATE || E')\n'; END;

  -- 7. Trash, retry same key = same result, changed payload conflicts, restore
  PERFORM set_config('request.jwt.claims', oau::text, true); SET LOCAL ROLE authenticated;
  r := public.mcp_work_item_lifecycle(wi, 'trash', wi_upd, 'trash-key-0001');
  r2 := public.mcp_work_item_lifecycle(wi, 'trash', wi_upd, 'trash-key-0001'); RESET ROLE;
  IF (r2->>'replayed')::boolean IS NOT TRUE OR r->'work_item' <> r2->'work_item' THEN
    fails := fails + 1; log := log || E'FAIL retry not replayed identically\n';
  ELSE log := log || 'ok retry replayed; recovery_deadline=' || (r->>'recovery_deadline') || E'\n'; END IF;
  SELECT count(*) INTO n FROM public.mcp_action_audit WHERE user_id = a AND action = 'work_item_lifecycle';
  IF n <> 1 THEN fails := fails + 1; log := log || 'FAIL audit rows=' || n || E'\n'; ELSE log := log || E'ok exactly one audit row (oauth client recorded)\n'; END IF;
  IF (SELECT oauth_client_id FROM public.mcp_action_audit WHERE user_id = a AND action = 'work_item_lifecycle') IS DISTINCT FROM cl THEN
    fails := fails + 1; log := log || E'FAIL audit client not derived from session\n'; END IF;
  IF NOT ((r->'work_item'->>'purge_after')::timestamptz BETWEEN now() + interval '9 days 23 hours' AND now() + interval '10 days 1 hour') THEN
    fails := fails + 1; log := log || E'FAIL retention not 10 days\n'; END IF;
  BEGIN
    PERFORM set_config('request.jwt.claims', oau::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.mcp_work_item_lifecycle(wi, 'archive', wi_upd, 'trash-key-0001'); RESET ROLE;
  EXCEPTION WHEN others THEN RESET ROLE; END;
  BEGIN
    PERFORM set_config('request.jwt.claims', oau::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.mcp_work_item_lifecycle(wi, 'restore', wi_upd, 'trash-key-0001'); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL key reuse with changed payload accepted\n';
  EXCEPTION WHEN others THEN RESET ROLE; log := log || 'ok key reuse with changed payload rejected: ' || left(SQLERRM, 30) || E'\n'; END;
  SELECT updated_at INTO wi_upd FROM public.work_items WHERE id = wi;
  PERFORM set_config('request.jwt.claims', oau::text, true); SET LOCAL ROLE authenticated;
  r := public.mcp_work_item_lifecycle(wi, 'restore', wi_upd, 'restore-key-01'); RESET ROLE;
  IF r->'work_item'->>'lifecycle_state' <> 'ACTIVE' OR r->'work_item'->>'deleted_at' IS NOT NULL THEN
    fails := fails + 1; log := log || 'FAIL restore ' || r::text || E'\n';
  ELSE log := log || 'ok restore ACTIVE, deleted_at cleared, monitoring_enabled=' || (r->'work_item'->>'monitoring_enabled') || E'\n'; END IF;

  -- 8. Revocation and reconnect do not resurrect manage
  PERFORM set_config('request.jwt.claims', nat::text, true); SET LOCAL ROLE authenticated;
  PERFORM public.revoke_mcp_client_access(cl); RESET ROLE;
  PERFORM set_config('request.jwt.claims', oau::text, true); SET LOCAL ROLE authenticated;
  v := public.mcp_access_level(); RESET ROLE;
  IF v <> 'read' THEN fails := fails + 1; log := log || E'FAIL revoke\n'; ELSE log := log || E'ok revoke -> read\n'; END IF;
  PERFORM set_config('request.jwt.claims', nat::text, true); SET LOCAL ROLE authenticated;
  PERFORM public.grant_mcp_client_access(cl, 'manage'); RESET ROLE;
  UPDATE auth.oauth_consents SET revoked_at = now() WHERE id = consent;
  INSERT INTO auth.oauth_consents (user_id, client_id, scopes, granted_at) VALUES (a, cl, 'openid', now() + interval '1 second');
  PERFORM set_config('request.jwt.claims', oau::text, true); SET LOCAL ROLE authenticated;
  v := public.mcp_access_level(); RESET ROLE;
  IF v <> 'read' THEN fails := fails + 1; log := log || E'FAIL reconnect resurrected manage\n'; ELSE log := log || E'ok reconnect after consent revocation -> read\n'; END IF;

  -- 9. Updates cursor: foreign cursor rejected
  PERFORM set_config('request.jwt.claims', nat::text, true); SET LOCAL ROLE authenticated;
  r := public.mcp_list_updates(NULL, 5, wi); RESET ROLE;
  BEGIN
    PERFORM set_config('request.jwt.claims', bnat::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.mcp_list_updates(r->>'next_cursor', 5, wi); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL foreign cursor accepted\n';
  EXCEPTION WHEN others THEN RESET ROLE; log := log || E'ok foreign cursor rejected\n'; END;
  log := log || 'info lifecycle events for fixture=' || jsonb_array_length(r->'events') || E'\n';

  RAISE EXCEPTION 'TEST_RESULTS fails=% %', fails, E'\n' || log;
END $test$;
