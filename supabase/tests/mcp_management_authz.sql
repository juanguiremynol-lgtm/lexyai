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
  nat jsonb; oau jsonb; bnat jsonb; wi2 uuid;
  al1 uuid := gen_random_uuid(); al2 uuid := gen_random_uuid(); l1 uuid := gen_random_uuid(); l2 uuid := gen_random_uuid();
BEGIN
  -- Gated RPCs: transaction-local grants, discarded by the final rollback.
  GRANT EXECUTE ON FUNCTION public.mcp_create_work_item(text, text, text, text, uuid, text, text, text, text, text),
    public.mcp_move_work_item_stage(uuid, text, timestamptz, text[], text, text),
    public.mcp_resolve_alert(uuid, text, text, text), public.mcp_resolve_email_question(uuid, text, text),
    public.mcp_set_notification_state(uuid[], text, timestamptz, text),
    public.mcp_work_item_lifecycle(uuid, text, timestamptz, text, text) TO authenticated;
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
  -- 0071: OAuth session with a missing client claim is invalid (fail-closed), never native.
  PERFORM set_config('request.jwt.claims', (oau - 'client_id')::text, true); SET LOCAL ROLE authenticated;
  v := public.mcp_access_level(); RESET ROLE;
  IF v <> 'none' THEN fails := fails + 1; log := log || 'FAIL oauth w/o client claim=' || v || E'\n'; ELSE log := log || E'ok oauth session without client claim -> none\n'; END IF;

  -- 2. OAuth cannot self-escalate
  BEGIN
    PERFORM set_config('request.jwt.claims', oau::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.grant_mcp_client_access(cl, 'manage'); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL oauth self-grant succeeded\n';
  EXCEPTION WHEN others THEN RESET ROLE; log := log || 'ok oauth self-grant denied: ' || left(SQLERRM, 40) || E'\n'; END;

  -- 3. Read-only OAuth: direct REST write and RPC write blocked (zero mutation)
  PERFORM set_config('request.jwt.claims', nat::text, true); SET LOCAL ROLE authenticated;
  r := public.mcp_create_work_item('CGP', 'DRAFTED', NULL, 'Prueba MCP aislada', NULL, NULL, NULL, NULL, 'PENDIENTE_DE_RADICACION', 'create-key-0001');
  RESET ROLE;
  wi := (r->'work_item'->>'id')::uuid;
  IF wi IS NULL THEN fails := fails + 1; log := log || 'FAIL native create ' || r::text || E'\n'; ELSE log := log || E'ok first-party create via RPC\n'; END IF;
  SELECT updated_at INTO wi_upd FROM public.work_items WHERE id = wi;
  PERFORM set_config('request.jwt.claims', nat::text, true); SET LOCAL ROLE authenticated;
  wi2 := (public.mcp_create_work_item('CGP', 'DRAFTED', NULL, 'Prueba MCP aislada 2', NULL, NULL, NULL, NULL, 'PENDIENTE_DE_RADICACION', 'create-key-0002')->'work_item'->>'id')::uuid; RESET ROLE;

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

  -- 7b. Stage moves (canonical CGP vocabulary since 0066; client order ignored), stale + regression
  SELECT updated_at INTO wi_upd FROM public.work_items WHERE id = wi;
  PERFORM set_config('request.jwt.claims', oau::text, true); SET LOCAL ROLE authenticated;
  r := public.mcp_move_work_item_stage(wi, 'ADMISION', wi_upd, ARRAY['DRAFTED','SENT_TO_REPARTO','ACTA_PENDING'], 'stage-key-001'); RESET ROLE;
  IF r->'work_item'->>'stage' <> 'ADMISION' THEN fails := fails + 1; log := log || 'FAIL stage move ' || r::text || E'\n'; ELSE log := log || E'ok stage move committed\n'; END IF;
  BEGIN
    PERFORM set_config('request.jwt.claims', oau::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.mcp_move_work_item_stage(wi, 'ADMISION', wi_upd, ARRAY['DRAFTED','SENT_TO_REPARTO','ACTA_PENDING'], 'stage-key-002'); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL stale stage move accepted\n';
  EXCEPTION WHEN others THEN RESET ROLE; log := log || E'ok stale stage move rejected\n'; END;
  SELECT updated_at INTO wi_upd FROM public.work_items WHERE id = wi;
  BEGIN
    PERFORM set_config('request.jwt.claims', oau::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.mcp_move_work_item_stage(wi, 'DRAFTED', wi_upd, ARRAY['DRAFTED','SENT_TO_REPARTO','ACTA_PENDING'], 'stage-key-003'); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL regression accepted\n';
  EXCEPTION WHEN others THEN RESET ROLE; log := log || E'ok regression rejected\n'; END;
  BEGIN
    PERFORM set_config('request.jwt.claims', oau::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.mcp_move_work_item_stage(wi, 'NO_EXISTE', wi_upd, ARRAY['DRAFTED','SENT_TO_REPARTO','ACTA_PENDING'], 'stage-key-004'); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL invalid stage accepted\n';
  EXCEPTION WHEN others THEN RESET ROLE; log := log || E'ok invalid stage rejected\n'; END;

  -- 7c. Alerts vs notifications
  INSERT INTO public.alert_instances (id, owner_id, entity_type, entity_id, severity, status, title, message, alert_type, resolution_mode, fired_at, fingerprint)
  VALUES (al1, a, 'WORK_ITEM', wi, 'WARNING', 'SENT', 'auto', 'm', 'MONITOREO_SIN_PROVEEDOR', 'AUTO_ON_CAUSE_CLEARED', now(), 'mcp_test_1_' || al1),
         (al2, a, 'WORK_ITEM', wi2, 'WARNING', 'PENDING', 'snooz', 'm', 'MONITOREO_SIN_INGESTA', 'SNOOZABLE', now(), 'mcp_test_2_' || al2);
  BEGIN
    PERFORM set_config('request.jwt.claims', oau::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.mcp_resolve_alert(al1, 'dismiss', 'alert-key-001'); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL auto-cleared alert dismissed\n';
  EXCEPTION WHEN others THEN RESET ROLE; log := log || E'ok AUTO_ON_CAUSE_CLEARED dismiss rejected\n'; END;
  PERFORM set_config('request.jwt.claims', oau::text, true); SET LOCAL ROLE authenticated;
  r := public.mcp_resolve_alert(al1, 'acknowledge', 'alert-key-002');
  r2 := public.mcp_resolve_alert(al2, 'dismiss', 'alert-key-003'); RESET ROLE;
  IF r->'alert'->>'status' <> 'ACKNOWLEDGED' OR r2->'alert'->>'status' <> 'DISMISSED' THEN fails := fails + 1; log := log || E'FAIL alert actions\n'; ELSE log := log || E'ok alert acknowledge (SENT) + dismiss (SNOOZABLE)\n'; END IF;
  BEGIN
    PERFORM set_config('request.jwt.claims', oau::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.mcp_set_notification_state(ARRAY[al2], 'read', NULL, 'notif-key-001'); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL alert id accepted by notification action\n';
  EXCEPTION WHEN others THEN RESET ROLE; log := log || E'ok alert id rejected by notification action\n'; END;

  -- 7d. Email question: confirm one, siblings dismissed; contradictory second decision rejected; stage untouched
  SELECT stage INTO v FROM public.work_items WHERE id = wi;
  INSERT INTO public.work_item_email_links (id, user_id, work_item_id, message_id, internet_message_id, direction, matched_by, confidence, link_status)
  VALUES (l1, a, wi, 'msg-test-1', '<imid-test-1>', 'received', 'PARTE', 0.6, 'SUGGESTED'),
         (l2, a, wi2, 'msg-test-1', '<imid-test-1>', 'received', 'PARTE', 0.6, 'SUGGESTED');
  PERFORM set_config('request.jwt.claims', oau::text, true); SET LOCAL ROLE authenticated;
  r := public.mcp_resolve_email_question(l1, 'confirm', 'email-key-001'); RESET ROLE;
  IF (SELECT link_status FROM public.work_item_email_links WHERE id = l1) <> 'CONFIRMED'
     OR (SELECT link_status FROM public.work_item_email_links WHERE id = l2) <> 'DISMISSED' THEN
    fails := fails + 1; log := log || E'FAIL email confirm/sibling\n'; ELSE log := log || E'ok email confirm + sibling dismissed\n'; END IF;
  BEGIN
    PERFORM set_config('request.jwt.claims', oau::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.mcp_resolve_email_question(l2, 'confirm', 'email-key-002'); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL contradictory email resolution accepted\n';
  EXCEPTION WHEN others THEN RESET ROLE; log := log || E'ok contradictory email resolution rejected\n'; END;
  IF (SELECT stage FROM public.work_items WHERE id = wi) <> v THEN fails := fails + 1; log := log || E'FAIL email changed stage\n'; ELSE log := log || E'ok email confirmation left stage unchanged\n'; END IF;
  BEGIN
    PERFORM set_config('request.jwt.claims', bnat::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.mcp_resolve_email_question(l1, 'dismiss', 'email-key-b01'); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL cross-owner email\n';
  EXCEPTION WHEN others THEN RESET ROLE; log := log || E'ok cross-owner email denied\n'; END;

  PERFORM set_config('request.jwt.claims', nat::text, true); SET LOCAL ROLE authenticated;
  PERFORM public.revoke_mcp_client_access(cl); RESET ROLE;
  PERFORM set_config('request.jwt.claims', oau::text, true); SET LOCAL ROLE authenticated;
  v := public.mcp_access_level(); RESET ROLE;
  IF v <> 'read' THEN fails := fails + 1; log := log || E'FAIL revoke\n'; ELSE log := log || E'ok revoke -> read\n'; END IF;
  PERFORM set_config('request.jwt.claims', nat::text, true); SET LOCAL ROLE authenticated;
  PERFORM public.grant_mcp_client_access(cl, 'manage'); RESET ROLE;
  UPDATE auth.oauth_consents SET revoked_at = now() WHERE id = consent;
  -- auth.oauth_consents is unique per (user, client): reconnect updates the row in place.
  UPDATE auth.oauth_consents SET revoked_at = NULL, granted_at = now() + interval '1 second' WHERE id = consent;
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

-- 0064: unverified session is read-only; feed is revision-based and RLS-scoped.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000aa','role','authenticated','session_id','00000000-0000-0000-0000-0000000000bb')::text, true);
SELECT CASE WHEN public.mcp_access_level() = 'none' AND NOT public.mcp_write_allowed() AND NOT public._mcp_is_trusted_backend()
            THEN 'PASS unverified_session_no_access' ELSE 'FAIL unverified_session_no_access' END;
SELECT CASE WHEN jsonb_array_length(public.mcp_list_updates(NULL, 5, NULL)->'events') = 0
            THEN 'PASS foreign_user_sees_no_updates' ELSE 'FAIL foreign_user_sees_no_updates' END;
SELECT CASE WHEN public.mcp_reconcile_updates(now() - interval '30 days', 5, NULL)->>'mode' = 'reconcile'
            THEN 'PASS reconcile_mode' ELSE 'FAIL reconcile_mode' END;
ROLLBACK;
