-- DB-backed acceptance test for set_work_item_lifecycle authorization (0059/0064/0065).
-- Synthetic users/sessions/org/OAuth client only; always rolls back by raising
-- TEST_RESULTS at the end. Run as the database owner.
-- Note: when run as the owner, "no JWT at all" is the trusted maintenance path
-- by design (session_user postgres); PostgREST requests always carry a JWT.
DO $test$
DECLARE
  own uuid := gen_random_uuid(); adm uuid := gen_random_uuid(); pa uuid := gen_random_uuid();
  cl uuid := gen_random_uuid(); consent uuid := gen_random_uuid(); org uuid;
  s_own uuid := gen_random_uuid(); s_oauth uuid := gen_random_uuid(); s_adm uuid := gen_random_uuid(); s_pa uuid := gen_random_uuid();
  nat jsonb; oau jsonb; admj jsonb; paj jsonb;
  wi uuid; sib uuid; r jsonb; log text := ''; fails int := 0; n int; st text;
  rad text := '05001400300220990000100';
BEGIN
  INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  SELECT u, 'authenticated', 'authenticated', 'lc-test-' || u || '@example.invalid', now(), '{}', '{}', now(), now()
    FROM unnest(ARRAY[own, adm, pa]) u;
  INSERT INTO public.organizations (name) VALUES ('Org prueba ciclo') RETURNING id INTO org;
  INSERT INTO public.organization_memberships (organization_id, user_id, role) VALUES (org, own, 'MEMBER'), (org, adm, 'ADMIN');
  INSERT INTO public.platform_admins (user_id) VALUES (pa);
  INSERT INTO auth.oauth_clients (id, registration_type, redirect_uris, grant_types, client_name, token_endpoint_auth_method)
  VALUES (cl, 'dynamic', 'https://example.invalid/cb', 'authorization_code,refresh_token', 'Test agent', 'none');
  INSERT INTO auth.oauth_consents (id, user_id, client_id, scopes, granted_at) VALUES (consent, own, cl, 'openid email', now());
  INSERT INTO auth.sessions (id, user_id, oauth_client_id) VALUES (s_own, own, NULL), (s_oauth, own, cl), (s_adm, adm, NULL), (s_pa, pa, NULL);
  nat  := jsonb_build_object('sub', own, 'role', 'authenticated', 'session_id', s_own);
  oau  := jsonb_build_object('sub', own, 'role', 'authenticated', 'session_id', s_oauth, 'client_id', cl);
  admj := jsonb_build_object('sub', adm, 'role', 'authenticated', 'session_id', s_adm);
  paj  := jsonb_build_object('sub', pa, 'role', 'authenticated', 'session_id', s_pa);

  INSERT INTO public.work_items (owner_id, organization_id, workflow_type, stage, title, radicado)
  VALUES (own, org, 'CGP', 'DRAFTED', 'Prueba ciclo', rad) RETURNING id INTO wi;
  INSERT INTO public.work_items (owner_id, organization_id, workflow_type, stage, title, radicado)
  VALUES (adm, org, 'CGP', 'DRAFTED', 'Hermano otro dueño', left(rad, 21) || '02') RETURNING id INTO sib;

  -- denied callers: each must leave the row ACTIVE
  FOR st IN SELECT unnest(ARRAY['admin', 'platform_admin', 'no_sub', 'unverified', 'oauth_no_grant', 'anon']) LOOP
    BEGIN
      PERFORM set_config('request.jwt.claims', (CASE st
        WHEN 'admin' THEN admj WHEN 'platform_admin' THEN paj
        WHEN 'no_sub' THEN jsonb_build_object('role', 'authenticated')
        WHEN 'unverified' THEN jsonb_build_object('sub', own, 'role', 'authenticated', 'session_id', gen_random_uuid())
        WHEN 'oauth_no_grant' THEN oau
        ELSE jsonb_build_object('role', 'anon') END)::text, true);
      IF st = 'anon' THEN SET LOCAL ROLE anon; ELSE SET LOCAL ROLE authenticated; END IF;
      PERFORM public.set_work_item_lifecycle(wi, 'ARCHIVED', 'x', 'SYSTEM', adm, '{}');
      RESET ROLE; fails := fails + 1; log := log || 'FAIL ' || st || E' allowed\n';
    EXCEPTION WHEN others THEN RESET ROLE; log := log || 'ok ' || st || ' denied: ' || left(SQLERRM, 50) || E'\n'; END;
  END LOOP;
  IF (SELECT lifecycle_state::text FROM public.work_items WHERE id = wi) <> 'ACTIVE' THEN
    fails := fails + 1; log := log || E'FAIL mutation after denials\n'; END IF;

  -- revoked OAuth grant denied
  PERFORM set_config('request.jwt.claims', nat::text, true); SET LOCAL ROLE authenticated;
  PERFORM public.grant_mcp_client_access(cl, 'manage'); PERFORM public.revoke_mcp_client_access(cl); RESET ROLE;
  BEGIN
    PERFORM set_config('request.jwt.claims', oau::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.set_work_item_lifecycle(wi, 'ARCHIVED', 'x', 'USER', NULL, '{}');
    RESET ROLE; fails := fails + 1; log := log || E'FAIL revoked oauth allowed\n';
  EXCEPTION WHEN others THEN RESET ROLE; log := log || E'ok revoked oauth denied\n'; END;

  -- owner native session: trash; actor forced; ledger bound to the NEW outbox event; no sibling fanout
  PERFORM set_config('request.jwt.claims', nat::text, true); SET LOCAL ROLE authenticated;
  r := public.set_work_item_lifecycle(wi, 'DELETED', 'prueba', 'SYSTEM', adm, '{}'); RESET ROLE;
  IF (r->>'ok')::boolean IS NOT TRUE OR (r->>'purge_after') IS NULL THEN
    fails := fails + 1; log := log || 'FAIL owner trash ' || r::text || E'\n';
  ELSE log := log || E'ok owner native trash with purge_after\n'; END IF;
  IF (SELECT lifecycle_actor_user FROM public.work_items WHERE id = wi) IS DISTINCT FROM own
     OR (SELECT lifecycle_actor FROM public.work_items WHERE id = wi) <> 'USER' THEN
    fails := fails + 1; log := log || E'FAIL actor not forced\n'; ELSE log := log || E'ok actor forced to caller\n'; END IF;
  SELECT count(*) INTO n FROM public.work_item_lifecycle_ledger l
   WHERE l.work_item_id = wi AND l.to_state = 'DELETED' AND l.gcp_outbox_id = (r->>'gcp_outbox_id')::uuid;
  IF n <> 1 THEN fails := fails + 1; log := log || E'FAIL ledger not bound to new outbox\n'; ELSE log := log || E'ok ledger bound to new outbox event\n'; END IF;
  IF EXISTS (SELECT 1 FROM public.gcp_lifecycle_outbox WHERE work_item_id = sib) THEN
    fails := fails + 1; log := log || E'FAIL sibling fanout to other owner\n'; ELSE log := log || E'ok no sibling fanout\n'; END IF;
  IF (SELECT lifecycle_state::text FROM public.work_items WHERE id = sib) <> 'ACTIVE' THEN
    fails := fails + 1; log := log || E'FAIL sibling changed\n'; END IF;

  -- owner restore
  PERFORM set_config('request.jwt.claims', nat::text, true); SET LOCAL ROLE authenticated;
  r := public.set_work_item_lifecycle(wi, 'ACTIVE', 'restaurar', 'USER', NULL, '{}'); RESET ROLE;
  IF (SELECT deleted_at FROM public.work_items WHERE id = wi) IS NOT NULL THEN
    fails := fails + 1; log := log || E'FAIL restore left deleted_at\n'; ELSE log := log || E'ok owner restore\n'; END IF;

  -- trusted service-role path still works on another owner's row
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  r := public.set_work_item_lifecycle(sib, 'ARCHIVED', 'mantenimiento', 'SYSTEM', NULL, '{}');
  IF (r->>'ok')::boolean IS NOT TRUE THEN fails := fails + 1; log := log || E'FAIL service_role path\n'; ELSE log := log || E'ok service_role maintenance path\n'; END IF;

  RAISE EXCEPTION 'TEST_RESULTS fails=% %', fails, E'\n' || log;
END $test$;
