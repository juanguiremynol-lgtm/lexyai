-- Phase 2: operative PETICION terms from documented electronic presentation.
-- Preflight: abort on any unexpected prior state of the anchor_source constraint.
DO $pre$
DECLARE v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.peticion_work_item_state'::regclass
     AND conname = 'peticion_work_item_state_anchor_source_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: anchor_source constraint missing';
  END IF;
  IF v_def <> 'CHECK (((anchor_source IS NULL) OR (anchor_source = ANY (ARRAY[''AUTHORITY_RECEIPT''::text, ''SEND_DATE''::text, ''COMPETENT_AUTHORITY_RECEIPT''::text, ''MANUAL''::text]))))'
     AND position('PRESENTACION_DOCUMENTADA' in v_def) = 0 THEN
    RAISE EXCEPTION 'PREFLIGHT: unexpected anchor_source constraint: %', v_def;
  END IF;
  IF position('PRESENTACION_DOCUMENTADA' in v_def) = 0 THEN
    ALTER TABLE public.peticion_work_item_state DROP CONSTRAINT peticion_work_item_state_anchor_source_check;
    ALTER TABLE public.peticion_work_item_state ADD CONSTRAINT peticion_work_item_state_anchor_source_check
      CHECK (anchor_source IS NULL OR anchor_source = ANY (ARRAY['AUTHORITY_RECEIPT','SEND_DATE','COMPETENT_AUTHORITY_RECEIPT','MANUAL','PRESENTACION_DOCUMENTADA']));
  END IF;
END $pre$;

ALTER TABLE public.peticion_work_item_state
  ADD COLUMN IF NOT EXISTS presentation_source text,
  ADD COLUMN IF NOT EXISTS presentation_support text,
  ADD COLUMN IF NOT EXISTS presentation_email_link_id uuid,
  ADD COLUMN IF NOT EXISTS components text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS anchor_version integer NOT NULL DEFAULT 0;

DO $c$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'peticion_state_presentation_source_chk') THEN
    ALTER TABLE public.peticion_work_item_state ADD CONSTRAINT peticion_state_presentation_source_chk
      CHECK (presentation_source IS NULL OR presentation_source IN ('USUARIO_DECLARADO','OUTLOOK','PLATAFORMA'));
  END IF;
END $c$;

CREATE TABLE IF NOT EXISTS public.peticion_anchor_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  owner_id uuid,
  organization_id uuid,
  version integer NOT NULL,
  presented_on date NOT NULL,
  previous_presented_on date,
  source text NOT NULL,
  support text NOT NULL,
  components text[] NOT NULL,
  previous_components text[],
  reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_item_id, version)
);
GRANT SELECT ON public.peticion_anchor_versions TO authenticated;
GRANT ALL ON public.peticion_anchor_versions TO service_role;
ALTER TABLE public.peticion_anchor_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS peticion_anchor_versions_read ON public.peticion_anchor_versions;
CREATE POLICY peticion_anchor_versions_read ON public.peticion_anchor_versions FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR organization_id = public.get_user_organization_id() OR public.is_platform_admin());

-- Component catalog (Ley 1755 de 2015, art. 14). ESPECIAL has no generic term.
CREATE OR REPLACE FUNCTION public.peticion_component_days(p_component text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE p_component
    WHEN 'DOCUMENTOS_INFORMACION' THEN 10
    WHEN 'GENERAL_INTERVENCION' THEN 15
    WHEN 'CONSULTA' THEN 30
    ELSE NULL END
$$;

CREATE OR REPLACE FUNCTION public.peticion_component_label(p_component text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE p_component
    WHEN 'DOCUMENTOS_INFORMACION' THEN 'Documentos e información (10 días hábiles)'
    WHEN 'GENERAL_INTERVENCION' THEN 'Petición general / intervención (15 días hábiles)'
    WHEN 'CONSULTA' THEN 'Consulta jurídica (30 días hábiles)'
    WHEN 'ESPECIAL' THEN 'Régimen especial (revisión manual)'
    ELSE p_component END
$$;

CREATE OR REPLACE FUNCTION public.peticion_component_basis(p_component text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE p_component
    WHEN 'DOCUMENTOS_INFORMACION' THEN 'Ley 1755 de 2015, art. 14 num. 1'
    WHEN 'GENERAL_INTERVENCION' THEN 'Ley 1755 de 2015, art. 14 inc. 1'
    WHEN 'CONSULTA' THEN 'Ley 1755 de 2015, art. 14 num. 2'
    ELSE 'Norma especial pendiente de revisión' END
$$;

-- Live operative deadline of a component (not superseded/cancelled/answered).
CREATE OR REPLACE FUNCTION public._peticion_live_deadline(p_work_item uuid, p_component text)
RETURNS uuid LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT d.id FROM public.work_item_deadlines d
   WHERE d.work_item_id = p_work_item
     AND d.deadline_type = 'RESPUESTA_PETICION_' || p_component
     AND d.status IN ('PENDING','REQUIERE_REVISION_MANUAL','PENDING_REVIEW','HISTORICAL_BACKFILL')
     AND COALESCE(d.deadline_status,'VIGENTE') NOT IN ('SUPERSEDED_BY_EXTENSION','SUPERSEDED_BY_REANCHOR','CUMPLIDO')
   ORDER BY d.created_at DESC LIMIT 1
$$;

-- Insert one component deadline; fails closed if a trigger absorbs it.
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
     'JUEZ', 'PETICION_AUTORIDAD_DECIDE', true, p_due IS NULL,
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

-- Follow-up task per component: due the business day after the term (tutela/review).
CREATE OR REPLACE FUNCTION public._peticion_upsert_task(p_wi public.work_items, p_component text, p_due date, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_key text := 'peticion_tutela_eval:' || p_component; v_review date; v_task uuid;
BEGIN
  IF p_due IS NULL THEN RETURN; END IF;
  v_review := public.add_business_days_sql(p_due, 1, 'ADMINISTRATIVO'::public.term_class);
  IF v_review IS NULL THEN RETURN; END IF;
  SELECT id INTO v_task FROM public.work_item_tasks
   WHERE work_item_id = p_wi.id AND template_key = v_key AND status = 'PENDIENTE' LIMIT 1;
  IF v_task IS NULL THEN
    INSERT INTO public.work_item_tasks (owner_id, organization_id, work_item_id, title, description, priority, due_date, template_key)
    VALUES (p_wi.owner_id, p_wi.organization_id, p_wi.id,
            'Evaluar acción de tutela o revisión — ' || public.peticion_component_label(p_component),
            'Si la autoridad no ha respondido de fondo al vencer el ' || to_char(p_due, 'DD/MM/YYYY') ||
            ', evaluar acción de tutela o la actuación procedente. Revisión humana obligatoria; no se radica nada automáticamente.',
            'ALTA', ((v_review::timestamp + interval '17 hours') AT TIME ZONE 'America/Bogota'), v_key);
  ELSE
    UPDATE public.work_item_tasks
       SET due_date = ((v_review::timestamp + interval '17 hours') AT TIME ZONE 'America/Bogota'),
           description = COALESCE(description, '') || E'\n' || p_note
     WHERE id = v_task;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.peticion_register_presentation(
  p_work_item_id uuid,
  p_presented_on date,
  p_source text,
  p_support text,
  p_components text[],
  p_reason text DEFAULT NULL,
  p_expected_version integer DEFAULT NULL,
  p_create_tasks boolean DEFAULT true,
  p_email_link_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wi public.work_items%ROWTYPE;
  v_state public.peticion_work_item_state%ROWTYPE;
  v_has_state boolean;
  v_today date := (now() AT TIME ZONE 'America/Bogota')::date;
  v_comps text[];
  v_removed text[] := '{}';
  v_changed boolean := false;
  v_version integer;
  v_comp text; v_days integer; v_due date; v_dl uuid;
  v_subtype text;
  v_out jsonb := '[]'::jsonb;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  SELECT * INTO v_wi FROM public.work_items WHERE id = p_work_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ASUNTO_NO_ENCONTRADO' USING ERRCODE = 'P0002'; END IF;
  PERFORM public._assert_owner_direct_write(v_wi.owner_id, true);
  IF v_wi.workflow_type::text <> 'PETICION' THEN RAISE EXCEPTION 'NO_ES_PETICION' USING ERRCODE = '22023'; END IF;
  IF v_wi.deleted_at IS NOT NULL OR v_wi.lifecycle_state::text <> 'ACTIVE' THEN
    RAISE EXCEPTION 'ASUNTO_NO_ACTIVO' USING ERRCODE = '42501';
  END IF;
  IF p_presented_on IS NULL THEN RAISE EXCEPTION 'FECHA_PRESENTACION_REQUERIDA' USING ERRCODE = '22023'; END IF;
  IF p_presented_on > v_today THEN RAISE EXCEPTION 'FECHA_PRESENTACION_FUTURA' USING ERRCODE = '22023'; END IF;
  IF p_presented_on < DATE '2000-01-01' THEN RAISE EXCEPTION 'FECHA_PRESENTACION_INVALIDA' USING ERRCODE = '22023'; END IF;
  IF p_source IS NULL OR p_source NOT IN ('USUARIO_DECLARADO','OUTLOOK','PLATAFORMA') THEN
    RAISE EXCEPTION 'ORIGEN_INVALIDO' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(COALESCE(p_support, '')), '') IS NULL OR length(p_support) > 1000 THEN
    RAISE EXCEPTION 'SOPORTE_REQUERIDO' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT c ORDER BY c), '{}') INTO v_comps FROM unnest(p_components) c;
  IF cardinality(v_comps) = 0 OR EXISTS (
       SELECT 1 FROM unnest(v_comps) c WHERE c NOT IN ('DOCUMENTOS_INFORMACION','GENERAL_INTERVENCION','CONSULTA','ESPECIAL')) THEN
    RAISE EXCEPTION 'COMPONENTES_INVALIDOS' USING ERRCODE = '22023';
  END IF;
  IF p_source = 'OUTLOOK' AND p_email_link_id IS NULL THEN
    RAISE EXCEPTION 'OUTLOOK_REQUIERE_CORREO_VINCULADO' USING ERRCODE = '22023';
  END IF;
  IF p_email_link_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.work_item_email_links l
        WHERE l.id = p_email_link_id AND l.work_item_id = p_work_item_id AND l.link_status = 'CONFIRMED') THEN
    RAISE EXCEPTION 'CORREO_NO_VINCULADO_AL_ASUNTO' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_state FROM public.peticion_work_item_state WHERE work_item_id = p_work_item_id FOR UPDATE;
  v_has_state := FOUND;

  IF v_has_state AND v_state.anchor_source = 'PRESENTACION_DOCUMENTADA' THEN
    v_changed := v_state.sent_at IS DISTINCT FROM p_presented_on;
    SELECT COALESCE(array_agg(c), '{}') INTO v_removed
      FROM unnest(v_state.components) c WHERE NOT (c = ANY (v_comps));
    -- Exact retry: nothing to do, replay current state.
    IF NOT v_changed AND cardinality(v_removed) = 0 AND v_comps <@ v_state.components
       AND v_state.presentation_source IS NOT DISTINCT FROM p_source
       AND v_state.presentation_support IS NOT DISTINCT FROM btrim(p_support)
       AND v_state.presentation_email_link_id IS NOT DISTINCT FROM p_email_link_id THEN
      RETURN jsonb_build_object('ok', true, 'idempotent', true, 'version', v_state.anchor_version,
        'deadlines', public.peticion_terms_summary(p_work_item_id));
    END IF;
    IF p_expected_version IS DISTINCT FROM v_state.anchor_version THEN
      RAISE EXCEPTION 'VERSION_DESACTUALIZADA: actual %', v_state.anchor_version USING ERRCODE = '40001';
    END IF;
    IF (v_changed OR cardinality(v_removed) > 0) AND v_reason IS NULL THEN
      RAISE EXCEPTION 'MOTIVO_REQUERIDO' USING ERRCODE = '22023';
    END IF;
  ELSIF v_has_state AND v_state.anchor_source IS NOT NULL THEN
    -- A receipt-based anchor already exists: replacing it needs a reason and the current version.
    IF v_reason IS NULL THEN RAISE EXCEPTION 'MOTIVO_REQUERIDO' USING ERRCODE = '22023'; END IF;
    IF p_expected_version IS DISTINCT FROM v_state.anchor_version THEN
      RAISE EXCEPTION 'VERSION_DESACTUALIZADA: actual %', v_state.anchor_version USING ERRCODE = '40001';
    END IF;
    v_changed := true;
  END IF;

  v_version := COALESCE(v_state.anchor_version, 0) + 1;

  -- Supersede (never delete) live operative terms affected by the change.
  UPDATE public.work_item_deadlines d
     SET status = 'CANCELLED',
         deadline_status = 'SUPERSEDED_BY_REANCHOR',
         closure_reason = 'Reemplazado por versión ' || v_version || ' de la fecha base: ' || COALESCE(v_reason, 'componente retirado'),
         calculation_meta = COALESCE(d.calculation_meta, '{}'::jsonb) || jsonb_build_object(
           'superseded_at', now(), 'superseded_by_version', v_version)
   WHERE d.work_item_id = p_work_item_id
     AND d.deadline_type LIKE 'RESPUESTA_PETICION_%'
     AND d.status IN ('PENDING','REQUIERE_REVISION_MANUAL','PENDING_REVIEW','HISTORICAL_BACKFILL')
     AND COALESCE(d.deadline_status,'VIGENTE') NOT IN ('SUPERSEDED_BY_EXTENSION','SUPERSEDED_BY_REANCHOR','CUMPLIDO')
     AND (v_changed OR (d.calculation_meta->>'component') = ANY (v_removed));

  v_subtype := CASE
    WHEN v_comps = ARRAY['DOCUMENTOS_INFORMACION'] THEN 'DOCUMENTOS_INFORMACION'
    WHEN v_comps = ARRAY['CONSULTA'] THEN 'CONSULTA'
    ELSE 'GENERAL' END;

  IF v_has_state THEN
    UPDATE public.peticion_work_item_state
       SET subtype_code = CASE WHEN subtype_code = 'NORMA_ESPECIAL' THEN subtype_code ELSE v_subtype END,
           sent_at = p_presented_on,
           anchor_source = 'PRESENTACION_DOCUMENTADA',
           anchor_provenance_note = 'Cálculo operativo desde presentación documentada: ' || btrim(p_support),
           presentation_source = p_source,
           presentation_support = btrim(p_support),
           presentation_email_link_id = p_email_link_id,
           components = v_comps,
           anchor_version = v_version,
           deadline_status = 'VIGENTE',
           attention_status = 'MONITORING',
           requires_manual_review = ('ESPECIAL' = ANY (v_comps)) OR requires_manual_review
     WHERE work_item_id = p_work_item_id;
  ELSE
    INSERT INTO public.peticion_work_item_state
      (work_item_id, organization_id, owner_id, subtype_code, sent_at, anchor_source, anchor_provenance_note,
       presentation_source, presentation_support, presentation_email_link_id, components, anchor_version,
       authority_name, deadline_status, attention_status, requires_manual_review)
    VALUES (p_work_item_id, v_wi.organization_id, v_wi.owner_id, v_subtype, p_presented_on, 'PRESENTACION_DOCUMENTADA',
       'Cálculo operativo desde presentación documentada: ' || btrim(p_support),
       p_source, btrim(p_support), p_email_link_id, v_comps, v_version,
       v_wi.authority_name, 'VIGENTE', 'MONITORING', 'ESPECIAL' = ANY (v_comps));
  END IF;

  INSERT INTO public.peticion_anchor_versions
    (work_item_id, owner_id, organization_id, version, presented_on, previous_presented_on, source, support,
     components, previous_components, reason, created_by)
  VALUES (p_work_item_id, v_wi.owner_id, v_wi.organization_id, v_version, p_presented_on,
          CASE WHEN v_has_state THEN v_state.sent_at END, p_source, btrim(p_support),
          v_comps, CASE WHEN v_has_state THEN v_state.components END, v_reason, auth.uid());

  FOREACH v_comp IN ARRAY v_comps LOOP
    IF public._peticion_live_deadline(p_work_item_id, v_comp) IS NOT NULL THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.work_item_deadlines d
                WHERE d.work_item_id = p_work_item_id AND d.deadline_type = 'RESPUESTA_PETICION_' || v_comp
                  AND d.status = 'MET' AND NOT v_changed) THEN
      CONTINUE; -- already answered on the same base date
    END IF;
    v_days := public.peticion_component_days(v_comp);
    v_due := CASE WHEN v_days IS NULL THEN NULL
                  ELSE public.add_business_days_sql(p_presented_on, v_days, 'ADMINISTRATIVO'::public.term_class) END;
    v_dl := public._peticion_insert_component_deadline(v_wi, v_comp, p_presented_on, v_days,
              'PRESENTACION_DOCUMENTADA', p_presented_on, v_due, v_version, NULL, '{}'::jsonb);
    INSERT INTO public.peticion_events (work_item_id, organization_id, owner_id, event_code, event_date, source, deadline_id, notes, metadata, created_by)
    VALUES (p_work_item_id, v_wi.organization_id, v_wi.owner_id, 'TERMINO_OPERATIVO_GENERADO', v_today,
            CASE WHEN auth.uid() IS NULL THEN 'SYSTEM' ELSE 'USER' END, v_dl,
            CASE WHEN v_due IS NULL THEN public.peticion_component_label(v_comp) || ': requiere revisión manual (sin fecha calculada).'
                 ELSE public.peticion_component_label(v_comp) || ': vence ' || to_char(v_due, 'DD/MM/YYYY') ||
                      '. Cálculo operativo desde la presentación del ' || to_char(p_presented_on, 'DD/MM/YYYY') || '.' END,
            jsonb_build_object('component', v_comp, 'days', v_days, 'deadline_date', v_due, 'anchor_version', v_version),
            auth.uid())
    ON CONFLICT DO NOTHING;
    IF p_create_tasks THEN
      PERFORM public._peticion_upsert_task(v_wi, v_comp, v_due, 'Fecha actualizada por versión ' || v_version || ' de la fecha base.');
    END IF;
  END LOOP;

  INSERT INTO public.peticion_events (work_item_id, organization_id, owner_id, event_code, event_date, source, notes, metadata, created_by)
  VALUES (p_work_item_id, v_wi.organization_id, v_wi.owner_id,
          CASE WHEN v_version = 1 OR NOT v_has_state OR v_state.anchor_source IS NULL THEN 'PRESENTACION_REGISTRADA' ELSE 'FECHA_BASE_CORREGIDA' END,
          p_presented_on, CASE WHEN auth.uid() IS NULL THEN 'SYSTEM' ELSE 'USER' END,
          'Presentación documentada (' || p_source || '): ' || btrim(p_support) ||
          '. La recepción por la autoridad no queda acreditada por este registro.' ||
          COALESCE(' Motivo: ' || v_reason, ''),
          jsonb_build_object('version', v_version, 'components', v_comps,
                             'previous', CASE WHEN v_has_state THEN jsonb_build_object('sent_at', v_state.sent_at, 'components', v_state.components, 'version', v_state.anchor_version) END),
          auth.uid())
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'idempotent', false, 'version', v_version,
    'deadlines', public.peticion_terms_summary(p_work_item_id));
END $$;

CREATE OR REPLACE FUNCTION public.peticion_terms_summary(p_work_item_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'deadline_id', d.id, 'component', d.calculation_meta->>'component',
      'status', d.status, 'deadline_status', d.deadline_status,
      'deadline_date', d.deadline_date, 'days', d.business_days_count,
      'trigger_event', d.trigger_event, 'trigger_date', d.trigger_date,
      'audit', d.calculation_meta->'admin_term_audit',
      'extension_validity', d.extension_validity,
      'closure_reason', d.closure_reason, 'supersedes', d.supersedes_deadline_id,
      'created_at', d.created_at) ORDER BY d.created_at), '[]'::jsonb)
  FROM public.work_item_deadlines d
  WHERE d.work_item_id = p_work_item_id AND d.deadline_type LIKE 'RESPUESTA_PETICION_%'
    AND d.calculation_meta ? 'admin_term_audit'
$$;

-- Extension (art. 14 par.): only after human review; communicated before expiry,
-- motivated, and within twice the original term. Invalid ones are recorded, never applied.
CREATE OR REPLACE FUNCTION public.peticion_register_extension(
  p_deadline_id uuid, p_communicated_on date, p_new_due date, p_motivation text, p_reviewed boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_d public.work_item_deadlines%ROWTYPE; v_wi public.work_items%ROWTYPE;
  v_validity text; v_cap date; v_orig_anchor date; v_orig_days int; v_new uuid; v_comp text;
  v_today date := (now() AT TIME ZONE 'America/Bogota')::date;
BEGIN
  SELECT * INTO v_d FROM public.work_item_deadlines WHERE id = p_deadline_id FOR UPDATE;
  IF NOT FOUND OR v_d.deadline_type NOT LIKE 'RESPUESTA_PETICION_%' OR NOT (v_d.calculation_meta ? 'admin_term_audit') THEN
    RAISE EXCEPTION 'TERMINO_NO_ENCONTRADO' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_wi FROM public.work_items WHERE id = v_d.work_item_id FOR UPDATE;
  PERFORM public._assert_owner_direct_write(v_wi.owner_id, true);
  IF v_wi.deleted_at IS NOT NULL OR v_wi.lifecycle_state::text <> 'ACTIVE' THEN RAISE EXCEPTION 'ASUNTO_NO_ACTIVO' USING ERRCODE = '42501'; END IF;
  v_comp := v_d.calculation_meta->>'component';
  -- Idempotent replay: an applied extension with the same date already supersedes this term.
  SELECT id INTO v_new FROM public.work_item_deadlines
   WHERE supersedes_deadline_id = p_deadline_id AND trigger_event = 'PRORROGA_COMUNICADA' AND deadline_date = p_new_due LIMIT 1;
  IF v_new IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'validity', 'VALID', 'deadline_id', v_new);
  END IF;
  IF v_d.status NOT IN ('PENDING','REQUIERE_REVISION_MANUAL') OR v_d.deadline_date IS NULL
     OR COALESCE(v_d.deadline_status,'VIGENTE') IN ('SUPERSEDED_BY_EXTENSION','SUPERSEDED_BY_REANCHOR','CUMPLIDO') THEN
    RAISE EXCEPTION 'TERMINO_NO_VIGENTE' USING ERRCODE = '22023';
  END IF;
  IF p_communicated_on IS NULL OR p_communicated_on > v_today THEN RAISE EXCEPTION 'FECHA_COMUNICACION_INVALIDA' USING ERRCODE = '22023'; END IF;
  v_orig_anchor := COALESCE(NULLIF(v_d.calculation_meta->>'original_anchor','')::date, v_d.trigger_date);
  v_orig_days := COALESCE(NULLIF(v_d.calculation_meta->>'original_days','')::int, v_d.business_days_count);
  v_cap := public.add_business_days_sql(v_orig_anchor, 2 * v_orig_days, 'ADMINISTRATIVO'::public.term_class);

  v_validity := CASE
    WHEN NOT COALESCE(p_reviewed, false) THEN 'MANUAL_REVIEW'
    WHEN NULLIF(btrim(COALESCE(p_motivation,'')),'') IS NULL THEN 'INCOMPLETE'
    WHEN p_new_due IS NULL OR p_new_due <= v_d.deadline_date THEN 'INCOMPLETE'
    WHEN p_communicated_on > v_d.deadline_date THEN 'LATE'
    WHEN v_cap IS NULL OR p_new_due > v_cap THEN 'EXCEEDS_CAP'
    ELSE 'VALID' END;

  INSERT INTO public.peticion_events (work_item_id, organization_id, owner_id, event_code, event_date, source, deadline_id, notes, metadata, created_by)
  VALUES (v_wi.id, v_wi.organization_id, v_wi.owner_id, 'PRORROGA_COMUNICADA', p_communicated_on, 'USER', p_deadline_id,
          CASE v_validity WHEN 'VALID' THEN 'Prórroga revisada y aplicada; el plazo original se conserva en el historial.'
            ELSE 'Prórroga registrada SIN efecto sobre el plazo (' || v_validity || ').' END,
          jsonb_build_object('validity', v_validity, 'new_due', p_new_due, 'cap', v_cap,
                             'original_due', v_d.deadline_date, 'motivation', left(p_motivation, 2000)),
          auth.uid())
  ON CONFLICT DO NOTHING;

  IF v_validity <> 'VALID' THEN
    RETURN jsonb_build_object('ok', true, 'applied', false, 'validity', v_validity, 'cap', v_cap);
  END IF;

  UPDATE public.work_item_deadlines
     SET status = 'CANCELLED', deadline_status = 'SUPERSEDED_BY_EXTENSION', extension_validity = 'VALID',
         closure_reason = 'Prórroga comunicada el ' || to_char(p_communicated_on,'DD/MM/YYYY') || ' hasta ' || to_char(p_new_due,'DD/MM/YYYY')
   WHERE id = p_deadline_id;
  v_new := public._peticion_insert_component_deadline(v_wi, v_comp, v_orig_anchor, v_orig_days,
             'PRORROGA_COMUNICADA', p_communicated_on, p_new_due,
             COALESCE((v_d.calculation_meta->>'anchor_version')::int, 1), p_deadline_id,
             jsonb_build_object('original_anchor', v_orig_anchor, 'original_days', v_orig_days,
                                'extension', jsonb_build_object('communicated_on', p_communicated_on, 'cap', v_cap,
                                                                'previous_due', v_d.deadline_date)));
  UPDATE public.work_item_deadlines SET extension_validity = 'VALID' WHERE id = v_new;
  PERFORM public._peticion_upsert_task(v_wi, v_comp, p_new_due, 'Fecha actualizada por prórroga válida.');
  RETURN jsonb_build_object('ok', true, 'applied', true, 'validity', 'VALID', 'deadline_id', v_new, 'cap', v_cap);
END $$;

-- Response per component. A partial answer never closes; a full answer closes only its component.
CREATE OR REPLACE FUNCTION public.peticion_register_response(
  p_deadline_id uuid, p_kind text, p_received_on date, p_notes text, p_reviewed boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_d public.work_item_deadlines%ROWTYPE; v_wi public.work_items%ROWTYPE; v_comp text; v_open int;
  v_today date := (now() AT TIME ZONE 'America/Bogota')::date;
BEGIN
  SELECT * INTO v_d FROM public.work_item_deadlines WHERE id = p_deadline_id FOR UPDATE;
  IF NOT FOUND OR v_d.deadline_type NOT LIKE 'RESPUESTA_PETICION_%' OR NOT (v_d.calculation_meta ? 'admin_term_audit') THEN
    RAISE EXCEPTION 'TERMINO_NO_ENCONTRADO' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_wi FROM public.work_items WHERE id = v_d.work_item_id FOR UPDATE;
  PERFORM public._assert_owner_direct_write(v_wi.owner_id, true);
  IF v_wi.deleted_at IS NOT NULL OR v_wi.lifecycle_state::text <> 'ACTIVE' THEN RAISE EXCEPTION 'ASUNTO_NO_ACTIVO' USING ERRCODE = '42501'; END IF;
  IF p_kind NOT IN ('PARCIAL','DE_FONDO') THEN RAISE EXCEPTION 'TIPO_RESPUESTA_INVALIDO' USING ERRCODE = '22023'; END IF;
  IF p_received_on IS NULL OR p_received_on > v_today THEN RAISE EXCEPTION 'FECHA_RESPUESTA_INVALIDA' USING ERRCODE = '22023'; END IF;
  IF p_kind = 'DE_FONDO' AND NOT COALESCE(p_reviewed, false) THEN RAISE EXCEPTION 'REVISION_JURIDICA_REQUERIDA' USING ERRCODE = '22023'; END IF;
  v_comp := v_d.calculation_meta->>'component';

  IF p_kind = 'DE_FONDO' AND v_d.status = 'MET' THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true);
  END IF;

  INSERT INTO public.peticion_events (work_item_id, organization_id, owner_id, event_code, event_date, source, deadline_id, notes, metadata, created_by)
  VALUES (v_wi.id, v_wi.organization_id, v_wi.owner_id,
          CASE p_kind WHEN 'PARCIAL' THEN 'RESPUESTA_PARCIAL' ELSE 'RESPUESTA_DE_FONDO' END,
          p_received_on, 'USER', p_deadline_id, left(NULLIF(btrim(COALESCE(p_notes,'')),''), 2000),
          jsonb_build_object('component', v_comp, 'reviewed', COALESCE(p_reviewed,false)), auth.uid())
  ON CONFLICT DO NOTHING;

  IF p_kind = 'PARCIAL' THEN
    RETURN jsonb_build_object('ok', true, 'closed', false);
  END IF;

  UPDATE public.work_item_deadlines
     SET status = 'MET', met_at = now(), deadline_status = 'CUMPLIDO',
         closure_reason = 'Respuesta de fondo revisada, recibida el ' || to_char(p_received_on,'DD/MM/YYYY')
   WHERE id = p_deadline_id;
  UPDATE public.work_item_tasks SET status = 'COMPLETADA', completed_at = now(), completed_by = auth.uid()
   WHERE work_item_id = v_wi.id AND template_key = 'peticion_tutela_eval:' || v_comp AND status = 'PENDIENTE';

  SELECT count(*) INTO v_open FROM unnest((SELECT components FROM public.peticion_work_item_state WHERE work_item_id = v_wi.id)) c
   WHERE public._peticion_live_deadline(v_wi.id, c) IS NOT NULL;
  IF v_open = 0 THEN
    UPDATE public.peticion_work_item_state SET deadline_status = 'CUMPLIDO', attention_status = 'NONE' WHERE work_item_id = v_wi.id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'closed', true, 'open_components', v_open);
END $$;

REVOKE ALL ON FUNCTION public.peticion_register_presentation(uuid, date, text, text, text[], text, integer, boolean, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.peticion_register_extension(uuid, date, date, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.peticion_register_response(uuid, text, date, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._peticion_insert_component_deadline(public.work_items, text, date, integer, text, date, date, integer, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._peticion_upsert_task(public.work_items, text, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.peticion_register_presentation(uuid, date, text, text, text[], text, integer, boolean, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.peticion_register_extension(uuid, date, date, text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.peticion_register_response(uuid, text, date, text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.peticion_terms_summary(uuid) TO authenticated, service_role;

-- Administrative terms carry their own calendar audit; the judicial walk (with vacancia) must not overwrite it.
CREATE OR REPLACE FUNCTION public.stamp_deadline_term_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_src text; v_daytype text; v_norma text; v_days int; v_anchor date; v_audit jsonb; v_kind text;
BEGIN
  IF NEW.term_class = 'ADMINISTRATIVO' AND NEW.calculation_meta ? 'admin_term_audit' THEN
    RETURN NEW;
  END IF;
  v_src := COALESCE(NEW.calculation_meta->>'anchor_source', NEW.trigger_event);
  v_daytype := NEW.calculation_meta->>'day_type';
  v_norma := NEW.calculation_meta->>'norma';
  v_days := COALESCE((NEW.calculation_meta->>'days_amount')::int, NEW.business_days_count);
  v_kind := 'DEADLINE_RULES';

  IF v_days IS NULL THEN
    SELECT r.days_amount, r.day_type, r.citation, 'WORKFLOW_DEADLINE_RULES'
      INTO v_days, v_daytype, v_norma, v_kind
      FROM public.workflow_deadline_rules r
     WHERE r.deadline_type = NEW.deadline_type
       AND r.status = 'RATIFIED'
       AND (NEW.calculation_meta->>'workflow_type' IS NULL OR r.workflow_type = NEW.calculation_meta->>'workflow_type')
     LIMIT 1;
  END IF;
  IF v_days IS NULL THEN
    SELECT r.days_amount, r.day_type, r.norma, 'DEADLINE_RULES'
      INTO v_days, v_daytype, v_norma, v_kind
      FROM public.deadline_rules r
     WHERE r.deadline_type = NEW.deadline_type
       AND r.is_active
       AND (NEW.calculation_meta->>'workflow_type' IS NULL OR r.workflow_type = NEW.calculation_meta->>'workflow_type')
     LIMIT 1;
  END IF;

  v_anchor := COALESCE(
    NULLIF(NEW.calculation_meta->>'desfijacion_date','')::date,
    NULLIF(NEW.calculation_meta->>'rule_anchor_date','')::date,
    NULLIF(NEW.calculation_meta->>'anchor_date','')::date,
    NEW.trigger_date);

  IF v_days IS NOT NULL AND COALESCE(v_daytype,'BUSINESS') = 'BUSINESS' AND NEW.business_days_count IS NULL THEN
    NEW.business_days_count := v_days;
  END IF;

  v_audit := public.build_term_audit(v_anchor, v_days, v_daytype, v_src, v_norma, v_kind);
  IF v_daytype IS NOT NULL THEN
    v_audit := v_audit || jsonb_build_object('day_type', v_daytype);
  END IF;
  IF v_days IS NOT NULL THEN
    v_audit := v_audit || jsonb_build_object('days_amount', v_days);
  END IF;

  NEW.calculation_meta := COALESCE(NEW.calculation_meta,'{}'::jsonb) || v_audit || jsonb_build_object(
    'recomputed_date', NULLIF(v_audit->'term_audit'->>'result_date','')::date,
    'matches_stored_date', CASE
      WHEN v_audit->'term_audit'->>'result_date' IS NULL OR NEW.deadline_date IS NULL THEN NULL
      ELSE ((v_audit->'term_audit'->>'result_date')::date = NEW.deadline_date) END);
  RETURN NEW;
END; $function$;

-- Per-component evaluation. Operative (presentation-based) anchors never configure
-- legal silence effects automatically: they are flagged for human review instead.
CREATE OR REPLACE FUNCTION public.evaluate_peticion_system_events()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  v_expired int := 0; v_deemed int := 0; v_silence int := 0; v_manual int := 0; v_tutela int := 0;
  v_anchor date; v_silence_date date; v_special_months numeric; v_delivery_due date; v_new_deadline uuid;
  v_comp text; v_operative boolean; v_review date;
BEGIN
  -- 1. Statutory expiry, one pass per live response deadline (each component separately).
  FOR r IN
    SELECT s.id AS state_id, s.work_item_id, s.subtype_code, wi.organization_id AS wi_org, wi.owner_id AS wi_owner,
           d.id AS deadline_id, d.deadline_date, d.calculation_meta, d.anchor_source AS d_anchor_source
    FROM public.peticion_work_item_state s
    JOIN public.work_items wi ON wi.id = s.work_item_id
    JOIN public.work_item_deadlines d ON d.work_item_id = s.work_item_id
     AND d.deadline_type LIKE 'RESPUESTA_PETICION%'
     AND d.status NOT IN ('MET','CANCELLED','DISMISSED','FULFILLED')
     AND COALESCE(d.deadline_status,'VIGENTE') NOT IN ('SUPERSEDED_BY_EXTENSION','SUPERSEDED_BY_REANCHOR','CUMPLIDO','SUSPENDIDO')
    WHERE wi.deleted_at IS NULL
      AND wi.workflow_type::text = 'PETICION'
      AND d.deadline_date IS NOT NULL
      AND d.deadline_date < CURRENT_DATE
      AND NOT EXISTS (SELECT 1 FROM public.peticion_events e
                       WHERE e.work_item_id = s.work_item_id AND e.event_code = 'RESPONSE_TERM_EXPIRED' AND e.deadline_id = d.id)
  LOOP
    v_comp := COALESCE(r.calculation_meta->>'component',
                       CASE WHEN r.subtype_code = 'DOCUMENTOS_INFORMACION' THEN 'DOCUMENTOS_INFORMACION' END);
    v_operative := r.d_anchor_source = 'PRESENTACION_DOCUMENTADA';

    INSERT INTO public.peticion_events
      (work_item_id, organization_id, owner_id, event_code, event_date, source, deadline_id, notes)
    VALUES (r.work_item_id, r.wi_org, r.wi_owner, 'RESPONSE_TERM_EXPIRED', r.deadline_date, 'SYSTEM', r.deadline_id,
            'Vencimiento del término legal de respuesta (Ley 1755 de 2015, art. 14)' ||
            COALESCE(' — ' || public.peticion_component_label(r.calculation_meta->>'component'), '') ||
            '. La etapa procedimental no cambia y los demás componentes siguen su propio término.');
    UPDATE public.work_item_deadlines SET deadline_status = 'OVERDUE' WHERE id = r.deadline_id;
    UPDATE public.peticion_work_item_state SET deadline_status = 'OVERDUE', attention_status = 'ACTION_REQUIRED' WHERE id = r.state_id;
    v_expired := v_expired + 1;

    v_review := public.add_business_days_sql(r.deadline_date, 1, 'ADMINISTRATIVO'::public.term_class);
    IF v_review IS NOT NULL THEN
      INSERT INTO public.peticion_events
        (work_item_id, organization_id, owner_id, event_code, event_date, source, deadline_id, notes, metadata)
      VALUES (r.work_item_id, r.wi_org, r.wi_owner, 'TUTELA_EVALUACION_SUGERIDA', v_review, 'SYSTEM', r.deadline_id,
              'Sin respuesta de fondo registrada: evaluar acción de tutela o actuación procedente. Requiere revisión humana.',
              jsonb_build_object('requires_human_review', true))
      ON CONFLICT DO NOTHING;
      v_tutela := v_tutela + 1;
    END IF;

    IF v_comp = 'DOCUMENTOS_INFORMACION' THEN
      IF v_operative THEN
        -- Deemed acceptance depends on actual receipt: never configured from an operative anchor.
        INSERT INTO public.peticion_events
          (work_item_id, organization_id, owner_id, event_code, event_date, source, deadline_id, notes, metadata)
        VALUES (r.work_item_id, r.wi_org, r.wi_owner, 'ACEPTACION_FICTA_POR_REVISAR', r.deadline_date, 'SYSTEM', r.deadline_id,
                'Ley 1755 de 2015, art. 14 num. 1 — posible aceptación de la solicitud de documentos y entrega en 3 días hábiles. ' ||
                'Verificar recepción y presupuestos antes de invocarla.', jsonb_build_object('requires_human_review', true))
        ON CONFLICT DO NOTHING;
        UPDATE public.peticion_work_item_state SET requires_manual_review = true WHERE id = r.state_id;
        v_manual := v_manual + 1;
      ELSE
        v_delivery_due := public.add_business_days_sql(r.deadline_date, 3, 'ADMINISTRATIVO'::public.term_class);
        INSERT INTO public.peticion_events
          (work_item_id, organization_id, owner_id, event_code, event_date, source, deadline_id, legal_effect, notes)
        VALUES (r.work_item_id, r.wi_org, r.wi_owner, 'REQUEST_DEEMED_ACCEPTED', r.deadline_date, 'SYSTEM', r.deadline_id,
                'REQUEST_DEEMED_ACCEPTED',
                'Ley 1755 de 2015, art. 14 num. 1 — vencido el término sin respuesta, la petición se entiende aceptada.')
        ON CONFLICT DO NOTHING;
        IF v_delivery_due IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM public.work_item_deadlines wd
          WHERE wd.work_item_id = r.work_item_id AND wd.deadline_type = 'ENTREGA_COPIAS_ACEPTACION_FICTA'
            AND wd.supersedes_deadline_id = r.deadline_id)
        THEN
          INSERT INTO public.work_item_deadlines
            (work_item_id, organization_id, owner_id, deadline_type, label, description,
             trigger_event, trigger_date, deadline_date, business_days_count, status,
             term_class, anchor_kind, anchor_source, supersedes_deadline_id, deadline_status, legal_effect)
          VALUES (r.work_item_id, r.wi_org, r.wi_owner, 'ENTREGA_COPIAS_ACEPTACION_FICTA',
                  'Entrega de copias por aceptación ficta',
                  'Ley 1755 de 2015, art. 14 num. 1 — 3 días hábiles contados desde el vencimiento del término de 10 días.',
                  'REQUEST_DEEMED_ACCEPTED', r.deadline_date, v_delivery_due, 3, 'PENDING',
                  'ADMINISTRATIVO', 'STATUTORY_TERM_EXPIRY', 'DERIVED_FROM_DEEMED_ACCEPTANCE',
                  r.deadline_id, 'VIGENTE', 'REQUEST_DEEMED_ACCEPTED')
          RETURNING id INTO v_new_deadline;
          IF v_new_deadline IS NOT NULL THEN
            INSERT INTO public.peticion_events
              (work_item_id, organization_id, owner_id, event_code, event_date, source, deadline_id, notes)
            VALUES (r.work_item_id, r.wi_org, r.wi_owner, 'DOCUMENT_DELIVERY_DUE', v_delivery_due, 'SYSTEM', v_new_deadline,
                    'Término derivado de 3 días hábiles anclado al vencimiento del término legal.')
            ON CONFLICT DO NOTHING;
            UPDATE public.peticion_work_item_state SET legal_effect = 'REQUEST_DEEMED_ACCEPTED' WHERE id = r.state_id;
            v_deemed := v_deemed + 1;
          END IF;
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- 2. Negative silence (CPACA art. 83) per petition, only for non-documents scope.
  FOR r IN
    SELECT s.*, wi.organization_id AS wi_org, wi.owner_id AS wi_owner,
           (SELECT max(d.deadline_date) FROM public.work_item_deadlines d
             WHERE d.work_item_id = s.work_item_id AND d.deadline_type LIKE 'RESPUESTA_PETICION%'
               AND COALESCE(d.deadline_status,'VIGENTE') NOT IN ('SUPERSEDED_BY_EXTENSION','SUPERSEDED_BY_REANCHOR')) AS last_due
    FROM public.peticion_work_item_state s
    JOIN public.work_items wi ON wi.id = s.work_item_id
    WHERE wi.deleted_at IS NULL AND wi.workflow_type::text = 'PETICION'
  LOOP
    v_anchor := COALESCE(r.competent_authority_received_at, r.authority_received_at, r.sent_at);
    CONTINUE WHEN v_anchor IS NULL;
    CONTINUE WHEN r.subtype_code = 'DOCUMENTOS_INFORMACION';
    CONTINUE WHEN cardinality(r.components) > 0
      AND NOT (r.components && ARRAY['GENERAL_INTERVENCION','CONSULTA','ESPECIAL']);
    IF r.silence_effect IN ('POSITIVE_SPECIAL','NONE') THEN
      CONTINUE;
    ELSIF r.silence_effect = 'MANUAL_REVIEW' THEN
      UPDATE public.peticion_work_item_state SET requires_manual_review = true WHERE id = r.id AND requires_manual_review = false;
      v_manual := v_manual + 1;
      CONTINUE;
    END IF;

    v_special_months := NULL;
    IF r.subtype_code = 'NORMA_ESPECIAL' AND r.special_term_value IS NOT NULL THEN
      v_special_months := CASE r.special_term_unit
        WHEN 'MONTHS' THEN r.special_term_value
        WHEN 'CALENDAR_DAYS' THEN r.special_term_value / 30.0
        ELSE r.special_term_value / 20.0 END;
    END IF;
    IF v_special_months IS NOT NULL AND v_special_months > 3 THEN
      v_silence_date := (COALESCE(r.last_due, v_anchor) + interval '1 month')::date;
    ELSE
      v_silence_date := (v_anchor + interval '3 months')::date;
    END IF;
    CONTINUE WHEN CURRENT_DATE < v_silence_date;

    IF r.anchor_source = 'PRESENTACION_DOCUMENTADA' AND r.authority_received_at IS NULL
       AND r.competent_authority_received_at IS NULL THEN
      -- Operative anchor only: flag for review, never configure the ficto act automatically.
      UPDATE public.peticion_work_item_state SET requires_manual_review = true WHERE id = r.id AND requires_manual_review = false;
      INSERT INTO public.peticion_events (work_item_id, organization_id, owner_id, event_code, event_date, source, notes, metadata)
      SELECT r.work_item_id, r.wi_org, r.wi_owner, 'SILENCIO_NEGATIVO_POR_REVISAR', v_silence_date, 'SYSTEM',
              'Ley 1437 de 2011, art. 83 — posible silencio negativo. Verificar recepción efectiva antes de invocarlo.',
              jsonb_build_object('requires_human_review', true)
      WHERE NOT EXISTS (SELECT 1 FROM public.peticion_events e
                         WHERE e.work_item_id = r.work_item_id AND e.event_code = 'SILENCIO_NEGATIVO_POR_REVISAR');
      v_manual := v_manual + 1;
      CONTINUE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.peticion_events e
                    WHERE e.work_item_id = r.work_item_id AND e.event_code = 'SILENCIO_NEGATIVO_CONFIGURADO') THEN
      INSERT INTO public.peticion_events
        (work_item_id, organization_id, owner_id, event_code, event_date, source, legal_effect, notes)
      VALUES (r.work_item_id, r.wi_org, r.wi_owner, 'SILENCIO_NEGATIVO_CONFIGURADO', v_silence_date, 'SYSTEM', 'SILENCIO_NEGATIVO',
              'Ley 1437 de 2011, art. 83 — existe acto ficto demandable. El silencio no exonera a la autoridad del deber de decidir.');
      UPDATE public.peticion_work_item_state SET legal_effect = 'SILENCIO_NEGATIVO', attention_status = 'ACTION_REQUIRED' WHERE id = r.id;
      v_silence := v_silence + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('term_expired', v_expired, 'deemed_accepted', v_deemed, 'silence_events', v_silence,
                            'manual_review', v_manual, 'tutela_review_events', v_tutela, 'evaluated_at', now());
END; $function$;