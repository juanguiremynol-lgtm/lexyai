-- Phase 3: PETICION authority attribution, live status, canonical alerts and atomic MCP creation.
DO $pre$
BEGIN
  IF to_regprocedure('public.evaluate_peticion_system_events()') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: evaluate_peticion_system_events() missing';
  END IF;
  IF to_regprocedure('public._evaluate_peticion_system_events_core()') IS NOT NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: core function already exists (migration partially applied?)';
  END IF;
  IF to_regprocedure('public.peticion_register_presentation(uuid,date,text,text,text[],text,integer,boolean,uuid)') IS NULL
     OR to_regprocedure('public.mcp_create_work_item(text,text,text,text,uuid,text,text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: required functions missing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.work_item_deadlines WHERE deadline_type LIKE 'RESPUESTA_PETICION_%'
              AND bound_party_source = 'PETICION_AUTORIDAD_DECIDE'
              AND bound_party_role NOT IN ('JUEZ','AUTORIDAD_ADMINISTRATIVA')) THEN
    RAISE EXCEPTION 'PREFLIGHT: unexpected attribution on petition deadlines';
  END IF;
END $pre$;

CREATE OR REPLACE FUNCTION public._peticion_insert_component_deadline(
  p_wi public.work_items, p_component text, p_anchor date, p_days integer,
  p_trigger_event text, p_trigger_date date, p_due date, p_version integer,
  p_supersedes uuid, p_extra jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_first date; v_review date; v_hol jsonb;
BEGIN
  v_first := public.add_business_days_sql(p_anchor, 1, 'ADMINISTRATIVO'::public.term_class);
  v_review := CASE WHEN p_due IS NULL THEN NULL
                   ELSE public.add_business_days_sql(p_due, 1, 'ADMINISTRATIVO'::public.term_class) END;
  SELECT COALESCE(jsonb_agg(h.holiday_date ORDER BY h.holiday_date), '[]'::jsonb) INTO v_hol
    FROM public.colombian_holidays h
   WHERE h.holiday_date > p_anchor AND h.holiday_date <= COALESCE(p_due, p_anchor);

  INSERT INTO public.work_item_deadlines
    (work_item_id, owner_id, organization_id, deadline_type, label, description,
     trigger_event, trigger_date, deadline_date, business_days_count, status,
     term_class, anchor_kind, anchor_source, anchor_provenance_note, supersedes_deadline_id,
     deadline_status, bound_party_role, bound_party_source, is_judge_side, requires_manual_review,
     calculation_meta)
  VALUES
    (p_wi.id, p_wi.owner_id, p_wi.organization_id, 'RESPUESTA_PETICION_' || p_component,
     'Respuesta de la autoridad — ' || public.peticion_component_label(p_component),
     public.peticion_component_basis(p_component) ||
       '. Cálculo operativo desde la presentación documentada; no acredita la recepción por la autoridad.',
     p_trigger_event, p_trigger_date, p_due, p_days,
     CASE WHEN p_due IS NULL THEN 'REQUIERE_REVISION_MANUAL' ELSE 'PENDING' END,
     'ADMINISTRATIVO', 'PRESENTACION_DOCUMENTADA', 'PRESENTACION_DOCUMENTADA',
     'Fecha de presentación declarada/vinculada (versión ' || p_version || ')', p_supersedes,
     CASE WHEN p_due IS NULL THEN NULL ELSE 'VIGENTE' END,
     'AUTORIDAD_ADMINISTRATIVA', 'PETICION_AUTORIDAD_DECIDE', false, p_due IS NULL,
     jsonb_build_object(
       'workflow_type', 'PETICION',
       'component', p_component,
       'anchor_version', p_version,
       'anchor_date', p_anchor,
       'original_anchor', COALESCE(p_extra->>'original_anchor', p_anchor::text),
       'original_days', COALESCE((p_extra->>'original_days')::int, p_days),
       'day_type', 'BUSINESS', 'days_amount', p_days,
       'norma', public.peticion_component_basis(p_component),
       'evidence_status', 'CALCULO_OPERATIVO_DESDE_PRESENTACION_DOCUMENTADA',
       'admin_term_audit', jsonb_build_object(
         'term_class', 'ADMINISTRATIVO',
         'calendar', 'colombian_holidays; sin vacancia judicial',
         'presented_on', p_anchor,
         'first_business_day', v_first,
         'days', p_days,
         'deadline_date', p_due,
         'holidays_excluded', v_hol,
         'tutela_review_date', v_review,
         'rule', 'Día de presentación excluido; el siguiente hábil es el día 1 (Ley 4 de 1913 art. 62)'),
       'requires_manual_review', p_due IS NULL,
       'manual_review_reason', CASE WHEN p_component = 'ESPECIAL' THEN 'REGIMEN_ESPECIAL'
                                    WHEN p_due IS NULL THEN 'CALENDARIO_SIN_COBERTURA' END
     ) || COALESCE(p_extra, '{}'::jsonb))
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'PETICION_DEADLINE_ABSORBED: % for %', p_component, p_wi.id USING ERRCODE = 'P0001';
  END IF;
  RETURN v_id;
END $$;

UPDATE public.work_item_deadlines
   SET bound_party_role = 'AUTORIDAD_ADMINISTRATIVA', is_judge_side = false
 WHERE deadline_type LIKE 'RESPUESTA_PETICION_%'
   AND bound_party_source = 'PETICION_AUTORIDAD_DECIDE'
   AND bound_party_role = 'JUEZ';

CREATE OR REPLACE FUNCTION public.deadline_attribution(p_bound text, p_bound_source text, p_is_judge boolean, p_client_role text, p_client_role_source text, p_represents text)
 RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public'
AS $function$
DECLARE v_bound text := UPPER(COALESCE(p_bound,'DESCONOCIDO'));
        v_role  text := UPPER(COALESCE(p_client_role,''));
        v_rep   text := UPPER(COALESCE(p_represents,''));
        v_side  text;
        v_confirmed boolean := UPPER(COALESCE(p_client_role_source,'')) = 'CONFIRMADO';
        v_own boolean;
BEGIN
  IF v_bound = 'AUTORIDAD_ADMINISTRATIVA' THEN RETURN 'AUTORIDAD_ADMINISTRATIVA'; END IF;
  IF COALESCE(p_is_judge,false) OR v_bound = 'JUEZ' THEN RETURN 'JUEZ'; END IF;
  IF UPPER(COALESCE(p_bound_source,'')) = 'CATALOGO_GENERICO' THEN RETURN 'DESCONOCIDO'; END IF;
  v_side := CASE
    WHEN v_role IN ('DEMANDANTE','ACCIONANTE') THEN 'ACTIVA'
    WHEN v_role IN ('DEMANDADO','ACCIONADO') THEN 'PASIVA'
    WHEN v_role = 'APODERADO_DE_OFICIO' AND v_rep = 'DEMANDANTE' THEN 'ACTIVA'
    WHEN v_role = 'APODERADO_DE_OFICIO' AND v_rep = 'DEMANDADO' THEN 'PASIVA'
    ELSE NULL END;
  IF v_bound = 'AMBAS' THEN
    RETURN CASE WHEN v_confirmed THEN 'PROPIO' ELSE 'DESCONOCIDO' END;
  END IF;
  IF v_side IS NULL OR v_bound NOT IN ('DEMANDANTE','DEMANDADO') THEN RETURN 'DESCONOCIDO'; END IF;
  v_own := (v_bound = 'DEMANDANTE' AND v_side = 'ACTIVA')
        OR (v_bound = 'DEMANDADO'  AND v_side = 'PASIVA');
  IF NOT v_own THEN RETURN 'CONTRAPARTE'; END IF;
  RETURN CASE WHEN v_confirmed THEN 'PROPIO' ELSE 'DESCONOCIDO' END;
END $function$;

CREATE OR REPLACE FUNCTION public._peticion_admin_days_left(p_from date, p_to date)
RETURNS integer LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE WHEN p_to IS NULL OR p_from IS NULL THEN NULL
              WHEN p_to <= p_from THEN 0
              ELSE (SELECT count(*)::int FROM generate_series(p_from + 1, p_to, interval '1 day') g(d)
                     WHERE extract(isodow FROM g.d) < 6
                       AND NOT EXISTS (SELECT 1 FROM public.colombian_holidays h WHERE h.holiday_date = g.d::date)) END
$$;

CREATE OR REPLACE FUNCTION public.peticion_status(p_work_item_id uuid, p_today date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_today date := COALESCE(p_today, (now() AT TIME ZONE 'America/Bogota')::date);
  v_wi record; v_s record; v_comps jsonb; v_alerts jsonb; v_overall text;
BEGIN
  SELECT id, workflow_type::text AS wf, created_at, lifecycle_state::text AS lc, deleted_at
    INTO v_wi FROM public.work_items WHERE id = p_work_item_id;
  IF NOT FOUND OR v_wi.wf <> 'PETICION' THEN RETURN NULL; END IF;
  SELECT * INTO v_s FROM public.peticion_work_item_state WHERE work_item_id = p_work_item_id;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'component'), '[]'::jsonb) INTO v_comps FROM (
    SELECT jsonb_build_object(
      'deadline_id', d.id,
      'component', d.calculation_meta->>'component',
      'label', public.peticion_component_label(d.calculation_meta->>'component'),
      'days', d.business_days_count,
      'first_business_day', CASE WHEN d.trigger_date IS NOT NULL
          THEN public.add_business_days_sql(COALESCE((d.calculation_meta->>'anchor_date')::date, d.trigger_date), 1, 'ADMINISTRATIVO'::public.term_class) END,
      'expected_due_date', d.deadline_date,
      'next_tutela_review_date', CASE WHEN d.deadline_date IS NOT NULL
          THEN public.add_business_days_sql(d.deadline_date, 1, 'ADMINISTRATIVO'::public.term_class) END,
      'business_days_left', CASE WHEN d.deadline_date IS NOT NULL AND v_today <= d.deadline_date
          THEN public._peticion_admin_days_left(v_today, d.deadline_date) END,
      'status', CASE
          WHEN d.status = 'MET' THEN 'ANSWERED'
          WHEN d.deadline_date IS NULL THEN 'REQUIERE_REVISION_TERMINO'
          WHEN v_today > d.deadline_date THEN 'OVERDUE'
          ELSE 'ACTIVE' END,
      'due_kind', CASE
          WHEN d.supersedes_deadline_id IS NOT NULL AND d.trigger_event ILIKE '%PRORROGA%' THEN 'EFECTIVO_POR_PRORROGA_REVISADA'
          WHEN d.anchor_source = 'PRESENTACION_DOCUMENTADA' THEN 'PROVISIONAL_OPERATIVO_DESDE_PRESENTACION'
          ELSE 'EFECTIVO' END,
      'legal_basis', public.peticion_component_basis(d.calculation_meta->>'component'),
      'attribution', 'AUTORIDAD_ADMINISTRATIVA',
      'obligation_note', 'Plazo de respuesta a cargo de la autoridad; al abogado le corresponde evaluar tutela o actuación procedente si vence sin respuesta de fondo.',
      'alert_expected', CASE
          WHEN d.status = 'MET' OR d.deadline_date IS NULL THEN NULL
          WHEN v_today >= public.add_business_days_sql(d.deadline_date, 1, 'ADMINISTRATIVO'::public.term_class) THEN 'PETICION_OVERDUE'
          WHEN v_today <= d.deadline_date AND public._peticion_admin_days_left(v_today, d.deadline_date) <= 3 THEN 'PETICION_DEADLINE'
          END
    ) AS x
    FROM public.work_item_deadlines d
    WHERE d.work_item_id = p_work_item_id
      AND d.deadline_type LIKE 'RESPUESTA_PETICION_%'
      AND d.status IN ('PENDING','REQUIERE_REVISION_MANUAL','PENDING_REVIEW','MET')
      AND COALESCE(d.deadline_status,'VIGENTE') NOT IN ('SUPERSEDED_BY_EXTENSION','SUPERSEDED_BY_REANCHOR')
  ) q;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a.id, 'alert_type', a.alert_type, 'severity', a.severity,
           'status', a.status, 'title', a.title, 'deadline_id', a.payload->>'deadline_id', 'fired_at', a.fired_at)
           ORDER BY a.fired_at DESC), '[]'::jsonb)
    INTO v_alerts FROM public.alert_instances a
   WHERE a.entity_id = p_work_item_id AND a.alert_type IN ('PETICION_DEADLINE','PETICION_OVERDUE')
     AND a.status NOT IN ('RESOLVED','CANCELLED','DISMISSED','SUPERSEDED');

  v_overall := CASE
    WHEN v_s.sent_at IS NULL THEN 'FALTA_FECHA_PRESENTACION'
    WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_comps) c WHERE c->>'status' = 'OVERDUE') THEN 'OVERDUE'
    WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_comps) c WHERE c->>'status' = 'ACTIVE') THEN 'ACTIVE'
    WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_comps) c WHERE c->>'status' = 'REQUIERE_REVISION_TERMINO') THEN 'PENDING_EVIDENCE'
    WHEN jsonb_array_length(v_comps) > 0 THEN 'ANSWERED'
    ELSE 'PENDING_EVIDENCE' END;

  RETURN jsonb_build_object(
    'evaluated_on', v_today, 'timezone', 'America/Bogota',
    'fecha_creacion_ficha', v_wi.created_at,
    'fecha_presentacion', v_s.sent_at,
    'fuente_fecha', v_s.presentation_source,
    'soporte', v_s.presentation_support,
    'anchor_source', v_s.anchor_source,
    'anchor_version', v_s.anchor_version,
    'components', COALESCE(to_jsonb(v_s.components), '[]'::jsonb),
    'referencia_autoridad', v_s.authority_radicado,
    'recepcion_acreditada', v_s.authority_received_at IS NOT NULL,
    'status', v_overall,
    'terms', v_comps,
    'alerts_active', v_alerts,
    'monitoring_route', 'ADMINISTRATIVO: correo Outlook vinculado + revisión diaria de términos; sin consulta judicial automática',
    'falta', CASE WHEN v_s.sent_at IS NULL THEN jsonb_build_object('code','FALTA_FECHA_PRESENTACION',
      'como_completar', 'Registrar la fecha de presentación en la ficha de la petición (app) o crearla con fecha desde el asistente. Nunca se usa la fecha de creación de la ficha.') END,
    'silencio_positivo', 'Nunca se aplica automáticamente desde el mero envío; requiere revisión humana.'
  );
END $$;
REVOKE ALL ON FUNCTION public.peticion_status(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.peticion_status(uuid, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sync_peticion_alerts(p_today date DEFAULT NULL, p_work_item uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := COALESCE(p_today, (now() AT TIME ZONE 'America/Bogota')::date);
  r record; v_review date; v_left int; v_fp text; v_ins int := 0; v_res int := 0; v_n int;
BEGIN
  FOR r IN
    SELECT d.id, d.work_item_id, d.deadline_date, d.calculation_meta->>'component' AS comp,
           wi.owner_id, wi.organization_id, wi.title, wi.authority_name, d.anchor_source
      FROM public.work_item_deadlines d
      JOIN public.work_items wi ON wi.id = d.work_item_id
     WHERE d.deadline_type LIKE 'RESPUESTA_PETICION_%'
       AND d.status = 'PENDING' AND d.deadline_date IS NOT NULL
       AND COALESCE(d.deadline_status,'VIGENTE') NOT IN ('SUPERSEDED_BY_EXTENSION','SUPERSEDED_BY_REANCHOR','CUMPLIDO','SUSPENDIDO')
       AND wi.workflow_type::text = 'PETICION' AND wi.deleted_at IS NULL AND wi.lifecycle_state::text = 'ACTIVE'
       AND (p_work_item IS NULL OR d.work_item_id = p_work_item)
  LOOP
    v_review := public.add_business_days_sql(r.deadline_date, 1, 'ADMINISTRATIVO'::public.term_class);
    IF v_review IS NOT NULL AND v_today >= v_review THEN
      v_fp := 'peticion_overdue_' || r.id;
      INSERT INTO public.alert_instances (owner_id, organization_id, entity_id, entity_type, severity, alert_type,
        status, title, message, payload, fingerprint)
      VALUES (r.owner_id, r.organization_id, r.work_item_id, 'WORK_ITEM', 'CRITICAL', 'PETICION_OVERDUE', 'PENDING',
        'Petición vencida sin respuesta de fondo — evaluar tutela: ' || public.peticion_component_label(r.comp),
        COALESCE(r.title, r.authority_name, 'Petición') || ': venció el ' || to_char(r.deadline_date,'DD/MM/YYYY') ||
          ' sin respuesta de fondo registrada. Evaluar acción de tutela o actuación procedente (revisión humana; nada se radica automáticamente).',
        jsonb_build_object('deadline_id', r.id, 'component', r.comp, 'due_date', r.deadline_date,
          'tutela_review_date', v_review, 'action', 'EVALUAR_TUTELA', 'attribution', 'AUTORIDAD_ADMINISTRATIVA',
          'anchor_source', r.anchor_source, 'producer', 'sync_peticion_alerts'),
        v_fp)
      ON CONFLICT (fingerprint) DO NOTHING;
      GET DIAGNOSTICS v_n = ROW_COUNT; v_ins := v_ins + v_n;
      UPDATE public.alert_instances SET status = 'SUPERSEDED', resolved_at = now()
       WHERE fingerprint = 'peticion_deadline_' || r.id AND status NOT IN ('RESOLVED','CANCELLED','DISMISSED','SUPERSEDED');
    ELSE
      v_left := public._peticion_admin_days_left(v_today, r.deadline_date);
      IF v_today <= r.deadline_date AND v_left <= 3 THEN
        INSERT INTO public.alert_instances (owner_id, organization_id, entity_id, entity_type, severity, alert_type,
          status, title, message, payload, fingerprint)
        VALUES (r.owner_id, r.organization_id, r.work_item_id, 'WORK_ITEM', 'WARNING', 'PETICION_DEADLINE', 'PENDING',
          'Petición por vencer: ' || public.peticion_component_label(r.comp),
          COALESCE(r.title, r.authority_name, 'Petición') || ': la autoridad debe responder a más tardar el ' ||
            to_char(r.deadline_date,'DD/MM/YYYY') || '. Si no responde de fondo, evaluar tutela desde el ' || to_char(v_review,'DD/MM/YYYY') || '.',
          jsonb_build_object('deadline_id', r.id, 'component', r.comp, 'due_date', r.deadline_date,
            'tutela_review_date', v_review, 'attribution', 'AUTORIDAD_ADMINISTRATIVA',
            'anchor_source', r.anchor_source, 'producer', 'sync_peticion_alerts'),
          'peticion_deadline_' || r.id)
        ON CONFLICT (fingerprint) DO NOTHING;
        GET DIAGNOSTICS v_n = ROW_COUNT; v_ins := v_ins + v_n;
      END IF;
    END IF;
  END LOOP;

  UPDATE public.alert_instances a
     SET status = 'RESOLVED', resolved_at = now()
   WHERE a.alert_type IN ('PETICION_DEADLINE','PETICION_OVERDUE')
     AND a.status NOT IN ('RESOLVED','CANCELLED','DISMISSED','SUPERSEDED')
     AND (p_work_item IS NULL OR a.entity_id = p_work_item)
     AND a.payload ? 'deadline_id'
     AND NOT EXISTS (
       SELECT 1 FROM public.work_item_deadlines d JOIN public.work_items wi ON wi.id = d.work_item_id
        WHERE d.id = (a.payload->>'deadline_id')::uuid AND d.status = 'PENDING'
          AND COALESCE(d.deadline_status,'VIGENTE') NOT IN ('SUPERSEDED_BY_EXTENSION','SUPERSEDED_BY_REANCHOR','CUMPLIDO','SUSPENDIDO')
          AND wi.deleted_at IS NULL AND wi.lifecycle_state::text = 'ACTIVE');
  GET DIAGNOSTICS v_res = ROW_COUNT;
  RETURN jsonb_build_object('evaluated_on', v_today, 'alerts_inserted', v_ins, 'alerts_resolved', v_res);
END $$;
REVOKE ALL ON FUNCTION public.sync_peticion_alerts(date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_peticion_alerts(date, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_peticion_deadline_alert_resolve()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.deadline_type LIKE 'RESPUESTA_PETICION_%'
     AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.deadline_status IS DISTINCT FROM OLD.deadline_status)
     AND (NEW.status <> 'PENDING' OR COALESCE(NEW.deadline_status,'VIGENTE') IN ('SUPERSEDED_BY_EXTENSION','SUPERSEDED_BY_REANCHOR','CUMPLIDO','SUSPENDIDO')) THEN
    UPDATE public.alert_instances SET status = 'RESOLVED', resolved_at = now()
     WHERE fingerprint IN ('peticion_overdue_' || NEW.id, 'peticion_deadline_' || NEW.id)
       AND status NOT IN ('RESOLVED','CANCELLED','DISMISSED','SUPERSEDED');
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.trg_peticion_deadline_alert_resolve() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_peticion_deadline_alert_resolve ON public.work_item_deadlines;
CREATE TRIGGER trg_peticion_deadline_alert_resolve AFTER UPDATE ON public.work_item_deadlines
  FOR EACH ROW EXECUTE FUNCTION public.trg_peticion_deadline_alert_resolve();

ALTER FUNCTION public.evaluate_peticion_system_events() RENAME TO _evaluate_peticion_system_events_core;
REVOKE ALL ON FUNCTION public._evaluate_peticion_system_events_core() FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.evaluate_peticion_system_events()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN COALESCE(public._evaluate_peticion_system_events_core(), '{}'::jsonb)
         || jsonb_build_object('alerts', public.sync_peticion_alerts(NULL, NULL));
END $$;
REVOKE ALL ON FUNCTION public.evaluate_peticion_system_events() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_peticion_system_events() TO service_role;

CREATE OR REPLACE FUNCTION public.mcp_create_peticion(
  p_title text, p_client_id uuid, p_peticionario text, p_authority_name text, p_authority_reference text,
  p_presented boolean, p_presented_on date, p_channel text, p_source text, p_support text,
  p_components text[], p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prior jsonb; v_created jsonb; v_id uuid; v_reg jsonb; v_status jsonb; v_created_at timestamptz; v_result jsonb;
  v_ref text := NULLIF(btrim(COALESCE(p_authority_reference,'')), '');
BEGIN
  v_prior := public._mcp_begin('create_peticion', p_idempotency_key, jsonb_build_object('t', p_title, 'c', p_client_id,
    'p', p_peticionario, 'a', p_authority_name, 'r', v_ref, 'pr', p_presented, 'd', p_presented_on, 'ch', p_channel,
    's', p_source, 'sup', p_support, 'comp', p_components));
  IF v_prior IS NOT NULL THEN RETURN v_prior; END IF;

  IF COALESCE(p_presented, false) THEN
    IF p_presented_on IS NULL THEN
      RAISE EXCEPTION 'FECHA_PRESENTACION_REQUERIDA: si la petición fue presentada indica la fecha explícita (nunca se infiere de la creación)' USING ERRCODE = 'MCP22';
    END IF;
    IF p_channel IS NULL OR p_channel NOT IN ('EMAIL_OFICIAL','PLATAFORMA','OTRO') THEN
      RAISE EXCEPTION 'CANAL_INVALIDO' USING ERRCODE = 'MCP22'; END IF;
    IF p_components IS NULL OR cardinality(p_components) = 0 THEN
      RAISE EXCEPTION 'COMPONENTES_REQUERIDOS' USING ERRCODE = 'MCP22'; END IF;
  ELSIF p_presented_on IS NOT NULL THEN
    RAISE EXCEPTION 'PRESENTACION_NO_CONFIRMADA: envía presented=true junto con la fecha' USING ERRCODE = 'MCP22';
  END IF;
  IF v_ref IS NOT NULL AND length(v_ref) > 120 THEN RAISE EXCEPTION 'REFERENCIA_DEMASIADO_LARGA' USING ERRCODE = 'MCP22'; END IF;

  v_created := public.mcp_create_work_item('PETICION', NULL, NULL, p_title, p_client_id, p_peticionario,
    p_authority_name, p_authority_name, NULL, 'peticion:' || p_idempotency_key);
  v_id := (v_created->'work_item'->>'id')::uuid;
  IF v_id IS NULL THEN RAISE EXCEPTION 'CREACION_FALLIDA' USING ERRCODE = 'P0001'; END IF;

  IF COALESCE(p_presented, false) THEN
    v_reg := public.peticion_register_presentation(v_id, p_presented_on, p_source,
      btrim(COALESCE(p_support,'')) || ' (canal: ' || p_channel || ')', p_components, NULL, NULL, true, NULL);
    UPDATE public.peticion_work_item_state SET authority_radicado = COALESCE(v_ref, authority_radicado)
     WHERE work_item_id = v_id;
  ELSE
    INSERT INTO public.peticion_work_item_state (work_item_id, organization_id, owner_id, subtype_code,
      authority_name, authority_radicado, attention_status, requires_manual_review)
    SELECT w.id, w.organization_id, w.owner_id, 'GENERAL', w.authority_name, v_ref, 'MANUAL_REVIEW', false
      FROM public.work_items w WHERE w.id = v_id
    ON CONFLICT (work_item_id) DO NOTHING;
    INSERT INTO public.work_item_tasks (owner_id, organization_id, work_item_id, title, description, priority, due_date, template_key)
    SELECT w.owner_id, w.organization_id, w.id, 'Registrar fecha de presentación de la petición',
      'Sin fecha de presentación no se calcula ningún término. Registrar la fecha real de envío o radicación y su soporte.',
      'MEDIA', now(), 'peticion_fecha_pendiente'
      FROM public.work_items w WHERE w.id = v_id;
  END IF;

  SELECT created_at INTO v_created_at FROM public.work_items WHERE id = v_id;
  v_status := public.peticion_status(v_id, NULL);
  v_result := jsonb_build_object('ok', true, 'work_item', v_created->'work_item', 'work_item_id', v_id,
    'created_at', v_created_at,
    'creada', true, 'presentacion_registrada', COALESCE(p_presented, false),
    'recepcion_acreditada', false, 'admitida', false,
    'presented_on', p_presented_on, 'source', p_source, 'channel', p_channel,
    'status', CASE WHEN COALESCE(p_presented, false) THEN v_status->>'status' ELSE 'FECHA_PRESENTACION_PENDIENTE' END,
    'deadlines', COALESCE(v_status->'terms', '[]'::jsonb),
    'monitoring_route', v_status->>'monitoring_route',
    'alert_state', jsonb_build_object('active', COALESCE(v_status->'alerts_active','[]'::jsonb),
       'producer', 'Revisión diaria existente de peticiones: aviso en los 3 días hábiles previos al vencimiento y alerta de tutela el día hábil siguiente'));
  RETURN public._mcp_finish('create_peticion', p_idempotency_key, v_result, 'work_item', v_id, NULL, v_result);
END $$;
REVOKE ALL ON FUNCTION public.mcp_create_peticion(text, uuid, text, text, text, boolean, date, text, text, text, text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_create_peticion(text, uuid, text, text, text, boolean, date, text, text, text, text[], text) TO authenticated, service_role;