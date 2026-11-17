-- Transactional acceptance test for PETICION operative terms (migration 0106).
-- Runs as a trusted backend, always ends with an exception so NOTHING persists.
DO $t$
DECLARE
  c uuid := '471b2dd7-cffd-441f-8293-55f39f7b51dd';
  r uuid := 'd07617ae-0081-47b5-9bb5-25d9d35a8dee';
  res jsonb; out text := ''; n int; d10 uuid; d15 uuid; err text; ok boolean;
BEGIN
  -- Calendar (ADMINISTRATIVO, colombian_holidays only)
  out := out || format('cal10=%s cal15=%s cal30=%s; ',
    public.add_business_days_sql('2026-11-16',10,'ADMINISTRATIVO'),
    public.add_business_days_sql('2026-11-16',15,'ADMINISTRATIVO'),
    public.add_business_days_sql('2026-11-16',30,'ADMINISTRATIVO'));
  out := out || format('yearend 2026-12-18+10=%s; 2027-03-19+15=%s; ',
    public.add_business_days_sql('2026-12-18',10,'ADMINISTRATIVO'),
    public.add_business_days_sql('2027-03-19',15,'ADMINISTRATIVO'));
  -- Admin calendar ignores judicial vacancia: fabricate one inside this rolled-back txn.
  INSERT INTO public.judicial_term_suspensions (owner_id, title, start_date, end_date, scope, active, reason)
  VALUES ('c64c2ca1-436a-44ee-a6ae-69bb19dfdc3a','TEST','2026-12-20','2027-01-10','GLOBAL_JUDICIAL', true, 'TEST vacancia');
  out := out || format('vacancia: admin=%s judicial=%s; ',
    public.add_business_days_sql('2026-12-18',10,'ADMINISTRATIVO'),
    public.add_business_days_sql('2026-12-18',10,'JUDICIAL'));

  -- Register mixed petition without any acuse/radicado
  res := public.peticion_register_presentation(c, '2026-11-16', 'USUARIO_DECLARADO', 'Correo enviado desde Outlook', ARRAY['GENERAL_INTERVENCION','DOCUMENTOS_INFORMACION'], NULL, NULL, false, NULL);
  SELECT string_agg((x->>'component')||'='||(x->>'deadline_date')||'/d1='||(x->'audit'->>'first_business_day')||'/tutela='||(x->'audit'->>'tutela_review_date'), ' ' ORDER BY x->>'component')
    INTO err FROM jsonb_array_elements(res->'deadlines') x;
  out := out || 'register v' || (res->>'version') || ': ' || err || '; ';
  SELECT count(*) INTO n FROM work_item_deadlines WHERE work_item_id=c AND deadline_type LIKE 'RESPUESTA_PETICION_%';
  out := out || 'deadlines=' || n || '; ';
  SELECT attribution INTO err FROM v_deadline_attribution WHERE work_item_id=c AND deadline_type='RESPUESTA_PETICION_GENERAL_INTERVENCION';
  out := out || 'attribution=' || err || '; ';
  SELECT count(*) INTO n FROM work_item_tasks WHERE work_item_id=c AND template_key LIKE 'peticion_tutela_eval:%';
  out := out || 'auto_tasks(no)=' || n || '; ';

  -- Idempotent retry
  res := public.peticion_register_presentation(c, '2026-11-16', 'USUARIO_DECLARADO', 'Correo enviado desde Outlook', ARRAY['DOCUMENTOS_INFORMACION','GENERAL_INTERVENCION'], NULL, NULL, false, NULL);
  SELECT count(*) INTO n FROM work_item_deadlines WHERE work_item_id=c AND deadline_type LIKE 'RESPUESTA_PETICION_%';
  out := out || format('retry idem=%s deadlines=%s; ', res->>'idempotent', n);

  -- Correction requires reason and current version
  BEGIN PERFORM public.peticion_register_presentation(c, '2026-11-13', 'USUARIO_DECLARADO', 'x', ARRAY['DOCUMENTOS_INFORMACION','GENERAL_INTERVENCION'], NULL, 1, false, NULL); out := out || 'noreason=ACCEPTED(BAD); ';
  EXCEPTION WHEN others THEN out := out || 'noreason=' || SQLERRM || '; '; END;
  BEGIN PERFORM public.peticion_register_presentation(c, '2026-11-13', 'USUARIO_DECLARADO', 'x', ARRAY['DOCUMENTOS_INFORMACION','GENERAL_INTERVENCION'], 'rebote', 0, false, NULL); out := out || 'stale=ACCEPTED(BAD); ';
  EXCEPTION WHEN others THEN out := out || 'stale=' || SQLERRM || '; '; END;
  BEGIN PERFORM public.peticion_register_presentation(c, '2026-12-31', 'USUARIO_DECLARADO', 'x', ARRAY['GENERAL_INTERVENCION'], 'x', 1, false, NULL); out := out || 'future=ACCEPTED(BAD); ';
  EXCEPTION WHEN others THEN out := out || 'future=' || SQLERRM || '; '; END;
  BEGIN PERFORM public.peticion_register_presentation(c, '2026-11-16', 'OUTLOOK', 'x', ARRAY['GENERAL_INTERVENCION'], 'x', 1, false, NULL); out := out || 'outlook_nolink=ACCEPTED(BAD); ';
  EXCEPTION WHEN others THEN out := out || 'outlook_nolink=' || SQLERRM || '; '; END;

  res := public.peticion_register_presentation(c, '2026-11-13', 'USUARIO_DECLARADO', 'Correo enviado (fecha corregida)', ARRAY['DOCUMENTOS_INFORMACION','GENERAL_INTERVENCION'], 'Prueba de corrección', 1, false, NULL);
  SELECT count(*) INTO n FROM work_item_deadlines WHERE work_item_id=c AND deadline_status='SUPERSEDED_BY_REANCHOR';
  out := out || format('reanchor v%s superseded=%s; ', res->>'version', n);
  SELECT string_agg((x->>'component')||'='||(x->>'deadline_date'), ' ') INTO err FROM jsonb_array_elements(res->'deadlines') x WHERE x->>'status'='PENDING';
  out := out || 'new: ' || err || '; ';
  SELECT count(*) INTO n FROM peticion_anchor_versions WHERE work_item_id=c;
  out := out || 'versions=' || n || '; ';

  SELECT id INTO d10 FROM work_item_deadlines WHERE work_item_id=c AND deadline_type='RESPUESTA_PETICION_DOCUMENTOS_INFORMACION' AND status='PENDING';
  SELECT id INTO d15 FROM work_item_deadlines WHERE work_item_id=c AND deadline_type='RESPUESTA_PETICION_GENERAL_INTERVENCION' AND status='PENDING';

  -- Extensions (d10 due 2026-11-27 after reanchor to 13/11)
  res := public.peticion_register_extension(d10, '2026-11-17', '2026-12-05', 'motivada', false);
  out := out || 'ext_unreviewed=' || (res->>'validity') || '; ';
  res := public.peticion_register_extension(d10, '2026-11-17', '2027-02-01', 'motivada', true);
  out := out || 'ext_overcap=' || (res->>'validity') || '/cap=' || (res->>'cap') || '; ';
  res := public.peticion_register_extension(d10, '2026-11-17', '2026-12-04', '', true);
  out := out || 'ext_nomotive=' || (res->>'validity') || '; ';
  res := public.peticion_register_extension(d10, '2026-11-17', '2026-12-04', 'Complejidad documental', true);
  out := out || 'ext_valid=' || (res->>'validity') || ' applied=' || (res->>'applied') || '; ';
  res := public.peticion_register_extension(d10, '2026-11-17', '2026-12-04', 'Complejidad documental', true);
  out := out || 'ext_retry_idem=' || (res->>'idempotent') || '; ';
  d10 := (res->>'deadline_id')::uuid;
  SELECT count(*) INTO n FROM work_item_deadlines WHERE work_item_id=c AND deadline_status='SUPERSEDED_BY_EXTENSION';
  out := out || 'history_kept=' || n || '; ';

  -- Partial response never closes; full answer closes only its component
  res := public.peticion_register_response(d15, 'PARCIAL', '2026-11-17', 'parcial', false);
  SELECT status INTO err FROM work_item_deadlines WHERE id=d15;
  out := out || 'partial->' || err || '; ';
  BEGIN PERFORM public.peticion_register_response(d10, 'DE_FONDO', '2026-11-17', 'x', false); out := out || 'fondo_unreviewed=ACCEPTED(BAD); ';
  EXCEPTION WHEN others THEN out := out || 'fondo_unreviewed=' || SQLERRM || '; '; END;
  res := public.peticion_register_response(d10, 'DE_FONDO', '2026-11-17', 'docs entregados', true);
  SELECT string_agg(deadline_type||':'||status, ',') INTO err FROM work_item_deadlines WHERE id IN (d10,d15);
  out := out || 'fondo->' || err || ' open=' || (res->>'open_components') || '; ';

  -- Evaluator on an expired operative mixed petition (Rionegro, backdated inside the txn)
  res := public.peticion_register_presentation(r, '2026-10-01', 'USUARIO_DECLARADO', 'test', ARRAY['DOCUMENTOS_INFORMACION','GENERAL_INTERVENCION'], NULL, NULL, false, NULL);
  res := public.evaluate_peticion_system_events();
  SELECT string_agg(event_code, ',' ORDER BY event_code) INTO err FROM peticion_events WHERE work_item_id=r AND source='SYSTEM' AND event_code NOT IN ('PRESENTACION_REGISTRADA','TERMINO_OPERATIVO_GENERADO');
  out := out || 'eval events: ' || coalesce(err,'none') || '; ';
  SELECT count(*) INTO n FROM work_item_deadlines WHERE work_item_id=r AND deadline_type='ENTREGA_COPIAS_ACEPTACION_FICTA';
  out := out || 'deemed_delivery_deadlines=' || n || '; ';
  res := public.evaluate_peticion_system_events();
  SELECT count(*) INTO n FROM peticion_events WHERE work_item_id=r AND event_code='RESPONSE_TERM_EXPIRED';
  out := out || 'eval rerun expired_events=' || n || '; ';

  -- Non-owner authenticated caller is denied
  PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  BEGIN PERFORM public.peticion_register_presentation(c, '2026-11-16', 'USUARIO_DECLARADO', 'x', ARRAY['GENERAL_INTERVENCION'], 'x', 3, false, NULL); out := out || 'stranger=ACCEPTED(BAD); ';
  EXCEPTION WHEN others THEN out := out || 'stranger=' || SQLSTATE || ' ' || left(SQLERRM,40) || '; '; END;

  RAISE EXCEPTION 'TEST_RESULTS (rolled back): %', out;
END $t$;
