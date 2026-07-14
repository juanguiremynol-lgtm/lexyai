CREATE OR REPLACE FUNCTION public.compute_deadline_for_publicacion(p_pub_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pub RECORD; v_c RECORD; v_r RECORD; v_id UUID;
  v_workflow TEXT;
  v_text TEXT;
BEGIN
  SELECT p.id, p.work_item_id, p.title, p.annotation, p.fecha_fijacion, p.is_archived,
         w.workflow_type::TEXT AS wf, w.owner_id, w.organization_id
    INTO v_pub
    FROM public.work_item_publicaciones p
    JOIN public.work_items w ON w.id = p.work_item_id
    WHERE p.id = p_pub_id;

  IF NOT FOUND OR COALESCE(v_pub.is_archived, false) OR v_pub.fecha_fijacion IS NULL THEN
    RETURN NULL;
  END IF;

  v_workflow := v_pub.wf;
  v_text := concat_ws(' ', v_pub.title, v_pub.annotation);

  SELECT * INTO v_c FROM public.classify_providencia(
    v_text, v_workflow
  ) LIMIT 1;

  IF v_c.rule_id IS NULL OR NOT v_c.triggers_deadline OR v_c.deadline_type IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_r FROM public.compute_deadline_from_rule(
    v_pub.fecha_fijacion::DATE, v_workflow, v_c.deadline_type
  ) LIMIT 1;

  IF v_r.rule_id IS NULL THEN RETURN NULL; END IF;

  INSERT INTO public.work_item_deadlines (
    owner_id, organization_id, work_item_id, deadline_type, label, description,
    trigger_event, trigger_date, deadline_date, business_days_count, status, calculation_meta
  ) VALUES (
    v_pub.owner_id, v_pub.organization_id, v_pub.work_item_id,
    v_c.deadline_type,
    v_c.providencia_type || ' → ' || v_c.deadline_type,
    LEFT(v_text, 500),
    'ESTADO_NUEVO',
    v_pub.fecha_fijacion::DATE,
    COALESCE(v_r.deadline_date, v_pub.fecha_fijacion::DATE),
    CASE WHEN v_r.day_type = 'BUSINESS' THEN v_r.days_amount END,
    CASE WHEN v_r.requires_manual_review THEN 'REQUIERE_REVISION_MANUAL' ELSE 'PENDING' END,
    jsonb_build_object(
      'anchor_source', 'FECHA_FIJACION',
      'anchor_date', v_pub.fecha_fijacion,
      'rule_id', v_r.rule_id,
      'classification_rule_id', v_c.rule_id,
      'providencia_type', v_c.providencia_type,
      'workflow_type', v_workflow,
      'day_type', v_r.day_type,
      'days_amount', v_r.days_amount,
      'norma', v_r.norma,
      'pub_id', v_pub.id,
      'requires_manual_review', v_r.requires_manual_review,
      'classification_text', LEFT(v_text, 500)
    )
  )
  ON CONFLICT (work_item_id, deadline_type, trigger_date) DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;