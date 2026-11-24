-- Run with the queue migration installed. The fixtures and audit rows always roll back.
BEGIN;
DO $test$
DECLARE
  owner_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  organization_id uuid := gen_random_uuid();
  client_id uuid := gen_random_uuid();
  native_session uuid := gen_random_uuid();
  agent_session uuid := gen_random_uuid();
  other_session uuid := gen_random_uuid();
  matter_id uuid := gen_random_uuid();
  second_matter_id uuid := gen_random_uuid();
  review_id uuid := gen_random_uuid();
  second_review_id uuid := gen_random_uuid();
  owner_claims jsonb;
  agent_claims jsonb;
  other_claims jsonb;
  page jsonb;
  next_page jsonb;
  result jsonb;
  event_id text;
  event_2 text;
  deadline_before jsonb;
BEGIN
  INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (owner_id, 'authenticated', 'authenticated', owner_id || '@example.invalid', now(), '{}', '{}'),
      (other_id, 'authenticated', 'authenticated', other_id || '@example.invalid', now(), '{}', '{}');
  INSERT INTO public.organizations(id, name) VALUES (organization_id, 'Deadline review test ' || organization_id);
  INSERT INTO public.profiles(id, organization_id) VALUES (owner_id, organization_id)
    ON CONFLICT (id) DO UPDATE SET organization_id = excluded.organization_id;
  INSERT INTO auth.oauth_clients (id, registration_type, redirect_uris, grant_types, client_name, token_endpoint_auth_method)
    VALUES (client_id, 'dynamic', 'https://example.invalid/callback', 'authorization_code,refresh_token', 'Review test', 'none');
  INSERT INTO auth.oauth_consents (id, user_id, client_id, scopes, granted_at)
    VALUES (gen_random_uuid(), owner_id, client_id, 'openid email', now());
  INSERT INTO auth.sessions (id, user_id, oauth_client_id) VALUES
    (native_session, owner_id, null), (agent_session, owner_id, client_id), (other_session, other_id, null);
  INSERT INTO public.work_items (id, owner_id, organization_id, workflow_type, stage, title)
    VALUES (matter_id, owner_id, organization_id, 'CGP', 'NOTIFICACION', 'Review test A'),
      (second_matter_id, owner_id, organization_id, 'CGP', 'NOTIFICACION', 'Review test B');
  INSERT INTO public.work_item_deadlines (id, owner_id, organization_id, work_item_id, deadline_type, label, trigger_event, trigger_date, status)
    VALUES (review_id, owner_id, organization_id, matter_id, 'MANUAL', 'Review A', 'Evento A', current_date, 'REQUIERE_REVISION_MANUAL'),
      (second_review_id, owner_id, organization_id, second_matter_id, 'MANUAL', 'Review B', 'Evento B', current_date - 1, 'REQUIERE_REVISION_MANUAL');

  owner_claims := jsonb_build_object('sub', owner_id, 'role', 'authenticated', 'session_id', native_session);
  agent_claims := jsonb_build_object('sub', owner_id, 'role', 'authenticated', 'session_id', agent_session, 'client_id', client_id);
  other_claims := jsonb_build_object('sub', other_id, 'role', 'authenticated', 'session_id', other_session);

  PERFORM set_config('request.jwt.claims', agent_claims::text, true);
  SET LOCAL ROLE authenticated;
  page := public.list_pending_deadline_reviews(NULL, 1);
  event_id := page#>>'{events,0,event_id}';
  next_page := public.list_pending_deadline_reviews(page->>'next_cursor', 1);
  event_2 := next_page#>>'{events,0,event_id}';
  IF event_id IS NULL OR event_2 IS NULL OR event_id = event_2
    OR page#>'{events,0,allowed_actions}' IS DISTINCT FROM '[]'::jsonb
    OR (next_page->>'has_more')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Read-only pagination or action eligibility failed';
  END IF;
  BEGIN
    PERFORM public.mcp_resolve_deadline_reviews(ARRAY[event_id], 'acknowledge', NULL, 'review-denied-001');
    RAISE EXCEPTION 'Read-only OAuth call was allowed';
  EXCEPTION WHEN SQLSTATE 'MCP01' THEN NULL;
  END;
  BEGIN
    PERFORM public.acknowledge_deadline_reviews(ARRAY[review_id], 'acknowledge', NULL);
    RAISE EXCEPTION 'Read-only OAuth native bypass was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', other_claims::text, true);
  SET LOCAL ROLE authenticated;
  IF public.list_pending_deadline_reviews()->'events' IS DISTINCT FROM '[]'::jsonb THEN
    RAISE EXCEPTION 'Another user could read the review events';
  END IF;
  BEGIN
    PERFORM public.mcp_resolve_deadline_reviews(ARRAY[event_id], 'acknowledge', NULL, 'review-other-001');
    RAISE EXCEPTION 'Another user could write the review events';
  EXCEPTION WHEN SQLSTATE 'MCP09' THEN NULL;
  END;
  RESET ROLE;
  SELECT to_jsonb(d) INTO deadline_before FROM public.work_item_deadlines d WHERE d.id = review_id;

  PERFORM set_config('request.jwt.claims', owner_claims::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.grant_mcp_client_access(client_id, 'manage');
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', agent_claims::text, true);
  SET LOCAL ROLE authenticated;
  result := public.mcp_resolve_deadline_reviews(ARRAY[event_id,event_2], 'acknowledge', NULL, 'review-manage-001');
  IF result->'rows' IS DISTINCT FROM '2'::jsonb
    OR public.list_pending_deadline_reviews()->'events' IS DISTINCT FROM '[]'::jsonb THEN
    RAISE EXCEPTION 'Managed review did not drain the personal queue';
  END IF;
  result := public.mcp_resolve_deadline_reviews(ARRAY[event_2,event_id], 'acknowledge', NULL, 'review-manage-001');
  IF result->'replayed' IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'The same batch was not idempotent';
  END IF;
  RESET ROLE;
  IF (SELECT count(*) FROM public.mcp_action_audit a WHERE a.idem_key = 'review-manage-001' AND a.action = 'resolve_deadline_reviews') <> 1
    OR (SELECT to_jsonb(d) FROM public.work_item_deadlines d WHERE d.id = review_id) IS DISTINCT FROM deadline_before THEN
    RAISE EXCEPTION 'The audit was duplicated or the procedural deadline changed';
  END IF;

  UPDATE public.work_item_deadlines SET trigger_event = 'Evento rectificado' WHERE id = review_id;
  SET LOCAL ROLE authenticated;
  page := public.list_pending_deadline_reviews();
  IF jsonb_array_length(page->'events') <> 1 OR page#>>'{events,0,trigger_event}' <> 'Evento rectificado' THEN
    RAISE EXCEPTION 'The materially changed source event stayed hidden';
  END IF;
  RESET ROLE;
END;
$test$;
SELECT true AS deadline_review_queue_tests_passed;
ROLLBACK;
