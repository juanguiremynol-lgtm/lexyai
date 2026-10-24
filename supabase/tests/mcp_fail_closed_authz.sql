-- Rollback-only acceptance test for migration 0071 (fail-closed caller/consent/owner semantics).
-- Covers the validation list of the 2026-10-24 review patch. Synthetic fixtures; ALWAYS rolls back
-- by raising TEST_RESULTS. Run as the database owner. No provider calls, no real cases.
DO $test$
DECLARE
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  sa uuid := gen_random_uuid(); sb uuid := gen_random_uuid(); sexp uuid := gen_random_uuid();
  so uuid := gen_random_uuid(); sdel uuid := gen_random_uuid(); sb_o uuid := gen_random_uuid();
  so_ro uuid := gen_random_uuid();
  cl uuid := gen_random_uuid(); cldel uuid := gen_random_uuid(); cl2 uuid := gen_random_uuid();
  consent uuid := gen_random_uuid(); consent_b uuid := gen_random_uuid(); gt timestamptz := now();
  log text := ''; fails int := 0; v text; c jsonb; t record; org uuid;
  oauth jsonb;
BEGIN
  INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  SELECT x, 'authenticated', 'authenticated', 'fc-test-' || x || '@example.invalid', now(), '{}', '{}', now(), now() FROM unnest(ARRAY[a, b]) x;
  INSERT INTO public.organizations (name) VALUES ('Org fc') RETURNING id INTO org;
  INSERT INTO public.organization_memberships (organization_id, user_id, role) VALUES (org, a, 'MEMBER'), (org, b, 'OWNER');
  INSERT INTO auth.oauth_clients (id, client_type, grant_types, redirect_uris, registration_type, token_endpoint_auth_method, deleted_at)
  VALUES (cl, 'public', 'authorization_code', 'https://example.invalid/cb', 'dynamic', 'none', NULL),
         (cl2, 'public', 'authorization_code', 'https://example.invalid/cb', 'dynamic', 'none', NULL),
         (cldel, 'public', 'authorization_code', 'https://example.invalid/cb', 'dynamic', 'none', now());
  INSERT INTO auth.sessions (id, user_id, not_after, oauth_client_id, scopes) VALUES
    (sa, a, NULL, NULL, NULL), (sb, b, NULL, NULL, NULL), (sexp, a, now() - interval '1 minute', NULL, NULL),
    (so, a, NULL, cl, 'openid email'), (sdel, a, NULL, cldel, NULL), (sb_o, b, NULL, cl, NULL),
    (so_ro, a, NULL, cl, 'openid andromeda:read');
  INSERT INTO auth.oauth_consents (id, user_id, client_id, scopes, granted_at) VALUES
    (consent, a, cl, 'openid email', gt), (consent_b, b, cl, 'openid email', gt);
  oauth := jsonb_build_object('sub', a, 'role', 'authenticated', 'session_id', so, 'client_id', cl);

  -- helper-style loop: expected access level per claim set
  FOR t IN SELECT * FROM (VALUES
    (jsonb_build_object('sub', a, 'role', 'authenticated', 'session_id', sa), 'first_party', '1 native session'),
    (oauth, 'read', '2 oauth + consent, no grant'),
    (jsonb_build_object('sub', a, 'role', 'authenticated'), 'none', '4 missing sid'),
    (jsonb_build_object('sub', a, 'role', 'authenticated', 'session_id', 'zz'), 'none', '4 malformed sid'),
    (jsonb_build_object('sub', a, 'role', 'authenticated', 'session_id', gen_random_uuid()), 'none', '4 unknown sid'),
    (jsonb_build_object('sub', a, 'role', 'authenticated', 'session_id', sb), 'none', '4 wrong session user'),
    (jsonb_build_object('sub', a, 'role', 'authenticated', 'session_id', sexp), 'none', '4 expired'),
    (jsonb_build_object('sub', a, 'role', 'authenticated', 'session_id', so), 'none', '4 oauth session missing client claim'),
    (jsonb_build_object('sub', a, 'role', 'authenticated', 'session_id', so, 'client_id', 'zz'), 'none', '4 malformed client claim'),
    (jsonb_build_object('sub', a, 'role', 'authenticated', 'session_id', so, 'client_id', cl2), 'none', '4 mismatched client claim'),
    (jsonb_build_object('sub', a, 'role', 'authenticated', 'session_id', sdel, 'client_id', cldel), 'none', '5 deleted client'),
    (jsonb_build_object('sub', a, 'role', 'authenticated', 'session_id', sa, 'client_id', cl), 'none', '6 native session with client claim'),
    (jsonb_build_object('sub', a, 'session_id', sa), 'none', '8 role claim absent'),
    ('{}'::jsonb, 'none', '8 absent claims under SET ROLE authenticated')
  ) x(cl_, expected, label) LOOP
    PERFORM set_config('request.jwt.claims', t.cl_::text, true); SET LOCAL ROLE authenticated;
    v := public.mcp_access_level(); RESET ROLE;
    IF v = t.expected THEN log := log || 'ok ' || t.label || ' -> ' || v || E'\n';
    ELSE fails := fails + 1; log := log || 'FAIL ' || t.label || ' -> ' || v || E'\n'; END IF;
  END LOOP;

  -- 3. exact consent generation + manage grant => manage
  INSERT INTO public.mcp_client_grants (user_id, oauth_client_id, consent_id, consent_granted_at, access_level, granted_session_id)
  VALUES (a, cl, consent, gt, 'manage', sa);
  PERFORM set_config('request.jwt.claims', oauth::text, true); SET LOCAL ROLE authenticated;
  v := public.mcp_access_level(); RESET ROLE;
  IF v = 'manage' THEN log := log || E'ok 3 manage grant -> manage\n'; ELSE fails := fails + 1; log := log || 'FAIL 3 ' || v || E'\n'; END IF;

  -- narrower token scope keeps restricting the app grant
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', a, 'role', 'authenticated', 'session_id', so_ro, 'client_id', cl)::text, true);
  SET LOCAL ROLE authenticated; v := public.mcp_access_level(); RESET ROLE;
  IF v = 'read' THEN log := log || E'ok andromeda:read scope caps manage grant\n'; ELSE fails := fails + 1; log := log || 'FAIL scope ' || v || E'\n'; END IF;

  -- 5. user/client mismatch: b on same client has consent but grant belongs to a
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', b, 'role', 'authenticated', 'session_id', sb_o, 'client_id', cl)::text, true);
  SET LOCAL ROLE authenticated; v := public.mcp_access_level(); RESET ROLE;
  IF v = 'read' THEN log := log || E'ok 5 other user same client not manage\n'; ELSE fails := fails + 1; log := log || 'FAIL 5 user mismatch ' || v || E'\n'; END IF;

  -- 7. OAuth caller cannot use grant/revoke guard
  BEGIN PERFORM set_config('request.jwt.claims', oauth::text, true); SET LOCAL ROLE authenticated;
    PERFORM public._mcp_require_first_party(); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL 7 oauth passed first-party guard\n';
  EXCEPTION WHEN others THEN RESET ROLE; log := log || E'ok 7 oauth denied first-party guard\n'; END;
  BEGIN PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', a, 'role', 'authenticated')::text, true); SET LOCAL ROLE authenticated;
    PERFORM public._mcp_require_first_party(); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL 7 unverified passed first-party guard\n';
  EXCEPTION WHEN others THEN RESET ROLE; log := log || E'ok 7 unverified denied first-party guard\n'; END;

  -- 11. owner-only: org OWNER b cannot manage a's item; a can (first_party); a via unverified cannot
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', b, 'role', 'authenticated', 'session_id', sb)::text, true);
  IF public._mcp_can_manage_work_item(a, org) THEN fails := fails + 1; log := log || E'FAIL 11 org owner manages others item\n';
  ELSE log := log || E'ok 11 org owner denied on others item\n'; END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', a, 'role', 'authenticated', 'session_id', sa)::text, true);
  IF public._mcp_can_manage_work_item(a, org) THEN log := log || E'ok 1 native owner manages own item\n';
  ELSE fails := fails + 1; log := log || E'FAIL 1 native owner denied\n'; END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', a, 'role', 'authenticated')::text, true);
  IF public._mcp_can_manage_work_item(a, org) THEN fails := fails + 1; log := log || E'FAIL unverified owner manages\n';
  ELSE log := log || E'ok unverified owner denied\n'; END IF;

  -- 12. revocation blocks a subsequent request with the same (already issued) JWT
  UPDATE public.mcp_client_grants SET revoked_at = now() WHERE user_id = a AND oauth_client_id = cl;
  PERFORM set_config('request.jwt.claims', oauth::text, true); SET LOCAL ROLE authenticated;
  v := public.mcp_access_level(); RESET ROLE;
  IF v = 'read' THEN log := log || E'ok 12 revoked grant -> read\n'; ELSE fails := fails + 1; log := log || 'FAIL 12 ' || v || E'\n'; END IF;
  -- 5. replaced consent generation: fresh grant on old generation, then consent regranted later
  INSERT INTO public.mcp_client_grants (user_id, oauth_client_id, consent_id, consent_granted_at, access_level, granted_session_id)
  VALUES (a, cl, consent, gt, 'manage', sa);
  UPDATE auth.oauth_consents SET granted_at = gt + interval '1 second' WHERE id = consent;
  PERFORM set_config('request.jwt.claims', oauth::text, true); SET LOCAL ROLE authenticated;
  v := public.mcp_access_level(); RESET ROLE;
  IF v = 'read' THEN log := log || E'ok 5 replaced consent generation -> read\n'; ELSE fails := fails + 1; log := log || 'FAIL 5 generation ' || v || E'\n'; END IF;
  -- 5. revoked consent => none (and assert_write denies)
  UPDATE auth.oauth_consents SET revoked_at = gt + interval '2 seconds' WHERE id = consent;
  PERFORM set_config('request.jwt.claims', oauth::text, true); SET LOCAL ROLE authenticated;
  v := public.mcp_access_level(); RESET ROLE;
  IF v = 'none' THEN log := log || E'ok 5 revoked consent -> none\n'; ELSE fails := fails + 1; log := log || 'FAIL 5 revoked consent ' || v || E'\n'; END IF;
  BEGIN PERFORM set_config('request.jwt.claims', oauth::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.mcp_assert_write(); RESET ROLE; fails := fails + 1; log := log || E'FAIL assert_write after revoke\n';
  EXCEPTION WHEN others THEN RESET ROLE; log := log || E'ok assert_write denied after revoke\n'; END;

  -- 9. maintenance: explicit service_role request and direct DB job without role switch
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true); SET LOCAL ROLE service_role;
  v := public.mcp_access_level(); RESET ROLE;
  IF v = 'maintenance' THEN log := log || E'ok 9 service_role -> maintenance\n'; ELSE fails := fails + 1; log := log || 'FAIL 9 service_role ' || v || E'\n'; END IF;
  PERFORM set_config('request.jwt.claims', '', true);
  v := public.mcp_access_level();
  IF v = 'maintenance' THEN log := log || E'ok 9 direct db job -> maintenance\n'; ELSE fails := fails + 1; log := log || 'FAIL 9 db job ' || v || E'\n'; END IF;
  -- anon role is never maintenance
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  BEGIN SET LOCAL ROLE anon; v := public.mcp_access_level(); RESET ROLE;
    fails := fails + 1; log := log || 'FAIL anon could execute access_level -> ' || v || E'\n';
  EXCEPTION WHEN insufficient_privilege THEN RESET ROLE; log := log || E'ok anon has no EXECUTE\n'; END;

  RAISE EXCEPTION 'TEST_RESULTS fails=% %', fails, E'\n' || log;
END $test$;
