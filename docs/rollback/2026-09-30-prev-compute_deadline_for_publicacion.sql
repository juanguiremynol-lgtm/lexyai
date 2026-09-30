CREATE OR REPLACE FUNCTION public.compute_deadline_for_publicacion(p_pub_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pub RECORD; v_c RECORD; v_r RECORD; v_id UUID;
  v_workflow TEXT; v_text TEXT; v_fijacion DATE; v_desfijacion DATE; v_derived BOOLEAN;
  v_auto RECORD;
BEGIN
  SELECT p.id, p.work_item_id, p.title, p.annotation, p.fecha_fijacion, p.fecha_desfijacion, p.is_archived,
         p.source, p.sources, w.workflow_type::TEXT AS wf, w.owner_id, w.organization_id
    INTO v_pub
    FROM public.work_item_publicaciones p
    JOIN public.work_items w ON w.id = p.work_item_id
    WHERE p.id = p_pub_id;

  IF NOT FOUND OR COALESCE(v_pub.is_archived, false) OR v_pub.fecha_fijacion IS NULL THEN
    RETURN NULL;
  END IF;

  -- SAMAI Estados rows are skipped unless their fijación carries GCP's
  -- SAMAI_WESTADOS capture provenance (the six checks run at write time in
  -- enforce_samai_estados_no_fijacion; a row without them has no fijación).
  IF (v_pub.source = 'samai_estados'
      OR 'samai_estados' = ANY(COALESCE(v_pub.sources, ARRAY[]::text[])))
     AND COALESCE(
           (SELECT p2.raw_data -> 'fecha_estado_procedencia' ->> 'fuente'
              FROM public.work_item_publicaciones p2 WHERE p2.id = p_pub_id),
           (SELECT p2.raw_data -> 'raw_data' -> 'fecha_estado_procedencia' ->> 'fuente'
              FROM public.work_item_publicaciones p2 WHERE p2.id = p_pub_id),
           '') <> 'SAMAI_WESTADOS' THEN
    RETURN NULL;
  END IF;

  v_workflow := v_pub.wf;
  v_fijacion := (v_pub.fecha_fijacion AT TIME ZONE 'America/Bogota')::DATE;
  v_derived := v_pub.fecha_desfijacion IS NULL;
  v_desfijacion := public.derive_desfijacion(
    v_fijacion,
    CASE WHEN v_pub.fecha_desfijacion IS NULL THEN NULL
         ELSE (v_pub.fecha_desfijacion AT TIME ZONE 'America/Bogota')::DATE END);

  -- FF1(a): classify the published AUTO, not the fijación line.
  SELECT * INTO v_auto FROM public.resolve_published_auto(p_pub_id) LIMIT 1;
  v_text := v_auto.auto_text;

  IF v_text IS NOT NULL THEN
    SELECT * INTO v_c FROM public.classify_providencia(v_text, v_workflow) LIMIT 1;
  END IF;

  -- FF1(c): unresolved auto, or a classification that carries no term →
  -- REQUIERE_REVISION_MANUAL. Never a generic fallback term.
  IF v_text IS NULL OR v_c.rule_id IS NULL OR NOT v_c.triggers_deadline OR v_c.deadline_type IS NULL THEN
    IF v_text IS NOT NULL AND v_c.rule_id IS NOT NULL AND NOT COALESCE(v_c.triggers_deadline, false) THEN
      RETURN NULL; -- providencia resolved and carries no term (e.g. constancia secretarial)
    END IF;
    INSERT INTO public.work_item_deadlines (
      owner_id, organization_id, work_item_id, deadline_type, label, description,
      trigger_event, trigger_date, deadline_date, business_days_count, status, calculation_meta
    ) VALUES (
      v_pub.owner_id, v_pub.organization_id, v_pub.work_item_id,
      'REVISION_MANUAL', 'Auto no resoluble desde el estado',
      LEFT(concat_ws(' ', v_pub.title, v_pub.annotation), 500),
      'ESTADO_NUEVO', v_fijacion, NULL, NULL, 'REQUIERE_REVISION_MANUAL',
      jsonb_build_object(
        'anchor_source', 'AUTO_VIA_FIJACION',
        'anchor_date', v_fijacion,
        'desfijacion_date', v_desfijacion,
        'auto_resolution', 'UNRESOLVED',
        'requires_manual_review', true,
        'manual_review_reason', 'AUTO_NO_RESUELTO_DESDE_ESTADO',
        'workflow_type', v_workflow,
        'pub_id', v_pub.id,
        'classification_text', LEFT(COALESCE(v_text, concat_ws(' ', v_pub.title, v_pub.annotation)), 500))
    )
    ON CONFLICT (work_item_id, deadline_type, trigger_date) DO NOTHING
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  SELECT * INTO v_r FROM public.compute_deadline_from_rule(v_desfijacion, v_workflow, v_c.deadline_type) LIMIT 1;
  IF v_r.rule_id IS NULL THEN RETURN NULL; END IF;

  INSERT INTO public.work_item_deadlines (
    owner_id, organization_id, work_item_id, deadline_type, label, description,
    trigger_event, trigger_date, deadline_date, business_days_count, status, calculation_meta
  ) VALUES (
    v_pub.owner_id, v_pub.organization_id, v_pub.work_item_id,
    v_c.deadline_type, v_c.providencia_type, LEFT(v_text, 500),
    'ESTADO_NUEVO', v_fijacion,
    COALESCE(v_r.deadline_date, v_desfijacion),
    CASE WHEN v_r.day_type = 'BUSINESS' THEN v_r.days_amount END,
    CASE WHEN v_r.requires_manual_review THEN 'REQUIERE_REVISION_MANUAL' ELSE 'PENDING' END,
    jsonb_build_object(
      -- FF1(b): the fijación remains the notification vehicle; arithmetic unchanged.
      'anchor_source', 'AUTO_VIA_FIJACION',
      'anchor_date', v_fijacion,
      'desfijacion_date', v_desfijacion,
      'desfijacion_source', CASE WHEN v_derived THEN 'DERIVED_NEXT_BUSINESS_DAY' ELSE 'PROVIDER' END,
      'date_confidence', CASE WHEN v_derived THEN 'medium' ELSE 'high' END,
      'auto_resolution', v_auto.auto_source,
      'auto_act_id', v_auto.auto_act_id,
      'rule_id', v_r.rule_id,
      'classification_rule_id', v_c.rule_id,
      'providencia_type', v_c.providencia_type,
      'workflow_type', v_workflow,
      'day_type', v_r.day_type,
      'days_amount', v_r.days_amount,
      'norma', v_r.norma,
      'pub_id', v_pub.id,
      'requires_manual_review', v_r.requires_manual_review,
      'classification_text', LEFT(v_text, 500))
  )
  ON CONFLICT (work_item_id, deadline_type, trigger_date) DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END; $function$

