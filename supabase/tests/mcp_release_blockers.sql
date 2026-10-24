-- DB-backed acceptance test for migration 0068 (release-blocker hardening).
-- Synthetic users/sessions/OAuth client only; ALWAYS rolls back by raising TEST_RESULTS at the end.
-- The nine MCP write RPCs are gated (EXECUTE revoked); this test grants EXECUTE to authenticated
-- transaction-locally, so the grant disappears with the rollback. Run as the database owner.
-- Passed with fails=0 on 2026-10-24 (after migrations 0068-0071).
DO $test$
DECLARE
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  sa uuid := gen_random_uuid(); sb uuid := gen_random_uuid(); sexp uuid := gen_random_uuid();
  so uuid := gen_random_uuid(); sdel uuid := gen_random_uuid();
  oc uuid := gen_random_uuid(); ocdel uuid := gen_random_uuid();
  ca jsonb; cb jsonb; r jsonb; r2 jsonb; w record; wi uuid; wi2 uuid; wl uuid; nid uuid; aid uuid; did uuid;
  log text := ''; fails int := 0; n int; cur text; cp1 timestamptz; cp2 timestamptz; v text;
  rad text := '05001400300220990000700'; org uuid;
BEGIN
  GRANT EXECUTE ON FUNCTION public.mcp_create_work_item(text, text, text, text, uuid, text, text, text, text, text) TO authenticated;
  GRANT EXECUTE ON FUNCTION public.mcp_set_notification_state(uuid[], text, timestamptz, text) TO authenticated;
  GRANT EXECUTE ON FUNCTION public.mcp_resolve_alert(uuid, text, text, text) TO authenticated;

  INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  SELECT x, 'authenticated', 'authenticated', 'rb-test-' || x || '@example.invalid', now(), '{}', '{}', now(), now() FROM unnest(ARRAY[a, b]) x;
  INSERT INTO public.organizations (name) VALUES ('Org rb') RETURNING id INTO org;
  INSERT INTO public.organization_memberships (organization_id, user_id, role) VALUES (org, a, 'MEMBER'), (org, b, 'MEMBER');
  INSERT INTO public.profiles (id, organization_id) VALUES (a, org), (b, org)
    ON CONFLICT (id) DO UPDATE SET organization_id = excluded.organization_id;
  INSERT INTO auth.oauth_clients (id, client_type, grant_types, redirect_uris, registration_type, token_endpoint_auth_method, deleted_at)
  VALUES (oc, 'public', 'authorization_code', 'https://example.invalid/cb', 'dynamic', 'none', NULL),
         (ocdel, 'public', 'authorization_code', 'https://example.invalid/cb', 'dynamic', 'none', now());
  INSERT INTO auth.sessions (id, user_id, not_after, oauth_client_id) VALUES
    (sa, a, NULL, NULL), (sb, b, NULL, NULL), (sexp, a, now() - interval '1 minute', NULL),
    (so, a, NULL, oc), (sdel, a, NULL, ocdel);
  -- 0071: an OAuth session is only verified while its consent is active.
  INSERT INTO auth.oauth_consents (id, user_id, client_id, scopes, granted_at) VALUES (gen_random_uuid(), a, oc, 'openid email', now());
  ca := jsonb_build_object('sub', a, 'role', 'authenticated', 'session_id', sa);
  cb := jsonb_build_object('sub', b, 'role', 'authenticated', 'session_id', sb);

  -- A. Authorization surface --------------------------------------------------------------
  PERFORM set_config('request.jwt.claims', ca::text, true); SET LOCAL ROLE authenticated;
  v := public.mcp_access_level(); RESET ROLE;
  IF v = 'first_party' THEN log := log || E'ok native session = first_party\n'; ELSE fails := fails + 1; log := log || 'FAIL native ' || v || E'\n'; END IF;

  DECLARE t record; BEGIN
    FOR t IN SELECT * FROM (VALUES
      (jsonb_build_object('sub', a, 'role', 'authenticated'), 'missing session'),
      (jsonb_build_object('sub', a, 'role', 'authenticated', 'session_id', gen_random_uuid()), 'deleted session'),
      (jsonb_build_object('sub', a, 'role', 'authenticated', 'session_id', 'not-a-uuid'), 'malformed session'),
      (jsonb_build_object('sub', a, 'role', 'authenticated', 'session_id', sexp), 'expired session'),
      (jsonb_build_object('sub', a, 'role', 'authenticated', 'session_id', sb), 'other user session'),
      (jsonb_build_object('sub', a, 'role', 'authenticated', 'session_id', sa, 'client_id', oc), 'client mismatch'),
      (jsonb_build_object('sub', a, 'role', 'authenticated', 'session_id', sdel, 'client_id', ocdel), 'deleted oauth client')
    ) x(c, label) LOOP
      PERFORM set_config('request.jwt.claims', t.c::text, true); SET LOCAL ROLE authenticated;
      v := public.mcp_access_level(); RESET ROLE;
      IF v = 'none' THEN log := log || 'ok ' || t.label || E' -> none\n';
      ELSE fails := fails + 1; log := log || 'FAIL ' || t.label || ' -> ' || v || E'\n'; END IF;
      BEGIN PERFORM set_config('request.jwt.claims', t.c::text, true); SET LOCAL ROLE authenticated;
        PERFORM public.mcp_assert_write(); RESET ROLE;
        fails := fails + 1; log := log || 'FAIL ' || t.label || E' passed assert_write\n';
      EXCEPTION WHEN others THEN RESET ROLE; END;
    END LOOP;
  END;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', a, 'role', 'authenticated', 'session_id', so, 'client_id', oc)::text, true);
  SET LOCAL ROLE authenticated; v := public.mcp_access_level(); RESET ROLE;
  IF v = 'read' THEN log := log || E'ok live OAuth session without grant = read\n'; ELSE fails := fails + 1; log := log || 'FAIL oauth ' || v || E'\n'; END IF;
  PERFORM set_config('request.jwt.claims', '{}', true); SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.mcp_assert_write(); RESET ROLE; fails := fails + 1; log := log || E'FAIL no-uid assert_write\n';
  EXCEPTION WHEN others THEN RESET ROLE; log := log || E'ok missing auth.uid denied by assert_write\n'; END;

  -- B. Direct bypasses ----------------------------------------------------------------------
  IF NOT has_function_privilege('anon', 'public.suspend_work_item_monitoring(uuid,text)', 'EXECUTE')
     AND NOT has_function_privilege('anon', 'public.resume_work_item_monitoring(uuid)', 'EXECUTE')
     AND NOT has_function_privilege('anon', 'public.apply_system_computed_stage(uuid,text,text,jsonb)', 'EXECUTE')
     AND NOT has_function_privilege('authenticated', 'public.apply_system_computed_stage(uuid,text,text,jsonb)', 'EXECUTE')
     AND NOT has_function_privilege('anon', 'public.decide_correspondence_closure(uuid,text)', 'EXECUTE')
     AND NOT has_function_privilege('anon', 'public.decide_deadline_discharge(uuid,boolean)', 'EXECUTE')
     AND NOT has_function_privilege('anon', 'public.set_notification_user_state(uuid[],text,timestamptz)', 'EXECUTE')
     AND has_function_privilege('service_role', 'public.apply_system_computed_stage(uuid,text,text,jsonb)', 'EXECUTE') THEN
    log := log || E'ok anon has no EXECUTE on direct writers; system stage is service_role only\n';
  ELSE fails := fails + 1; log := log || E'FAIL direct writer grants\n'; END IF;

  PERFORM set_config('request.jwt.claims', ca::text, true); SET LOCAL ROLE authenticated;
  r := public.mcp_create_work_item('CGP', NULL, rad, 'rb', NULL, NULL, NULL, 'Juzgado 2', NULL, 'rb-create-0001');
  RESET ROLE; wi := (r->'work_item'->>'id')::uuid;

  BEGIN PERFORM set_config('request.jwt.claims', cb::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.suspend_work_item_monitoring(wi, 'ataque'); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL cross-owner suspend allowed\n';
  EXCEPTION WHEN others THEN RESET ROLE; log := log || E'ok cross-owner suspend denied\n'; END;
  BEGIN PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', a, 'role', 'authenticated', 'session_id', so, 'client_id', oc)::text, true);
    SET LOCAL ROLE authenticated; PERFORM public.suspend_work_item_monitoring(wi, 'oauth ro'); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL read-only OAuth suspend allowed\n';
  EXCEPTION WHEN others THEN RESET ROLE; log := log || E'ok read-only OAuth suspend denied\n'; END;
  BEGIN PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', a, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated; PERFORM public.resume_work_item_monitoring(wi); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL unverified resume allowed\n';
  EXCEPTION WHEN others THEN RESET ROLE; log := log || E'ok unverified resume denied\n'; END;
  BEGIN PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true); SET LOCAL ROLE anon;
    PERFORM public.suspend_work_item_monitoring(wi, 'anon'); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL anon suspend allowed\n';
  EXCEPTION WHEN others THEN RESET ROLE; log := log || E'ok anon suspend denied\n'; END;
  SELECT * INTO w FROM public.work_items WHERE id = wi;
  IF w.monitoring_disabled_by IS NULL AND w.monitoring_enabled THEN log := log || E'ok denied calls left monitoring unchanged\n';
  ELSE fails := fails + 1; log := log || E'FAIL monitoring mutated by denied call\n'; END IF;
  PERFORM set_config('request.jwt.claims', ca::text, true); SET LOCAL ROLE authenticated;
  PERFORM public.suspend_work_item_monitoring(wi, 'pausa del dueño'); RESET ROLE;
  SELECT * INTO w FROM public.work_items WHERE id = wi;
  IF w.monitoring_disabled_by = 'USER' AND NOT w.monitoring_enabled THEN log := log || E'ok owner suspend works\n';
  ELSE fails := fails + 1; log := log || E'FAIL owner suspend\n'; END IF;
  PERFORM set_config('request.jwt.claims', ca::text, true); SET LOCAL ROLE authenticated;
  PERFORM public.resume_work_item_monitoring(wi); RESET ROLE;
  IF (SELECT monitoring_enabled FROM public.work_items WHERE id = wi) THEN log := log || E'ok owner resume works\n';
  ELSE fails := fails + 1; log := log || E'FAIL owner resume\n'; END IF;
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true); SET LOCAL ROLE service_role;
  PERFORM public.apply_system_computed_stage(wi, 'RADICADO', 'test', '{}'); PERFORM public.suspend_work_item_monitoring(wi, 'mantenimiento');
  RESET ROLE; log := log || E'ok trusted service_role maintenance path still works\n';
  PERFORM set_config('request.jwt.claims', ca::text, true); SET LOCAL ROLE authenticated;
  PERFORM public.resume_work_item_monitoring(wi); RESET ROLE;

  INSERT INTO public.work_item_deadlines (work_item_id, owner_id, trigger_date, trigger_event, deadline_type, label, status, deadline_date)
  VALUES (wi, a, current_date, 'TEST', 'TEST', 'rb test', 'CERRADO_POR_CORRESPONDENCIA_SIN_VERIFICAR', current_date + 5)
  RETURNING id INTO did;
  BEGIN PERFORM set_config('request.jwt.claims', cb::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.decide_correspondence_closure(did, 'CONFIRM'); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL cross-owner correspondence decision allowed\n';
  EXCEPTION WHEN others THEN RESET ROLE; log := log || E'ok cross-owner correspondence decision denied\n'; END;
  BEGIN PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', a, 'role', 'authenticated', 'session_id', so, 'client_id', oc)::text, true);
    SET LOCAL ROLE authenticated; PERFORM public.decide_correspondence_closure(did, 'CONFIRM'); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL read-only OAuth correspondence decision allowed\n';
  EXCEPTION WHEN others THEN RESET ROLE; log := log || E'ok read-only OAuth correspondence decision denied\n'; END;
  IF (SELECT status FROM public.work_item_deadlines WHERE id = did) = 'CERRADO_POR_CORRESPONDENCIA_SIN_VERIFICAR' THEN
    log := log || E'ok deadline unchanged after denied decisions\n';
  ELSE fails := fails + 1; log := log || E'FAIL deadline mutated\n'; END IF;
  BEGIN PERFORM set_config('request.jwt.claims', cb::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.decide_deadline_discharge(gen_random_uuid(), true); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL discharge on unknown id\n';
  EXCEPTION WHEN others THEN RESET ROLE; log := log || E'ok discharge decision denied for non-owner/unknown\n'; END;

  -- C. Notifications / alerts: explicit visibility, no cross-user existence leak -------------
  INSERT INTO public.notifications (audience_scope, category, title, user_id) VALUES ('USER', 'SYSTEM', 'rb', a) RETURNING id INTO nid;
  INSERT INTO public.alert_instances (owner_id, entity_type, entity_id, title, message, alert_type, fingerprint)
  VALUES (a, 'WORK_ITEM', wi, 'rb', 'rb', 'SUGERENCIA_PENDIENTE', 'rb_' || gen_random_uuid()) RETURNING id INTO aid;
  IF aid IS NULL THEN fails := fails + 1; log := log || E'FAIL fixture alert suppressed\n'; END IF;
  BEGIN PERFORM set_config('request.jwt.claims', cb::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.mcp_set_notification_state(ARRAY[nid], 'read', NULL, 'rb-notif-b-0001'); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL cross-user notification state via MCP\n';
  EXCEPTION WHEN others THEN RESET ROLE;
    IF SQLERRM LIKE 'NOT_FOUND%' THEN log := log || E'ok cross-user notification via definer wrapper -> NOT_FOUND\n';
    ELSE fails := fails + 1; log := log || 'FAIL notif error ' || SQLERRM || E'\n'; END IF; END;
  BEGIN PERFORM set_config('request.jwt.claims', cb::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.mcp_set_notification_state(ARRAY[aid], 'read', NULL, 'rb-notif-b-0002'); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL other user alert id accepted\n';
  EXCEPTION WHEN others THEN RESET ROLE;
    IF SQLERRM LIKE 'NOT_FOUND%' THEN log := log || E'ok other user alert id -> NOT_FOUND (no WRONG_KIND leak)\n';
    ELSE fails := fails + 1; log := log || 'FAIL alert-kind leak ' || SQLERRM || E'\n'; END IF; END;
  BEGIN PERFORM set_config('request.jwt.claims', cb::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.mcp_resolve_alert(nid, 'acknowledge', 'rb-alert-b-0001'); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL other user notification as alert\n';
  EXCEPTION WHEN others THEN RESET ROLE;
    IF SQLERRM LIKE 'NOT_FOUND%' THEN log := log || E'ok other user notification id in resolve_alert -> NOT_FOUND\n';
    ELSE fails := fails + 1; log := log || 'FAIL notif-kind leak ' || SQLERRM || E'\n'; END IF; END;
  BEGIN PERFORM set_config('request.jwt.claims', cb::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.set_notification_user_state(ARRAY[nid], 'dismiss', NULL); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL direct cross-user notification state\n';
  EXCEPTION WHEN others THEN RESET ROLE; log := log || E'ok direct cross-user notification state denied\n'; END;
  IF NOT EXISTS (SELECT 1 FROM public.notification_user_state WHERE notification_id = nid) THEN
    log := log || E'ok no notification state written for denied calls\n';
  ELSE fails := fails + 1; log := log || E'FAIL notification state written\n'; END IF;
  PERFORM set_config('request.jwt.claims', ca::text, true); SET LOCAL ROLE authenticated;
  r := public.mcp_set_notification_state(ARRAY[nid], 'read', NULL, 'rb-notif-a-0001'); RESET ROLE;
  IF (r->>'updated')::int = 1 THEN log := log || E'ok owner notification read via MCP\n'; ELSE fails := fails + 1; log := log || E'FAIL owner notif\n'; END IF;
  BEGIN PERFORM set_config('request.jwt.claims', ca::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.mcp_set_notification_state(ARRAY[aid], 'read', NULL, 'rb-notif-a-0002'); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL own alert accepted as notification\n';
  EXCEPTION WHEN others THEN RESET ROLE;
    IF SQLERRM LIKE 'WRONG_KIND%' THEN log := log || E'ok own alert id -> WRONG_KIND hint\n';
    ELSE fails := fails + 1; log := log || 'FAIL ' || SQLERRM || E'\n'; END IF; END;

  -- D. Creation parity --------------------------------------------------------------------
  SELECT * INTO w FROM public.work_items WHERE id = wi;
  IF w.stage IN ('PREPARACION', 'RADICADO') AND w.cgp_phase::text = 'FILING' THEN log := log || E'ok CGP default stage PREPARACION/FILING\n';
  ELSE fails := fails + 1; log := log || 'FAIL default stage ' || w.stage || E'\n'; END IF;
  SELECT count(*) INTO n FROM public.work_item_reminders WHERE work_item_id = wi AND status = 'ACTIVE';
  IF n = 2 THEN log := log || E'ok reminders: EXPEDIENTE + AUTO_ADMISORIO (authority and valid radicado present)\n';
  ELSE fails := fails + 1; log := log || 'FAIL reminders ' || n || E'\n'; END IF;
  SELECT count(*) INTO n FROM public.sync_retry_queue WHERE work_item_id = wi AND last_error_code = 'MCP_INITIAL_SYNC';
  IF n = 2 THEN log := log || E'ok durable initial sync enqueued (PUB + ACT)\n'; ELSE fails := fails + 1; log := log || 'FAIL sync queue ' || n || E'\n'; END IF;
  PERFORM set_config('request.jwt.claims', ca::text, true); SET LOCAL ROLE authenticated;
  r := public.mcp_create_work_item('LABORAL', NULL, rad, 'rb lab', NULL, NULL, NULL, NULL, 'Cliente pidió pausar', 'rb-create-0002');
  RESET ROLE; wl := (r->'work_item'->>'id')::uuid;
  SELECT * INTO w FROM public.work_items WHERE id = wl;
  IF w.monitoring_disabled_by = 'USER' AND w.monitoring_disabled_reason = 'Cliente pidió pausar' AND NOT w.monitoring_enabled
     AND NOT EXISTS (SELECT 1 FROM public.sync_retry_queue WHERE work_item_id = wl) THEN
    log := log || E'ok same radicado in another workflow allowed; deliberate suspension reason preserved; no sync enqueued\n';
  ELSE fails := fails + 1; log := log || 'FAIL suspension reason ' || COALESCE(w.monitoring_disabled_reason, 'null') || E'\n'; END IF;
  BEGIN PERFORM set_config('request.jwt.claims', ca::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.mcp_create_work_item('LABORAL', NULL, rad, 'rb lab', NULL, NULL, NULL, NULL, 'otra razón', 'rb-create-0002'); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL idempotency hash ignores monitoring reason\n';
  EXCEPTION WHEN others THEN RESET ROLE;
    IF SQLERRM LIKE 'IDEMPOTENCY_KEY_REUSED%' THEN log := log || E'ok idempotency hash covers monitoring_off_reason\n';
    ELSE fails := fails + 1; log := log || 'FAIL ' || SQLERRM || E'\n'; END IF; END;
  BEGIN PERFORM set_config('request.jwt.claims', ca::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.mcp_create_work_item('CPACA', 'NO_EXISTE', NULL, 'x', NULL, NULL, NULL, NULL, NULL, 'rb-create-0003'); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL invalid stage accepted\n';
  EXCEPTION WHEN others THEN RESET ROLE;
    IF SQLERRM LIKE 'INVALID_STAGE%' THEN log := log || E'ok invalid stage rejected\n'; ELSE fails := fails + 1; log := log || 'FAIL ' || SQLERRM || E'\n'; END IF; END;
  BEGIN PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', a, 'role', 'authenticated', 'session_id', so, 'client_id', oc)::text, true);
    SET LOCAL ROLE authenticated; PERFORM public.mcp_create_work_item('TUTELA', NULL, NULL, 'x', NULL, NULL, NULL, NULL, NULL, 'rb-create-0004'); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL read-only OAuth create\n';
  EXCEPTION WHEN others THEN RESET ROLE; log := log || E'ok read-only OAuth create denied\n'; END;

  -- E. Email subject radicados ------------------------------------------------------------
  IF public._mcp_subject_radicado_bases('RV: Memorial rad. 05001-31-03-001-2024-00123-00 urgente') = ARRAY['050013103001202400123']
     AND cardinality(public._mcp_subject_radicado_bases('Factura 12345')) = 0 THEN
    log := log || E'ok raw subject radicados parsed (separators tolerated)\n';
  ELSE fails := fails + 1; log := log || E'FAIL subject parse\n'; END IF;

  -- F. Feed: server-stored cursors, fixed watermark, monotonic checkpoint ------------------
  PERFORM set_config('request.jwt.claims', ca::text, true); SET LOCAL ROLE authenticated;
  r := public.mcp_list_updates(NULL, 1, NULL); RESET ROLE;
  cur := r->>'next_cursor';
  IF cur ~ '^c1\.' AND (r->>'has_more')::boolean AND jsonb_array_length(r->'events') = 1 AND r ? 'freshness' THEN
    log := log || E'ok first page: opaque cursor, has_more, freshness present\n';
  ELSE fails := fails + 1; log := log || 'FAIL first page ' || left(r::text, 200) || E'\n'; END IF;
  -- A revision after the fixed watermark must not enter the current pass.
  UPDATE public.work_items SET lifecycle_changed_at = now() + interval '1 hour' WHERE id = wl;
  n := 0;
  LOOP
    PERFORM set_config('request.jwt.claims', ca::text, true); SET LOCAL ROLE authenticated;
    r := public.mcp_list_updates(cur, 1, NULL); RESET ROLE;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(r->'events') e WHERE (e->>'id')::uuid = wl) THEN n := n + 1; END IF;
    cur := r->>'next_cursor';
    EXIT WHEN NOT (r->>'has_more')::boolean;
  END LOOP;
  cp1 := (r->>'checkpoint')::timestamptz;
  IF n = 0 AND cp1 = (r->>'scan_upper_watermark')::timestamptz THEN log := log || E'ok fixed watermark excluded later revision; checkpoint = watermark at pass end\n';
  ELSE fails := fails + 1; log := log || E'FAIL watermark/checkpoint\n'; END IF;
  PERFORM set_config('request.jwt.claims', ca::text, true); SET LOCAL ROLE authenticated;
  r := public.mcp_list_updates(cur, 50, NULL); r2 := public.mcp_list_updates(r->>'next_cursor', 50, NULL); RESET ROLE;
  cp2 := (r2->>'checkpoint')::timestamptz;
  IF cp2 >= cp1 AND (r->>'checkpoint')::timestamptz >= cp1 THEN log := log || E'ok quiet polls never move checkpoint backwards\n';
  ELSE fails := fails + 1; log := log || E'FAIL checkpoint regressed\n'; END IF;
  BEGIN PERFORM set_config('request.jwt.claims', cb::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.mcp_list_updates(cur, 10, NULL); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL foreign cursor accepted\n';
  EXCEPTION WHEN others THEN RESET ROLE; log := log || E'ok other user cannot use the cursor\n'; END;
  BEGIN PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', a, 'role', 'authenticated', 'session_id', so, 'client_id', oc)::text, true);
    SET LOCAL ROLE authenticated; PERFORM public.mcp_list_updates(cur, 10, NULL); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL cursor crossed AI clients\n';
  EXCEPTION WHEN others THEN RESET ROLE; log := log || E'ok cursor bound to AI client\n'; END;
  BEGIN PERFORM set_config('request.jwt.claims', ca::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.mcp_list_updates(encode(convert_to(jsonb_build_object('v', 2, 'u', a, 'ts', '2000-01-01')::text, 'UTF8'), 'base64'), 10, NULL); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL forged legacy cursor accepted\n';
  EXCEPTION WHEN others THEN RESET ROLE; log := log || E'ok forged/legacy base64 cursor rejected\n'; END;
  BEGIN PERFORM set_config('request.jwt.claims', ca::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.mcp_list_updates(cur, 10, wi); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL cursor filter mismatch accepted\n';
  EXCEPTION WHEN others THEN RESET ROLE; log := log || E'ok cursor bound to filter\n'; END;
  UPDATE public.mcp_feed_cursors SET expires_at = now() - interval '1 second' WHERE id = substr(cur, 4)::uuid;
  BEGIN PERFORM set_config('request.jwt.claims', ca::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.mcp_list_updates(cur, 10, NULL); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL expired cursor silently reset\n';
  EXCEPTION WHEN others THEN RESET ROLE;
    IF SQLERRM LIKE 'CURSOR_EXPIRED%' THEN log := log || E'ok expired cursor demands reconcile (no silent reset)\n';
    ELSE fails := fails + 1; log := log || 'FAIL ' || SQLERRM || E'\n'; END IF; END;
  PERFORM set_config('request.jwt.claims', ca::text, true); SET LOCAL ROLE authenticated;
  r := public.mcp_reconcile_updates(now() - interval '1 day', 500, wi); RESET ROLE;
  IF r->>'mode' = 'reconcile' AND r->'freshness'->>'scope' = 'work_item' AND jsonb_array_length(r->'freshness'->'items') = 1 THEN
    log := log || E'ok reconcile mode with scoped freshness\n';
  ELSE fails := fails + 1; log := log || 'FAIL reconcile ' || left(r::text, 200) || E'\n'; END IF;
  PERFORM set_config('request.jwt.claims', ca::text, true); SET LOCAL ROLE authenticated;
  r := public.mcp_list_updates(NULL, 10, gen_random_uuid()); RESET ROLE;
  IF jsonb_array_length(r->'events') = 0 AND r->'freshness' ? 'by_provider' THEN log := log || E'ok empty page still reports scoped freshness\n';
  ELSE fails := fails + 1; log := log || E'FAIL empty-page freshness\n'; END IF;

  RAISE EXCEPTION 'TEST_RESULTS fails=% %', fails, E'\n' || log;
END $test$;
