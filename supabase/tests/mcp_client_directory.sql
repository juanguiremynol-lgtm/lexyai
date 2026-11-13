-- DB-backed acceptance test for MCP client directory writes (migration 0102).
-- One transaction, ALWAYS rolled back by raising TEST_RESULTS; synthetic users,
-- sessions and OAuth client only. No real client row is read or written.
DO $test$
DECLARE
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); cl uuid := gen_random_uuid();
  s_native uuid := gen_random_uuid(); s_oauth uuid := gen_random_uuid(); s_b uuid := gen_random_uuid();
  nat jsonb; oau jsonb; bnat jsonb; r jsonb; r2 jsonb; c1 uuid; upd timestamptz; n int; log text := ''; fails int := 0;
BEGIN
  GRANT EXECUTE ON FUNCTION public.mcp_create_client(text,text,text,text,text), public.mcp_update_client(uuid,jsonb,timestamptz,text) TO authenticated;
  INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (a,'authenticated','authenticated','mcp-cli-a-'||a||'@example.invalid',now(),'{}','{}',now(),now()),
         (b,'authenticated','authenticated','mcp-cli-b-'||b||'@example.invalid',now(),'{}','{}',now(),now());
  INSERT INTO auth.oauth_clients (id, registration_type, redirect_uris, grant_types, client_name, token_endpoint_auth_method)
  VALUES (cl,'dynamic','https://example.invalid/cb','authorization_code,refresh_token','Test agent','none');
  INSERT INTO auth.oauth_consents (id, user_id, client_id, scopes, granted_at) VALUES (gen_random_uuid(), a, cl, 'openid email', now());
  INSERT INTO auth.sessions (id, user_id, oauth_client_id) VALUES (s_native,a,NULL),(s_oauth,a,cl),(s_b,b,NULL);
  nat := jsonb_build_object('sub',a,'role','authenticated','session_id',s_native);
  oau := jsonb_build_object('sub',a,'role','authenticated','session_id',s_oauth,'client_id',cl);
  bnat := jsonb_build_object('sub',b,'role','authenticated','session_id',s_b);

  -- 1. Read-only OAuth (no manage grant): create denied, zero rows.
  BEGIN
    PERFORM set_config('request.jwt.claims', oau::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.mcp_create_client('Cliente Sintético', '900.123.456-7', NULL, NULL, 'cli-key-ro-01'); RESET ROLE;
    fails := fails+1; log := log||E'FAIL read-only create succeeded\n';
  EXCEPTION WHEN others THEN RESET ROLE; log := log||'ok read-only denied '||SQLSTATE||E'\n'; END;
  SELECT count(*) INTO n FROM public.clients WHERE owner_id=a;
  IF n<>0 THEN fails:=fails+1; log:=log||E'FAIL read-only left rows\n'; END IF;

  -- 2. First-party create + retry replay (same key) creates exactly one.
  PERFORM set_config('request.jwt.claims', nat::text, true); SET LOCAL ROLE authenticated;
  r := public.mcp_create_client('Cliente Sintético', '900.123.456-7', 'x@example.invalid', 'Medellín', 'cli-key-0001');
  r2 := public.mcp_create_client('Cliente Sintético', '900.123.456-7', 'x@example.invalid', 'Medellín', 'cli-key-0001'); RESET ROLE;
  c1 := (r->'client'->>'id')::uuid;
  SELECT count(*) INTO n FROM public.clients WHERE owner_id=a;
  IF c1 IS NULL OR n<>1 OR (r2->>'replayed')::boolean IS NOT TRUE OR r2->'client'->>'id' <> c1::text THEN fails:=fails+1; log:=log||'FAIL create/replay '||r2::text||E'\n'; ELSE log:=log||E'ok create + replay, 1 row\n'; END IF;

  -- 3. Different key, same normalized identification, different name: conflict with id, no row.
  PERFORM set_config('request.jwt.claims', nat::text, true); SET LOCAL ROLE authenticated;
  r := public.mcp_create_client('Otro Nombre', '9001234567', NULL, NULL, 'cli-key-0002'); RESET ROLE;
  SELECT count(*) INTO n FROM public.clients WHERE owner_id=a;
  IF r->>'conflict'<>'IDENTIFICATION_EXISTS' OR r->>'client_id'<>c1::text OR n<>1 THEN fails:=fails+1; log:=log||'FAIL id conflict '||r::text||E'\n'; ELSE log:=log||E'ok id conflict, no duplicate\n'; END IF;
  -- Same name without identification is NOT merged (new client).
  PERFORM set_config('request.jwt.claims', nat::text, true); SET LOCAL ROLE authenticated;
  r := public.mcp_create_client('Cliente Sintético', NULL, NULL, NULL, 'cli-key-0003'); RESET ROLE;
  IF r->>'ok'<>'true' OR (r->'client'->>'id')::uuid = c1 THEN fails:=fails+1; log:=log||E'FAIL name merge\n'; ELSE log:=log||E'ok no merge by name\n'; END IF;
  -- Key reuse with other data rejected.
  BEGIN
    PERFORM set_config('request.jwt.claims', nat::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.mcp_create_client('Distinto', NULL, NULL, NULL, 'cli-key-0001'); RESET ROLE;
    fails:=fails+1; log:=log||E'FAIL key reuse accepted\n';
  EXCEPTION WHEN others THEN RESET ROLE; log:=log||'ok key reuse '||SQLSTATE||E'\n'; END;

  -- 4. Other user cannot update (RLS/owner), row unchanged.
  SELECT updated_at INTO upd FROM public.clients WHERE id=c1;
  BEGIN
    PERFORM set_config('request.jwt.claims', bnat::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.mcp_update_client(c1, '{"name":"Hack"}', upd, 'cli-upd-b-01'); RESET ROLE;
    fails:=fails+1; log:=log||E'FAIL foreign update\n';
  EXCEPTION WHEN others THEN RESET ROLE; log:=log||'ok foreign update denied '||SQLSTATE||E'\n'; END;
  PERFORM set_config('request.jwt.claims', bnat::text, true); SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.clients WHERE id=c1; RESET ROLE;
  IF n<>0 THEN fails:=fails+1; log:=log||E'FAIL foreign RLS visibility\n'; ELSE log:=log||E'ok foreign RLS invisible\n'; END IF;

  -- 5. Stale revision changes nothing; fresh revision applies and replays.
  BEGIN
    PERFORM set_config('request.jwt.claims', nat::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.mcp_update_client(c1, '{"city":"Cali"}', upd - interval '1 second', 'cli-upd-0001'); RESET ROLE;
    fails:=fails+1; log:=log||E'FAIL stale accepted\n';
  EXCEPTION WHEN others THEN RESET ROLE; log:=log||'ok stale '||SQLSTATE||E'\n'; END;
  IF (SELECT city FROM public.clients WHERE id=c1)<>'Medellín' THEN fails:=fails+1; log:=log||E'FAIL stale mutated\n'; END IF;
  PERFORM set_config('request.jwt.claims', nat::text, true); SET LOCAL ROLE authenticated;
  r := public.mcp_update_client(c1, '{"city":"Cali","email":null}', upd, 'cli-upd-0002');
  r2 := public.mcp_update_client(c1, '{"city":"Cali","email":null}', upd, 'cli-upd-0002'); RESET ROLE;
  IF r->'client'->>'city'<>'Cali' OR (r2->>'replayed')::boolean IS NOT TRUE OR (SELECT email FROM public.clients WHERE id=c1) IS NOT NULL THEN fails:=fails+1; log:=log||E'FAIL update/replay\n'; ELSE log:=log||E'ok update + replay\n'; END IF;
  SELECT count(*) INTO n FROM public.mcp_action_audit WHERE user_id=a AND action IN ('create_client','update_client');
  log := log||'audit rows='||n||E'\n';

  RAISE EXCEPTION 'TEST_RESULTS fails=% %', fails, E'\n'||log;
END $test$;
