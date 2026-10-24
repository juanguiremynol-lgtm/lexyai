-- DB-backed acceptance test for MCP creation/stage parity (0066/0067).
-- Synthetic user/sessions/org only; always rolls back by raising TEST_RESULTS. Run as the database owner.
-- Passed with fails=0 on 2026-10-24 (re-run after 0071).
DO $test$
DECLARE
  u uuid := gen_random_uuid(); adm uuid := gen_random_uuid(); s uuid := gen_random_uuid(); sa uuid := gen_random_uuid(); org uuid;
  nat jsonb; r jsonb; cgp uuid; lab uuid; pet uuid; cpa uuid; w record; log text := ''; fails int := 0; n int;
  rad text := '05001400300220990000100';
BEGIN
  -- Gated RPCs: transaction-local grants, discarded by the final rollback.
  GRANT EXECUTE ON FUNCTION public.mcp_create_work_item(text, text, text, text, uuid, text, text, text, text, text) TO authenticated;
  GRANT EXECUTE ON FUNCTION public.mcp_move_work_item_stage(uuid, text, timestamptz, text[], text, text) TO authenticated;
  INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  SELECT x, 'authenticated', 'authenticated', 'st-test-' || x || '@example.invalid', now(), '{}', '{}', now(), now() FROM unnest(ARRAY[u, adm]) x;
  INSERT INTO auth.sessions (id, user_id) VALUES (s, u), (sa, adm);
  nat := jsonb_build_object('sub', u, 'role', 'authenticated', 'session_id', s);
  PERFORM set_config('request.jwt.claims', nat::text, true); SET LOCAL ROLE authenticated;
  cgp := (public.mcp_create_work_item('CGP', 'DRAFTED', rad, 'cgp', NULL, NULL, NULL, NULL, NULL, 'k-cgp-0001')->'work_item'->>'id')::uuid;
  lab := (public.mcp_create_work_item('LABORAL', 'BORRADOR', NULL, 'lab', NULL, NULL, NULL, NULL, 'PENDIENTE_DE_RADICACION', 'k-lab-0001')->'work_item'->>'id')::uuid;
  pet := (public.mcp_create_work_item('PETICION', 'PETICION_RADICADA', NULL, 'pet', NULL, NULL, NULL, NULL, 'PENDIENTE_DE_RADICACION', 'k-pet-0001')->'work_item'->>'id')::uuid;
  cpa := (public.mcp_create_work_item('CPACA', 'PRECONTENCIOSO', NULL, 'cpa', NULL, NULL, NULL, NULL, 'PENDIENTE_DE_RADICACION', 'k-cpa-0001')->'work_item'->>'id')::uuid;
  RESET ROLE;
  SELECT * INTO w FROM public.work_items WHERE id = cgp;
  IF w.cgp_phase::text = 'FILING' AND w.cgp_phase_source::text = 'MANUAL' AND w.status::text = 'ACTIVE' AND w.radicado = rad AND w.owner_id = u THEN
    log := log || E'ok CGP create FILING/MANUAL, status ACTIVE via trigger, normalized radicado\n';
  ELSE fails := fails + 1; log := log || E'FAIL CGP create\n'; END IF;
  SELECT * INTO w FROM public.work_items WHERE id = lab;
  IF w.cgp_phase IS NULL AND w.cgp_phase_source IS NULL THEN log := log || E'ok LABORAL create cgp_phase/source NULL\n';
  ELSE fails := fails + 1; log := log || E'FAIL LABORAL phase\n'; END IF;
  IF (SELECT stage FROM public.work_items WHERE id = pet) = 'BORRADOR' THEN log := log || E'ok PETICION live catalogue default\n';
  ELSE fails := fails + 1; log := log || E'FAIL PETICION stage\n'; END IF;

  BEGIN PERFORM set_config('request.jwt.claims', nat::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.mcp_create_work_item('CGP', 'DRAFTED', '05001-40-03-002-2099-00001-00', 'dup', NULL, NULL, NULL, NULL, NULL, 'k-dup-0001'); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL duplicate allowed\n';
  EXCEPTION WHEN others THEN RESET ROLE; log := log || E'ok active duplicate rejected\n'; END;
  PERFORM set_config('request.jwt.claims', nat::text, true); SET LOCAL ROLE authenticated;
  PERFORM public.set_work_item_lifecycle(cgp, 'DELETED', 't', 'USER', NULL, '{}'); RESET ROLE;
  BEGIN PERFORM set_config('request.jwt.claims', nat::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.mcp_create_work_item('CGP', 'DRAFTED', rad, 'dup', NULL, NULL, NULL, NULL, NULL, 'k-dup-0002'); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL trash duplicate allowed\n';
  EXCEPTION WHEN others THEN RESET ROLE;
    IF SQLERRM LIKE 'DUPLICATE_IN_TRASH%' THEN log := log || E'ok trash duplicate reported as restorable\n';
    ELSE fails := fails + 1; log := log || E'FAIL trash dup msg\n'; END IF; END;
  PERFORM set_config('request.jwt.claims', nat::text, true); SET LOCAL ROLE authenticated;
  PERFORM public.set_work_item_lifecycle(cgp, 'ACTIVE', 'r', 'USER', NULL, '{}'); RESET ROLE;

  INSERT INTO public.organizations (name) VALUES ('Org st') RETURNING id INTO org;
  UPDATE public.work_items SET organization_id = org WHERE id IN (cgp, cpa);
  INSERT INTO public.organization_memberships (organization_id, user_id, role) VALUES (org, adm, 'ADMIN');
  PERFORM set_config('request.jwt.claims', nat::text, true); SET LOCAL ROLE authenticated;
  r := public.mcp_move_work_item_stage(cgp, 'ADMISION', (SELECT updated_at FROM public.work_items WHERE id = cgp), ARRAY['bogus'], 'k-mv-0001', NULL); RESET ROLE;
  SELECT * INTO w FROM public.work_items WHERE id = cgp;
  IF w.stage = 'ADMISION' AND w.cgp_phase::text = 'PROCESS' AND w.cgp_phase_source::text = 'MANUAL'
     AND w.last_stage_change_source::text = 'MANUAL_USER' AND w.last_stage_change_by_user_id = u AND w.last_stage_change_at IS NOT NULL THEN
    log := log || E'ok CGP move markers (client order ignored)\n';
  ELSE fails := fails + 1; log := log || E'FAIL CGP move markers\n'; END IF;
  SELECT count(*) INTO n FROM public.work_item_stage_audit WHERE work_item_id = cgp AND new_stage = 'ADMISION' AND new_cgp_phase = 'PROCESS' AND actor_user_id = u;
  IF n = 1 THEN log := log || E'ok stage audit row\n'; ELSE fails := fails + 1; log := log || E'FAIL stage audit\n'; END IF;
  BEGIN PERFORM set_config('request.jwt.claims', nat::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.mcp_move_work_item_stage(cgp, 'RADICADO', (SELECT updated_at FROM public.work_items WHERE id = cgp), NULL, 'k-mv-0002', NULL); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL regression allowed\n';
  EXCEPTION WHEN others THEN RESET ROLE; log := log || E'ok regression rejected\n'; END;
  BEGIN PERFORM set_config('request.jwt.claims', nat::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.mcp_move_work_item_stage(cgp, 'APELACION', (SELECT updated_at FROM public.work_items WHERE id = cgp), NULL, 'k-mv-0003', NULL); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL legacy target allowed\n';
  EXCEPTION WHEN others THEN RESET ROLE; log := log || E'ok legacy key rejected as target\n'; END;
  PERFORM set_config('request.jwt.claims', nat::text, true); SET LOCAL ROLE authenticated;
  r := public.mcp_move_work_item_stage(cpa, 'DEMANDA_RADICADA', (SELECT updated_at FROM public.work_items WHERE id = cpa), NULL, 'k-mv-0004', NULL); RESET ROLE;
  IF (SELECT stage FROM public.work_items WHERE id = cpa) = 'DEMANDA_RADICADA' AND (SELECT cgp_phase FROM public.work_items WHERE id = cpa) IS NULL THEN
    log := log || E'ok CPACA forward move\n';
  ELSE fails := fails + 1; log := log || E'FAIL CPACA move\n'; END IF;
  BEGIN PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', adm, 'role', 'authenticated', 'session_id', sa)::text, true); SET LOCAL ROLE authenticated;
    PERFORM public.mcp_move_work_item_stage(cpa, 'AUTO_ADMISORIO', (SELECT updated_at FROM public.work_items WHERE id = cpa), NULL, 'k-mv-0005', NULL); RESET ROLE;
    fails := fails + 1; log := log || E'FAIL org admin moved\n';
  EXCEPTION WHEN others THEN RESET ROLE; log := log || E'ok org admin denied\n'; END;
  PERFORM set_config('request.jwt.claims', nat::text, true); SET LOCAL ROLE authenticated;
  r := public.mcp_move_work_item_stage(pet, 'RADICADA', (SELECT updated_at FROM public.work_items WHERE id = pet), NULL, 'k-mv-0006', NULL); RESET ROLE;
  IF r->>'validated_by' LIKE 'catalog%' THEN log := log || E'ok PETICION catalogue move\n';
  ELSE fails := fails + 1; log := log || E'FAIL PETICION move\n'; END IF;

  RAISE EXCEPTION 'TEST_RESULTS fails=% %', fails, E'\n' || log;
END $test$;
