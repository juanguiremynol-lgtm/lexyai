-- Manual-review inserts that share a source identity with an audit-held deadline
-- are absorbed as corroborations of the hold instead of creating a second review.
CREATE OR REPLACE FUNCTION public.guard_audit_hold_twin()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_hold uuid;
BEGIN
  IF NEW.status IS DISTINCT FROM 'PENDING' AND NEW.status IS DISTINCT FROM 'REQUIERE_REVISION_MANUAL' THEN
    RETURN NEW;
  END IF;
  v_hold := public.audit_hold_twin_of(NEW.work_item_id, NEW.calculation_meta);
  IF v_hold IS NULL THEN RETURN NEW; END IF;

  IF NEW.status = 'REQUIERE_REVISION_MANUAL' THEN
    UPDATE public.work_item_deadlines h
       SET calculation_meta = jsonb_set(
             COALESCE(h.calculation_meta,'{}'::jsonb), '{corroborations}',
             COALESCE(h.calculation_meta->'corroborations','[]'::jsonb) || jsonb_build_array(jsonb_build_object(
               'at', now(), 'kind', 'AUDIT_HOLD_TWIN_ABSORBED',
               'status', NEW.status, 'trigger_date', NEW.trigger_date,
               'deadline_type', NEW.deadline_type, 'label', NEW.label,
               'meta', COALESCE(NEW.calculation_meta,'{}'::jsonb) - 'corroborations')))
     WHERE h.id = v_hold
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(COALESCE(h.calculation_meta->'corroborations','[]'::jsonb)) c
          WHERE c->>'kind' = 'AUDIT_HOLD_TWIN_ABSORBED'
            AND c->'meta'->>'pub_id' IS NOT DISTINCT FROM NEW.calculation_meta->>'pub_id'
            AND c->'meta'->>'act_id' IS NOT DISTINCT FROM NEW.calculation_meta->>'act_id');
    RETURN NULL;
  END IF;

  NEW.calculation_meta := COALESCE(NEW.calculation_meta, '{}'::jsonb) || jsonb_build_object(
    'requires_manual_review', true,
    'manual_review_reason', 'TERMINO_EN_AUDITORIA:' || v_hold::text,
    'fechas_calculadas_no_validadas', jsonb_build_object(
      'aviso', 'NO VALIDADAS — no son plazo vencido ni activo',
      'deadline_date', NEW.deadline_date, 'business_days_count', NEW.business_days_count));
  NEW.status := 'REQUIERE_REVISION_MANUAL';
  NEW.requires_manual_review := true;
  NEW.deadline_date := NULL;
  NEW.business_days_count := NULL;
  RETURN NEW;
END; $function$;

-- Manual-review branch now records auto_act_id (the resolved CPNU act) so the
-- twin guard can match the publication to the act-derived deadline.
CREATE OR REPLACE FUNCTION public.compute_deadline_for_publicacion(p_pub_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pub RECORD; v_c RECORD; v_r RECORD; v_id UUID; v_a RECORD;
  v_workflow TEXT; v_text TEXT; v_fijacion DATE; v_desfijacion DATE;
  v_auto RECORD;
BEGIN
  SELECT p.id, p.work_item_id, p.title, p.annotation, p.fecha_fijacion, p.fecha_desfijacion, p.is_archived,
         p.source, p.sources, w.workflow_type::TEXT AS wf, w.owner_id, w.organization_id
    INTO v_pub
    FROM public.work_item_publicaciones p JOIN public.work_items w ON w.id = p.work_item_id
    WHERE p.id = p_pub_id;
  IF NOT FOUND OR COALESCE(v_pub.is_archived, false) OR v_pub.fecha_fijacion IS NULL THEN RETURN NULL; END IF;

  IF (v_pub.source = 'samai_estados' OR 'samai_estados' = ANY(COALESCE(v_pub.sources, ARRAY[]::text[])))
     AND COALESCE(
           (SELECT p2.raw_data -> 'fecha_estado_procedencia' ->> 'fuente' FROM public.work_item_publicaciones p2 WHERE p2.id = p_pub_id),
           (SELECT p2.raw_data -> 'raw_data' -> 'fecha_estado_procedencia' ->> 'fuente' FROM public.work_item_publicaciones p2 WHERE p2.id = p_pub_id),
           '') <> 'SAMAI_WESTADOS' THEN
    RETURN NULL;
  END IF;

  SELECT NULL::date AS anchor, NULL::text AS vehicle, NULL::text AS manual_reason INTO v_a;
  SELECT NULL::uuid AS rule_id, NULL::text AS providencia_type, NULL::text AS deadline_type,
         NULL::boolean AS triggers_deadline, NULL::text AS severity INTO v_c;
  v_workflow := v_pub.wf;
  v_fijacion := (v_pub.fecha_fijacion AT TIME ZONE 'America/Bogota')::DATE;
  v_desfijacion := CASE WHEN v_pub.fecha_desfijacion IS NOT NULL THEN (v_pub.fecha_desfijacion AT TIME ZONE 'America/Bogota')::DATE END;

  SELECT * INTO v_auto FROM public.resolve_published_auto(p_pub_id) LIMIT 1;
  v_text := v_auto.auto_text;
  IF v_text IS NOT NULL THEN
    SELECT * INTO v_c FROM public.classify_providencia(v_text, v_workflow) LIMIT 1;
  END IF;

  IF v_text IS NOT NULL AND v_c.rule_id IS NOT NULL AND NOT COALESCE(v_c.triggers_deadline, false) THEN
    RETURN NULL;
  END IF;

  IF v_text IS NOT NULL AND v_c.rule_id IS NOT NULL AND v_c.deadline_type IS NOT NULL AND v_c.deadline_type <> 'REVISION_MANUAL' THEN
    SELECT * INTO v_a FROM public.resolve_publicacion_anchor(v_fijacion, v_desfijacion, v_c.deadline_type, v_text);
  END IF;

  IF v_text IS NULL OR v_c.rule_id IS NULL OR v_c.deadline_type IS NULL
     OR v_c.deadline_type = 'REVISION_MANUAL' OR v_a.anchor IS NULL THEN
    INSERT INTO public.work_item_deadlines (
      owner_id, organization_id, work_item_id, deadline_type, label, description,
      trigger_event, trigger_date, deadline_date, business_days_count, status, requires_manual_review, calculation_meta
    ) VALUES (
      v_pub.owner_id, v_pub.organization_id, v_pub.work_item_id,
      'REVISION_MANUAL', COALESCE(v_c.providencia_type, 'Auto no resoluble desde el estado'),
      LEFT(concat_ws(' ', v_pub.title, v_pub.annotation), 500),
      'ESTADO_NUEVO', v_fijacion, NULL, NULL, 'REQUIERE_REVISION_MANUAL', true,
      jsonb_strip_nulls(jsonb_build_object(
        'anchor_source', 'AUTO_VIA_FIJACION', 'anchor_date', v_fijacion,
        'auto_act_id', v_auto.auto_act_id)) || jsonb_build_object(
        'desfijacion_date', v_desfijacion,
        'auto_resolution', CASE WHEN v_text IS NULL THEN 'UNRESOLVED' ELSE v_auto.auto_source END,
        'requires_manual_review', true,
        'manual_review_reason', CASE
           WHEN v_text IS NULL THEN 'AUTO_NO_RESUELTO_DESDE_ESTADO'
           WHEN v_a.manual_reason IS NOT NULL THEN 'ANCLA:' || v_a.manual_reason
           ELSE 'CLASIFICACION_REQUIERE_LECTURA:' || v_c.providencia_type END,
        'intended_deadline_type', v_c.deadline_type,
        'classification_rule_id', v_c.rule_id,
        'workflow_type', v_workflow, 'pub_id', v_pub.id,
        'classification_text', LEFT(COALESCE(v_text, concat_ws(' ', v_pub.title, v_pub.annotation)), 500))
    )
    ON CONFLICT (work_item_id, deadline_type, trigger_date) DO NOTHING
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  SELECT * INTO v_r FROM public.compute_deadline_from_rule(v_a.anchor, v_workflow, v_c.deadline_type) LIMIT 1;
  IF v_r.rule_id IS NULL THEN RETURN NULL; END IF;

  INSERT INTO public.work_item_deadlines (
    owner_id, organization_id, work_item_id, deadline_type, label, description,
    trigger_event, trigger_date, deadline_date, business_days_count, status, calculation_meta
  ) VALUES (
    v_pub.owner_id, v_pub.organization_id, v_pub.work_item_id,
    v_c.deadline_type, v_c.providencia_type, LEFT(v_text, 500),
    'ESTADO_NUEVO', v_fijacion, v_r.deadline_date,
    CASE WHEN v_r.day_type = 'BUSINESS' THEN v_r.days_amount END,
    CASE WHEN v_r.requires_manual_review OR v_r.deadline_date IS NULL THEN 'REQUIERE_REVISION_MANUAL' ELSE 'PENDING' END,
    jsonb_build_object(
      'anchor_source', 'AUTO_VIA_FIJACION', 'anchor_date', v_fijacion,
      'rule_anchor_date', v_a.anchor, 'vehicle', v_a.vehicle,
      'desfijacion_date', v_desfijacion, 'desfijacion_source', 'METADATA_ONLY',
      'date_confidence', 'high',
      'auto_resolution', v_auto.auto_source, 'auto_act_id', v_auto.auto_act_id,
      'rule_id', v_r.rule_id, 'classification_rule_id', v_c.rule_id,
      'providencia_type', v_c.providencia_type, 'workflow_type', v_workflow,
      'day_type', v_r.day_type, 'days_amount', v_r.days_amount, 'norma', v_r.norma,
      'pub_id', v_pub.id, 'requires_manual_review', v_r.requires_manual_review,
      'classification_text', LEFT(v_text, 500))
  )
  ON CONFLICT (work_item_id, deadline_type, trigger_date) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END; $function$;