ALTER VIEW public.v_gov_procedure_expired_background_timers SET (security_invoker = on);

CREATE OR REPLACE FUNCTION public.evaluate_gov_procedure_background_timers()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Bogota')::date;
  v_created int := 0;
  v_expired int := 0;
  v_fulfilled int := 0;
  v_unanchored int := 0;
  r record;
  v_anchor date;
  v_anchor_note text;
  v_deadline date;
  v_id uuid;
BEGIN
  ---------------------------------------------------------------------------
  -- A. Caducidad de la facultad sancionatoria (CPACA art. 52) — 3 años
  ---------------------------------------------------------------------------
  FOR r IN
    SELECT s.*, wi.owner_id, wi.organization_id
      FROM public.gov_procedure_work_item_state s
      JOIN public.work_items wi ON wi.id = s.work_item_id
     WHERE wi.workflow_type = 'GOV_PROCEDURE'
       AND wi.deleted_at IS NULL
       AND wi.lifecycle_state = 'ACTIVE'
  LOOP
    v_anchor := public.gov_caducidad_anchor(r.fact_date, r.cessation_date, r.conducta_continuada);
    IF COALESCE(r.conducta_continuada, false) THEN
      v_anchor_note := 'Conducta continuada: se cuenta desde el día siguiente a la cesación (CPACA art. 52).';
    ELSE
      v_anchor_note := 'Se cuenta desde el día de ocurrencia del hecho (CPACA art. 52).';
    END IF;

    IF v_anchor IS NULL THEN
      v_unanchored := v_unanchored + 1;
      UPDATE public.gov_procedure_work_item_state
         SET requires_manual_review = true,
             manual_review_reason = COALESCE(manual_review_reason,
               'Falta la fecha del hecho (o de cesación): la caducidad de la facultad sancionatoria no puede calcularse.'),
             updated_at = now()
       WHERE id = r.id
         AND (requires_manual_review = false OR manual_review_reason IS NULL);
      CONTINUE;
    END IF;

    -- Término en AÑOS: aritmética de calendario, nunca días hábiles.
    v_deadline := (v_anchor + interval '3 years')::date;

    SELECT id INTO v_id
      FROM public.work_item_deadlines
     WHERE work_item_id = r.work_item_id
       AND deadline_type = 'GOV_CADUCIDAD_SANCIONATORIA'
     LIMIT 1;

    IF v_id IS NULL THEN
      INSERT INTO public.work_item_deadlines (
        owner_id, organization_id, work_item_id, deadline_type, label, description,
        trigger_event, trigger_date, deadline_date, status, term_class, anchor_kind,
        anchor_source, anchor_provenance_note, bound_party_role, bound_party_source,
        is_judge_side, requires_manual_review, calculation_meta
      ) VALUES (
        r.owner_id, r.organization_id, r.work_item_id, 'GOV_CADUCIDAD_SANCIONATORIA',
        'Caducidad de la facultad sancionatoria',
        'Tres años desde el hecho. Sólo se satisface con la NOTIFICACIÓN del acto sancionatorio, no con su expedición.',
        CASE WHEN r.conducta_continuada THEN 'CESACION_CONDUCTA' ELSE 'HECHO' END,
        v_anchor, v_deadline, 'PENDING', 'ADMINISTRATIVO'::term_class, 'FACT_DATE',
        'GOV_PROCEDURE_STATE', v_anchor_note, 'CONTRAPARTE', 'RULE_CATALOG',
        false, false,
        jsonb_build_object(
          'norma','CPACA art. 52',
          'regime_code', r.regime_code,
          'day_type','YEARS',
          'days_amount',3,
          'anchor_date', v_anchor,
          'background_timer', true,
          'workflow_type','GOV_PROCEDURE')
      ) RETURNING id INTO v_id;
      v_created := v_created + 1;
    ELSE
      UPDATE public.work_item_deadlines
         SET trigger_date = v_anchor,
             deadline_date = v_deadline,
             anchor_provenance_note = v_anchor_note,
             updated_at = now()
       WHERE id = v_id
         AND status IN ('PENDING','PENDING_REVIEW')
         AND (trigger_date IS DISTINCT FROM v_anchor OR deadline_date IS DISTINCT FROM v_deadline);
    END IF;

    IF r.sancion_notificada_at IS NOT NULL THEN
      UPDATE public.work_item_deadlines
         SET status = 'FULFILLED',
             met_at = COALESCE(met_at, now()),
             closure_reason = 'SANCION_NOTIFICADA',
             legal_effect = CASE WHEN r.sancion_notificada_at <= v_deadline
                                 THEN 'FACULTAD_EJERCIDA_EN_TERMINO'
                                 ELSE 'NOTIFICACION_POSTERIOR_A_LA_CADUCIDAD' END,
             requires_manual_review = (r.sancion_notificada_at > v_deadline),
             updated_at = now()
       WHERE id = v_id AND status IN ('PENDING','PENDING_REVIEW');
      IF FOUND THEN v_fulfilled := v_fulfilled + 1; END IF;

    ELSIF v_today > v_deadline THEN
      UPDATE public.work_item_deadlines
         SET deadline_status = 'VENCIDO',
             legal_effect = 'POSIBLE_CADUCIDAD_FACULTAD_SANCIONATORIA',
             requires_manual_review = true,
             updated_at = now()
       WHERE id = v_id AND COALESCE(deadline_status,'') <> 'VENCIDO'
         AND status IN ('PENDING','PENDING_REVIEW');
      IF FOUND THEN
        v_expired := v_expired + 1;
        UPDATE public.gov_procedure_work_item_state
           SET attention_status = 'CADUCIDAD_POSIBLE',
               updated_at = now()
         WHERE id = r.id;
      END IF;
    END IF;
  END LOOP;

  ---------------------------------------------------------------------------
  -- B. Un año para decidir cada recurso (CPACA art. 52 inc. 2) — uno por recurso
  ---------------------------------------------------------------------------
  FOR r IN
    SELECT g.*, wi.owner_id, wi.organization_id
      FROM public.gov_procedure_recursos g
      JOIN public.work_items wi ON wi.id = g.work_item_id
     WHERE g.resolved_date IS NULL
       AND wi.deleted_at IS NULL
       AND wi.lifecycle_state = 'ACTIVE'
  LOOP
    v_deadline := (r.filed_date + interval '1 year')::date;
    v_id := r.deadline_id;

    IF v_id IS NULL THEN
      INSERT INTO public.work_item_deadlines (
        owner_id, organization_id, work_item_id, deadline_type, label, description,
        trigger_event, trigger_date, deadline_date, status, term_class, anchor_kind,
        anchor_source, anchor_provenance_note, bound_party_role, bound_party_source,
        is_judge_side, requires_manual_review, calculation_meta
      ) VALUES (
        r.owner_id, r.organization_id, r.work_item_id, 'GOV_RECURSO_UN_ANO',
        'Un año para decidir el recurso de ' || lower(r.recurso_type),
        'Vencido el año sin decisión, el recurso se entiende fallado a favor del recurrente (CPACA art. 52 inc. 2).',
        'RECURSO_INTERPUESTO', r.filed_date, v_deadline, 'PENDING',
        'ADMINISTRATIVO'::term_class, 'FILING_DATE', 'GOV_PROCEDURE_RECURSO',
        'Se cuenta desde la interposición del recurso.', 'CONTRAPARTE', 'RULE_CATALOG',
        false, false,
        jsonb_build_object(
          'norma','CPACA art. 52 inc. 2',
          'day_type','YEARS','days_amount',1,
          'recurso_id', r.id,
          'recurso_type', r.recurso_type,
          'background_timer', true,
          'workflow_type','GOV_PROCEDURE')
      ) RETURNING id INTO v_id;
      v_created := v_created + 1;
      UPDATE public.gov_procedure_recursos SET deadline_id = v_id, updated_at = now() WHERE id = r.id;
    END IF;

    IF v_today > v_deadline THEN
      UPDATE public.work_item_deadlines
         SET deadline_status = 'VENCIDO',
             legal_effect = 'POSIBLE_FALLO_A_FAVOR_POR_VENCIMIENTO',
             requires_manual_review = true,
             updated_at = now()
       WHERE id = v_id AND COALESCE(deadline_status,'') <> 'VENCIDO'
         AND status IN ('PENDING','PENDING_REVIEW');
      IF FOUND THEN
        v_expired := v_expired + 1;
        UPDATE public.gov_procedure_work_item_state
           SET attention_status = 'RECURSO_VENCIDO_SIN_DECIDIR', updated_at = now()
         WHERE work_item_id = r.work_item_id;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'ran_at', now(),
    'business_date', v_today,
    'deadlines_created', v_created,
    'deadlines_expired', v_expired,
    'deadlines_fulfilled', v_fulfilled,
    'unanchored_expedientes', v_unanchored);
END;
$fn$;