-- PREPARATORY ACCEPTANCE HARNESS -- NOT EXECUTED.
-- Run only after reviewing the final migrations, preferably in an isolated
-- restored database, as the database owner. Run the WHOLE file in ONE session.
-- Every persistent-table change and temporary GRANT is inside BEGIN/ROLLBACK.
-- Synthetic users use example.invalid; cases have NO radicado and monitoring
-- disabled. No Auth/network/provider API, scheduler, or real record is invoked.
-- Do not add COMMIT. If execution is interrupted, explicitly ROLLBACK/close the
-- connection. An unexpected setup error is reported as FAIL, never as a denial.
-- Overall success is the visible suite_status='PASS', failed=0 result below;
-- a process exit code alone is not an assertion result.

BEGIN;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '5s';

CREATE TEMP TABLE _mcp_acceptance_results (
  seq bigint GENERATED ALWAYS AS IDENTITY,
  test_name text NOT NULL,
  passed boolean NOT NULL,
  detail text
) ON COMMIT DROP;

CREATE TEMP TABLE _mcp_gate_before ON COMMIT DROP AS
SELECT p.oid, p.oid::regprocedure::text AS signature,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname IN (
   'mcp_create_work_item', 'mcp_work_item_lifecycle', 'mcp_move_work_item_stage',
   'mcp_resolve_stage_suggestion', 'mcp_resolve_alert', 'mcp_set_notification_state',
   'mcp_resolve_email_question', 'mcp_add_email_association', 'mcp_resolve_detected_process');

-- Only this transaction sees these GRANTs; ROLLBACK restores the release gate.
-- No private helpers are exposed to authenticated and no persistent role is created.
GRANT EXECUTE ON FUNCTION public.mcp_create_work_item(text,text,text,text,uuid,text,text,text,text,text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_work_item_lifecycle(uuid,text,timestamptz,text,text)
  TO authenticated;

CREATE FUNCTION pg_temp._mcp_check(p_name text, p_passed boolean, p_detail text DEFAULT NULL)
RETURNS void LANGUAGE sql AS $check$
  INSERT INTO pg_temp._mcp_acceptance_results(test_name, passed, detail)
  VALUES (p_name, p_passed IS TRUE, p_detail)
$check$;

-- SQL statements are fixed test strings built below with format(%L), never
-- external input. Each negative invocation is a subtransaction: even an
-- incorrectly permitted action is rolled back immediately before reporting FAIL.
CREATE FUNCTION pg_temp._mcp_expect(
  p_name text, p_claims jsonb, p_sql text, p_expected jsonb DEFAULT NULL,
  p_error_state text DEFAULT NULL, p_message_pattern text DEFAULT NULL,
  p_database_role text DEFAULT 'authenticated'
) RETURNS void LANGUAGE plpgsql AS $expect$
DECLARE
  v_actual jsonb;
  v_state text;
  v_message text;
  v_prior_claims text := COALESCE(current_setting('request.jwt.claims', true), '');
  v_prior_sub text := COALESCE(current_setting('request.jwt.claim.sub', true), '');
  v_prior_role text := COALESCE(current_setting('request.jwt.claim.role', true), '');
  v_unexpected_success boolean := false;
BEGIN
  IF p_database_role NOT IN ('authenticated', 'anon', 'service_role') THEN
    RAISE EXCEPTION 'unsupported test role';
  END IF;
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claim.role', '', true);
    PERFORM set_config('request.jwt.claims', COALESCE(p_claims, '{}'::jsonb)::text, true);
    EXECUTE format('SET LOCAL ROLE %I', p_database_role);
    EXECUTE p_sql INTO v_actual;
    IF p_error_state IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'PT001', MESSAGE = 'ROLLBACK_UNEXPECTED_TEST_SUCCESS';
    END IF;
  EXCEPTION
    WHEN SQLSTATE 'PT001' THEN v_unexpected_success := true;
    WHEN others THEN v_state := SQLSTATE; v_message := SQLERRM;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', v_prior_claims, true);
  PERFORM set_config('request.jwt.claim.sub', v_prior_sub, true);
  PERFORM set_config('request.jwt.claim.role', v_prior_role, true);

  IF p_error_state IS NULL THEN
    PERFORM pg_temp._mcp_check(p_name,
      v_state IS NULL AND NOT v_unexpected_success AND v_actual IS NOT DISTINCT FROM p_expected,
      format('expected=%s actual=%s SQLSTATE=%s message=%s',
        p_expected, v_actual, v_state, v_message));
  ELSE
    PERFORM pg_temp._mcp_check(p_name,
      NOT v_unexpected_success AND v_state IS NOT DISTINCT FROM p_error_state
      AND (p_message_pattern IS NULL OR COALESCE(v_message ~ p_message_pattern, false)),
      format('expected SQLSTATE=%s pattern=%s; actual SQLSTATE=%s message=%s unexpected_success=%s',
        p_error_state, p_message_pattern, v_state, v_message, v_unexpected_success));
  END IF;
END;
$expect$;

DO $suite$
DECLARE
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  org_a uuid := gen_random_uuid(); org_c uuid := gen_random_uuid();
  cl uuid := gen_random_uuid(); cl2 uuid := gen_random_uuid(); cl_b uuid := gen_random_uuid();
  native_a uuid := gen_random_uuid(); native_b uuid := gen_random_uuid(); native_c uuid := gen_random_uuid();
  oauth_a uuid := gen_random_uuid(); oauth_a2 uuid := gen_random_uuid(); deleted_sid uuid := gen_random_uuid();
  consent uuid := gen_random_uuid(); new_consent uuid := gen_random_uuid();
  wi uuid := gen_random_uuid();
  wi_revision timestamptz;
  nat jsonb; bnat jsonb; cnat jsonb; oau jsonb; oau2 jsonb;
  bad jsonb; scenario record;
  grant_sql text; revoke_sql text; archive_sql text; direct_archive_sql text;
  create_sql text; changed_create_sql text;
  run_key text := 'mcp-accept-' || gen_random_uuid()::text;
  test_title text := 'MCP isolated acceptance ' || gen_random_uuid()::text;
  n integer;
BEGIN
  -- Fixture setup must not inherit an unrelated request's JWT GUCs.
  PERFORM set_config('request.jwt.claims','{}',true);
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claim.role','',true);
  -- Preflight distinguishes deliberate release gates/missing functions from
  -- actual authorization denials. Positive paths below must also succeed.
  PERFORM pg_temp._mcp_check('preflight: required public actions executable in transaction',
    has_function_privilege('authenticated',
      'public.mcp_create_work_item(text,text,text,text,uuid,text,text,text,text,text)', 'EXECUTE')
    AND has_function_privilege('authenticated',
      'public.mcp_work_item_lifecycle(uuid,text,timestamptz,text,text)', 'EXECUTE')
    AND has_function_privilege('authenticated',
      'public.set_work_item_lifecycle(uuid,public.work_item_lifecycle_state,text,text,uuid,jsonb)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.grant_mcp_client_access(uuid,text)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.revoke_mcp_client_access(uuid)', 'EXECUTE'));

  -- Canonical synthetic auth fixture pattern from mcp_management_authz.sql.
  INSERT INTO auth.users
    (id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  VALUES
    (a,'authenticated','authenticated','mcp-test-a-'||a||'@example.invalid',now(),'{}','{}',now(),now()),
    (b,'authenticated','authenticated','mcp-test-b-'||b||'@example.invalid',now(),'{}','{}',now(),now()),
    (c,'authenticated','authenticated','mcp-test-c-'||c||'@example.invalid',now(),'{}','{}',now(),now());
  INSERT INTO public.organizations(id,name)
  VALUES (org_a,'MCP isolated acceptance '||org_a), (org_c,'MCP isolated acceptance '||org_c);
  INSERT INTO public.profiles(id,organization_id) VALUES (a,org_a),(b,org_a),(c,org_c)
    ON CONFLICT(id) DO UPDATE SET organization_id=EXCLUDED.organization_id;
  INSERT INTO public.organization_memberships(organization_id,user_id,role)
  VALUES (org_a,a,'MEMBER'),(org_a,b,'ADMIN'),(org_c,c,'OWNER');

  INSERT INTO auth.oauth_clients
    (id,registration_type,redirect_uris,grant_types,client_name,token_endpoint_auth_method)
  VALUES
    (cl,'dynamic','https://example.invalid/cb','authorization_code,refresh_token','Acceptance A','none'),
    (cl2,'dynamic','https://example.invalid/cb','authorization_code,refresh_token','Acceptance A2','none'),
    (cl_b,'dynamic','https://example.invalid/cb','authorization_code,refresh_token','Acceptance B','none');
  INSERT INTO auth.oauth_consents(id,user_id,client_id,scopes,granted_at)
  VALUES (consent,a,cl,'openid email',now()-interval '2 seconds'),
         (gen_random_uuid(),a,cl2,'openid email',now()),
         (gen_random_uuid(),b,cl_b,'openid email',now());
  INSERT INTO auth.sessions(id,user_id,oauth_client_id)
  VALUES (native_a,a,NULL),(native_b,b,NULL),(native_c,c,NULL),
         (oauth_a,a,cl),(oauth_a2,a,cl2),(deleted_sid,a,NULL);
  DELETE FROM auth.sessions WHERE id=deleted_sid;

  nat := jsonb_build_object('sub',a,'role','authenticated','session_id',native_a);
  bnat := jsonb_build_object('sub',b,'role','authenticated','session_id',native_b);
  cnat := jsonb_build_object('sub',c,'role','authenticated','session_id',native_c);
  oau := jsonb_build_object('sub',a,'role','authenticated','session_id',oauth_a,'client_id',cl);
  oau2 := jsonb_build_object('sub',a,'role','authenticated','session_id',oauth_a2,'client_id',cl2);

  -- No radicado: this fixture cannot request judicial-provider monitoring.
  INSERT INTO public.work_items
    (id,owner_id,organization_id,workflow_type,stage,status,source,title,radicado,
     monitoring_enabled,monitoring_disabled_by,monitoring_disabled_reason,email_linking_enabled)
  VALUES (wi,a,org_a,'CGP','DRAFTED','ACTIVE','MANUAL','MCP isolated target '||wi,NULL,
          false,'USER','ACCEPTANCE_TEST_NO_PROVIDER',false);
  SELECT updated_at INTO wi_revision FROM public.work_items WHERE id=wi;
  PERFORM pg_temp._mcp_check('fixture target exists and has no provider identifier',
    wi_revision IS NOT NULL AND EXISTS (SELECT 1 FROM public.work_items
      WHERE id=wi AND owner_id=a AND radicado IS NULL AND monitoring_enabled IS FALSE));

  grant_sql := format('SELECT to_jsonb((public.grant_mcp_client_access(%L::uuid,''manage'')->>''ok'')::boolean)',cl);
  revoke_sql := format('SELECT to_jsonb((public.revoke_mcp_client_access(%L::uuid)->>''ok'')::boolean)',cl);
  archive_sql := format('SELECT public.mcp_work_item_lifecycle(%L::uuid,''archive'',%L::timestamptz,%L,NULL)',
    wi,wi_revision,run_key||'-archive');
  direct_archive_sql := format('SELECT public.set_work_item_lifecycle(%L::uuid,''ARCHIVED''::public.work_item_lifecycle_state,''isolated test'',''USER'',%L::uuid,''{}''::jsonb)',wi,a);
  create_sql := format('SELECT public.mcp_create_work_item(''CGP'',''DRAFTED'',NULL,%L,NULL,NULL,NULL,NULL,''ACCEPTANCE_TEST_NO_PROVIDER'',%L)',test_title,run_key||'-create');
  changed_create_sql := format('SELECT public.mcp_create_work_item(''CGP'',''DRAFTED'',NULL,%L,NULL,NULL,NULL,NULL,''ACCEPTANCE_TEST_NO_PROVIDER'',%L)',test_title||' changed',run_key||'-create');

  PERFORM pg_temp._mcp_expect('valid native context',nat,
    'SELECT jsonb_build_object(''level'',public.mcp_access_level(),''write'',public.mcp_write_allowed())',
    '{"level":"first_party","write":true}');
  PERFORM pg_temp._mcp_expect('OAuth defaults to read',oau,
    'SELECT jsonb_build_object(''level'',public.mcp_access_level(),''write'',public.mcp_write_allowed())',
    '{"level":"read","write":false}');
  PERFORM pg_temp._mcp_expect('OAuth cannot self-grant',oau,grant_sql,NULL,'MCP01','^MCP_FIRST_PARTY_REQUIRED');
  PERFORM pg_temp._mcp_expect('OAuth cannot revoke management permissions',oau,revoke_sql,NULL,'MCP01','^MCP_FIRST_PARTY_REQUIRED');
  PERFORM pg_temp._mcp_expect('native cannot grant a client consented only by another user',nat,
    format('SELECT public.grant_mcp_client_access(%L::uuid,''manage'')',cl_b),
    NULL,'MCP04','^no active authorization for this client');

  -- These exact invalid contexts must never be treated as native or privileged.
  FOR scenario IN SELECT * FROM (VALUES
    ('missing session id',nat-'session_id'),
    ('malformed session id',nat||'{"session_id":"not-a-uuid"}'::jsonb),
    ('unknown session id',nat||jsonb_build_object('session_id',gen_random_uuid())),
    ('deleted session id',nat||jsonb_build_object('session_id',deleted_sid)),
    ('wrong session user',nat||jsonb_build_object('session_id',native_b)),
    ('OAuth client claim missing',oau-'client_id'),
    ('OAuth client claim mismatched',oau||jsonb_build_object('client_id',cl2)),
    ('OAuth client claim malformed',oau||'{"client_id":"not-a-uuid"}'::jsonb),
    ('native session with OAuth client claim',nat||jsonb_build_object('client_id',cl)),
    ('OAuth session missing but client claim present',oau||jsonb_build_object('session_id',deleted_sid)),
    ('role-less user context',nat-'role'),
    ('absent claims under authenticated role','{}'::jsonb)
  ) AS x(label,claims)
  LOOP
    PERFORM pg_temp._mcp_expect('invalid context: '||scenario.label,scenario.claims,
      'SELECT jsonb_build_object(''level'',public.mcp_access_level(),''write'',public.mcp_write_allowed())',
      '{"level":"none","write":false}');
  END LOOP;
  PERFORM pg_temp._mcp_expect('missing-session user cannot perform an action',nat-'session_id',
    archive_sql,NULL,'MCP01','^MCP_MANAGE_GRANT_REQUIRED');
  PERFORM pg_temp._mcp_expect('deleted native session cannot grant',
    nat||jsonb_build_object('session_id',deleted_sid),grant_sql,NULL,'42501','^not authenticated');

  UPDATE auth.sessions SET not_after=now()-interval '1 second' WHERE id=native_a;
  PERFORM pg_temp._mcp_expect('expired native session denied',nat,
    'SELECT jsonb_build_object(''level'',public.mcp_access_level(),''write'',public.mcp_write_allowed())',
    '{"level":"none","write":false}');
  PERFORM pg_temp._mcp_expect('expired native session cannot grant',nat,grant_sql,NULL,'42501','^not authenticated');
  UPDATE auth.sessions SET not_after=NULL WHERE id=native_a;
  UPDATE auth.sessions SET not_after=now()-interval '1 second' WHERE id=oauth_a;
  PERFORM pg_temp._mcp_expect('expired OAuth session denied',oau,
    'SELECT jsonb_build_object(''level'',public.mcp_access_level(),''write'',public.mcp_write_allowed())',
    '{"level":"none","write":false}');
  UPDATE auth.sessions SET not_after=NULL WHERE id=oauth_a;

  -- Direct RLS and direct definer RPC are separate boundaries.
  PERFORM pg_temp._mcp_expect('read-only direct UPDATE affects zero rows',oau,
    format('WITH changed AS (UPDATE public.work_items SET title=''unexpected'' WHERE id=%L::uuid RETURNING id) SELECT to_jsonb(count(*)) FROM changed',wi),'0');
  PERFORM pg_temp._mcp_expect('read-only direct lifecycle denied',oau,direct_archive_sql,NULL,'MCP01','^MCP_MANAGE_GRANT_REQUIRED');
  PERFORM pg_temp._mcp_expect('read-only MCP lifecycle denied',oau,archive_sql,NULL,'MCP01','^MCP_MANAGE_GRANT_REQUIRED');
  PERFORM pg_temp._mcp_check('denials left target active and no idempotency residue',
    (SELECT lifecycle_state::text FROM public.work_items WHERE id=wi) IS NOT DISTINCT FROM 'ACTIVE'
    AND NOT EXISTS (SELECT 1 FROM public.mcp_idempotency WHERE user_id=a));

  PERFORM pg_temp._mcp_expect('native grants own connected client',nat,grant_sql,'true');
  PERFORM pg_temp._mcp_expect('current grant enables OAuth management',oau,
    'SELECT to_jsonb(public.mcp_access_level())','"manage"');
  PERFORM pg_temp._mcp_expect('grant does not authorize another OAuth client',oau2,
    'SELECT jsonb_build_object(''level'',public.mcp_access_level(),''write'',public.mcp_write_allowed())',
    '{"level":"read","write":false}');

  -- Genuine owner success proves dependencies are usable before negative tests.
  PERFORM pg_temp._mcp_expect('owner lifecycle action succeeds',nat,
    'SELECT to_jsonb((x->>''ok'')::boolean) FROM ('||direct_archive_sql||') AS q(x)','true');
  PERFORM pg_temp._mcp_expect('owner restores isolated target',nat,
    format('SELECT to_jsonb((public.set_work_item_lifecycle(%L::uuid,''ACTIVE''::public.work_item_lifecycle_state,''isolated restore'',''USER'',NULL,''{}'')->>''ok'')::boolean)',wi),'true');
  SELECT updated_at INTO wi_revision FROM public.work_items WHERE id=wi;
  PERFORM pg_temp._mcp_expect('owner MCP lifecycle wrapper succeeds',nat,
    format('SELECT to_jsonb((public.mcp_work_item_lifecycle(%L::uuid,''archive'',%L::timestamptz,%L,NULL)->>''ok'')::boolean)',
      wi,wi_revision,run_key||'-owner-archive'),'true');
  SELECT updated_at INTO wi_revision FROM public.work_items WHERE id=wi;
  PERFORM pg_temp._mcp_expect('owner MCP lifecycle wrapper restores target',nat,
    format('SELECT to_jsonb((public.mcp_work_item_lifecycle(%L::uuid,''restore'',%L::timestamptz,%L,NULL)->>''ok'')::boolean)',
      wi,wi_revision,run_key||'-owner-restore'),'true');
  SELECT updated_at INTO wi_revision FROM public.work_items WHERE id=wi;
  archive_sql := format('SELECT public.mcp_work_item_lifecycle(%L::uuid,''archive'',%L::timestamptz,%L,NULL)',
    wi,wi_revision,run_key||'-owner-denial');
  PERFORM pg_temp._mcp_expect('same-org ADMIN cannot manage another owner item',bnat,archive_sql,NULL,'MCP04','^NOT_FOUND:');
  PERFORM pg_temp._mcp_expect('same-org ADMIN cannot use direct lifecycle',bnat,direct_archive_sql,NULL,'42501',
    '^(NOT_FOUND:|work_item .* not found|not authorized|No autorizado|NO_AUTORIZADO)');
  UPDATE public.organization_memberships SET role='OWNER' WHERE organization_id=org_a AND user_id=b;
  PERFORM pg_temp._mcp_expect('same-org OWNER cannot manage another owner item',bnat,archive_sql,NULL,'MCP04','^NOT_FOUND:');
  PERFORM pg_temp._mcp_expect('cross-org OWNER cannot manage customer item',cnat,archive_sql,NULL,'MCP04','^NOT_FOUND:');
  PERFORM pg_temp._mcp_expect('cross-org OWNER cannot use direct lifecycle',cnat,direct_archive_sql,NULL,'42501',
    '^(NOT_FOUND:|work_item .* not found|not authorized|No autorizado|NO_AUTORIZADO)');
  INSERT INTO public.platform_admins(user_id) VALUES (c);
  PERFORM pg_temp._mcp_expect('platform admin does not gain customer write access',cnat,direct_archive_sql,NULL,'42501',
    '^(NOT_FOUND:|work_item .* not found|not authorized|No autorizado|NO_AUTORIZADO)');
  PERFORM pg_temp._mcp_check('cross-owner calls left target active',
    (SELECT lifecycle_state::text FROM public.work_items WHERE id=wi) IS NOT DISTINCT FROM 'ACTIVE');

  -- The current-session grant must work, not just fail all callers.
  PERFORM pg_temp._mcp_expect('managed create succeeds',oau,
    'SELECT to_jsonb((x->>''ok'')::boolean AND (x->''work_item''->>''id'') IS NOT NULL) FROM ('||create_sql||') AS q(x)','true');
  PERFORM pg_temp._mcp_expect('same-key exact retry is replayed',oau,
    'SELECT to_jsonb((x->>''replayed'')::boolean) FROM ('||create_sql||') AS q(x)','true');
  PERFORM pg_temp._mcp_expect('same key changed payload conflicts',oau,changed_create_sql,NULL,'MCP09','^IDEMPOTENCY_KEY_REUSED:');
  SELECT count(*) INTO n FROM public.work_items WHERE owner_id=a AND title=test_title;
  PERFORM pg_temp._mcp_check('retry creates exactly one item',n=1,format('count=%s',n));
  SELECT count(*) INTO n FROM public.mcp_action_audit
   WHERE user_id=a AND oauth_client_id=cl AND action='create_work_item' AND idem_key=run_key||'-create';
  PERFORM pg_temp._mcp_check('retry creates exactly one correctly attributed audit',n=1,format('count=%s',n));

  UPDATE auth.oauth_clients SET deleted_at=now() WHERE id=cl;
  PERFORM pg_temp._mcp_expect('soft-deleted client cannot manage with existing token',oau,
    'SELECT jsonb_build_object(''level'',public.mcp_access_level(),''write'',public.mcp_write_allowed())',
    '{"level":"none","write":false}');
  PERFORM pg_temp._mcp_expect('native cannot grant deleted client',nat,grant_sql,NULL,'MCP04','^OAuth client not found');
  UPDATE auth.oauth_clients SET deleted_at=NULL WHERE id=cl;

  PERFORM pg_temp._mcp_expect('native revokes management',nat,revoke_sql,'true');
  PERFORM pg_temp._mcp_expect('existing OAuth token becomes read-only immediately',oau,
    'SELECT to_jsonb(public.mcp_access_level())','"read"');
  PERFORM pg_temp._mcp_expect('revoked token cannot replay a successful mutation',oau,create_sql,NULL,'MCP01','^MCP_MANAGE_GRANT_REQUIRED');
  PERFORM pg_temp._mcp_expect('native regrants management',nat,grant_sql,'true');
  UPDATE auth.oauth_consents SET revoked_at=now() WHERE id=consent;
  PERFORM pg_temp._mcp_expect('revoked OAuth consent blocks existing token',oau,
    'SELECT jsonb_build_object(''level'',public.mcp_access_level(),''write'',public.mcp_write_allowed())',
    '{"level":"none","write":false}');
  UPDATE auth.oauth_consents SET revoked_at=NULL,granted_at=now()-interval '1 second' WHERE id=consent;
  PERFORM pg_temp._mcp_expect('changed consent timestamp does not resurrect manage',oau,
    'SELECT to_jsonb(public.mcp_access_level())','"read"');
  PERFORM pg_temp._mcp_expect('native can grant the new consent generation',nat,grant_sql,'true');
  PERFORM pg_temp._mcp_expect('new-generation native grant enables management',oau,
    'SELECT to_jsonb(public.mcp_access_level())','"manage"');
  DELETE FROM auth.oauth_consents WHERE id=consent;
  INSERT INTO auth.oauth_consents(id,user_id,client_id,scopes,granted_at)
  VALUES (new_consent,a,cl,'openid email',now());
  PERFORM pg_temp._mcp_expect('replaced consent ID does not resurrect manage',oau,
    'SELECT to_jsonb(public.mcp_access_level())','"read"');
  PERFORM pg_temp._mcp_expect('native grants replacement consent',nat,grant_sql,'true');
  PERFORM pg_temp._mcp_expect('replacement-consent grant enables management',oau,
    'SELECT to_jsonb(public.mcp_access_level())','"manage"');

  PERFORM pg_temp._mcp_check('only the two deliberate temporary action grants changed',
    NOT EXISTS (SELECT 1 FROM pg_temp._mcp_gate_before g JOIN pg_proc p ON p.oid=g.oid
      WHERE p.proname NOT IN ('mcp_create_work_item','mcp_work_item_lifecycle')
        AND has_function_privilege('authenticated',g.oid,'EXECUTE') IS DISTINCT FROM g.authenticated_execute));

EXCEPTION WHEN others THEN
  -- A setup/signature/infrastructure error is a visible suite failure. All
  -- fixture writes in this DO block are automatically rolled back here.
  RESET ROLE;
  PERFORM set_config('request.jwt.claims','{}',true);
  PERFORM pg_temp._mcp_check('FATAL fixture or harness error',false,
    format('SQLSTATE=%s message=%s',SQLSTATE,SQLERRM));
END;
$suite$;

-- One visible result object immediately before ROLLBACK: runners that expose
-- only the final SELECT cannot accidentally hide the suite verdict.
SELECT jsonb_build_object(
  'suite_status', CASE WHEN count(*)>0 AND bool_and(passed) THEN 'PASS' ELSE 'FAIL' END,
  'checks', count(*),
  'failed', count(*) FILTER (WHERE NOT passed),
  'results', jsonb_agg(jsonb_build_object('test',test_name,'result',
      CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END,'detail',detail) ORDER BY seq),
  'gate_before_and_inside', (SELECT jsonb_agg(jsonb_build_object(
      'signature',signature,'before_test',authenticated_execute,
      'inside_test_transaction',has_function_privilege('authenticated',oid,'EXECUTE'))
      ORDER BY signature) FROM pg_temp._mcp_gate_before)
) AS acceptance_result
FROM pg_temp._mcp_acceptance_results;

ROLLBACK;

-- Run this SEPARATELY after the whole harness returns, and compare with
-- gate_before_and_inside.before_test. It is commented here so it cannot replace
-- the acceptance_result in a tool that returns only the last SELECT result.
-- SELECT p.oid::regprocedure::text AS signature,
--        has_function_privilege('authenticated',p.oid,'EXECUTE') AS restored_authenticated_execute
--   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--  WHERE n.nspname='public' AND p.proname IN (
--    'mcp_create_work_item','mcp_work_item_lifecycle','mcp_move_work_item_stage',
--    'mcp_resolve_stage_suggestion','mcp_resolve_alert','mcp_set_notification_state',
--    'mcp_resolve_email_question','mcp_add_email_association','mcp_resolve_detected_process')
--  ORDER BY signature;

-- LIMITATIONS: expected error contracts intentionally match the strict helper
-- patch/canonical action RPCs. If final reviewed error wording changes, update
-- only the anchored expected patterns, never accept WHEN others as PASS.
-- This is a one-connection DB authorization test, not a signed-JWT, OAuth browser,
-- HTTP/PostgREST, multi-connection race, provider integration, or purge test.
-- Same-org administrator fixtures use synthetic default organizations; this
-- file does not purchase/alter billing plans or claim business-plan coverage.
-- Rows/grants are transactional, but unreviewed future triggers could perform
-- nontransactional I/O; use an isolated environment with egress disabled first.
