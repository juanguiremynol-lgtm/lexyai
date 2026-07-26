CREATE OR REPLACE FUNCTION public.find_subsanacion_evidence_act(
  p_work_item_id uuid,
  p_from date,
  p_to date
) RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id
  FROM public.work_item_acts a
  WHERE a.work_item_id = p_work_item_id
    AND COALESCE(a.is_archived, false) = false
    AND COALESCE(a.act_date, a.event_date, a.detected_at::date) BETWEEN p_from AND p_to
    AND lower(COALESCE(a.description,'') || ' ' || COALESCE(a.event_summary,''))
        ~ 'recepci[oó]n memorial|recepci[oó]n de memoriales|recibe memoriales|agregar memorial|subsana|subsanaci[oó]n|allega memorial|radica memorial'
    AND lower(COALESCE(a.description,'') || ' ' || COALESCE(a.event_summary,'')) !~ 'inadmit|inadmis'
  ORDER BY COALESCE(a.act_date, a.event_date, a.detected_at::date) ASC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.find_auto_rechazo_act(
  p_work_item_id uuid,
  p_from date
) RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id
  FROM public.work_item_acts a
  WHERE a.work_item_id = p_work_item_id
    AND COALESCE(a.is_archived, false) = false
    AND COALESCE(a.act_date, a.event_date, a.detected_at::date) >= p_from
    AND (
      a.act_type = 'AUTO_RECHAZA'
      OR a.event_type_normalized = 'AUTO_RECHAZA'
      OR lower(COALESCE(a.description,'') || ' ' || COALESCE(a.event_summary,''))
         ~ 'rechaza la demanda|rechaza demanda|auto rechaza|rechazo de la demanda|se rechaza'
    )
  ORDER BY COALESCE(a.act_date, a.event_date, a.detected_at::date) ASC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.apply_rechazo_presunto_rule(
  p_work_item_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Bogota')::date;
  d record;
  v_evidence uuid;
  v_rechazo uuid;
  v_rechazo_date date;
  v_wi record;
  v_stage text;
  v_fulfilled int := 0;
  v_presunto int := 0;
  v_confirmado int := 0;
  v_examined int := 0;
  v_text text;
BEGIN
  FOR d IN
    SELECT * FROM public.work_item_deadlines
    WHERE deadline_type = 'SUBSANACION'
      AND deadline_date < v_today
      AND status NOT IN ('MET','FULFILLED','CANCELLED','FULFILLED_BY_EMAIL_EVIDENCE')
      AND (p_work_item_id IS NULL OR work_item_id = p_work_item_id)
  LOOP
    v_examined := v_examined + 1;
    SELECT * INTO v_wi FROM public.work_items WHERE id = d.work_item_id;
    IF NOT FOUND THEN CONTINUE; END IF;

    v_evidence := public.find_subsanacion_evidence_act(d.work_item_id, d.trigger_date, d.deadline_date + 3);

    IF v_evidence IS NOT NULL THEN
      UPDATE public.work_item_deadlines
      SET status = 'FULFILLED',
          met_at = COALESCE(met_at, now()),
          notes = COALESCE(notes,'') || ' [Regla rechazo presunto] Evidencia de memorial de subsanación detectada en el expediente.',
          calculation_meta = COALESCE(calculation_meta,'{}'::jsonb) || jsonb_build_object(
            'subsanacion_rule', jsonb_build_object(
              'outcome','FULFILLED',
              'evidence_act_id', v_evidence,
              'evaluated_at', now()
            ))
      WHERE id = d.id;
      v_fulfilled := v_fulfilled + 1;
      CONTINUE;
    END IF;

    -- No evidence: presumption of rejection
    v_rechazo := public.find_auto_rechazo_act(d.work_item_id, d.deadline_date);
    SELECT COALESCE(act_date, event_date, detected_at::date) INTO v_rechazo_date
    FROM public.work_item_acts WHERE id = v_rechazo;

    UPDATE public.work_item_deadlines
    SET status = 'VENCIDO_SIN_SUBSANAR',
        calculation_meta = COALESCE(calculation_meta,'{}'::jsonb) || jsonb_build_object(
          'subsanacion_rule', jsonb_build_object(
            'outcome', CASE WHEN v_rechazo IS NOT NULL THEN 'RECHAZO_CONFIRMADO' ELSE 'RECHAZO_PRESUNTO' END,
            'inadmisorio_date', d.trigger_date,
            'vencimiento_date', d.deadline_date,
            'auto_rechazo_act_id', v_rechazo,
            'auto_rechazo_date', v_rechazo_date,
            'evaluated_at', now()
          ))
    WHERE id = d.id;

    v_text := 'Rechazo presunto: demanda inadmitida el ' || to_char(d.trigger_date,'DD/MM/YYYY')
      || ', término de subsanación de 5 días hábiles vencido el ' || to_char(d.deadline_date,'DD/MM/YYYY')
      || ' sin que se detecte escrito de subsanación en el expediente. Conforme al criterio de la firma, se presume el rechazo de la demanda. Verifique si se radicó subsanación por canal no reflejado en el portal.';

    IF v_rechazo IS NULL THEN
      v_presunto := v_presunto + 1;
      IF NOT EXISTS (
        SELECT 1 FROM public.atenia_ai_observations o
        WHERE o.kind IN ('RECHAZO_PRESUNTO','RECHAZO_CONFIRMADO')
          AND o.links->>'deadline_id' = d.id::text
      ) THEN
        INSERT INTO public.atenia_ai_observations (organization_id, kind, severity, title, payload, links)
        VALUES (
          v_wi.organization_id, 'RECHAZO_PRESUNTO', 'HIGH',
          'Rechazo presunto — ' || COALESCE(v_wi.radicado, v_wi.title, 'expediente'),
          jsonb_build_object('mensaje', v_text, 'inadmisorio_date', d.trigger_date, 'vencimiento_date', d.deadline_date, 'radicado', v_wi.radicado),
          jsonb_build_object('work_item_id', d.work_item_id, 'deadline_id', d.id)
        );
      END IF;
    ELSE
      v_confirmado := v_confirmado + 1;
      UPDATE public.atenia_ai_observations
      SET kind = 'RECHAZO_CONFIRMADO',
          severity = 'HIGH',
          title = 'Rechazo confirmado — ' || COALESCE(v_wi.radicado, v_wi.title, 'expediente'),
          payload = COALESCE(payload,'{}'::jsonb) || jsonb_build_object('auto_rechazo_act_id', v_rechazo, 'auto_rechazo_date', v_rechazo_date),
          links = COALESCE(links,'{}'::jsonb) || jsonb_build_object('auto_rechazo_act_id', v_rechazo)
      WHERE links->>'deadline_id' = d.id::text AND kind = 'RECHAZO_PRESUNTO';

      IF NOT EXISTS (
        SELECT 1 FROM public.atenia_ai_observations o
        WHERE o.kind IN ('RECHAZO_PRESUNTO','RECHAZO_CONFIRMADO')
          AND o.links->>'deadline_id' = d.id::text
      ) THEN
        INSERT INTO public.atenia_ai_observations (organization_id, kind, severity, title, payload, links)
        VALUES (
          v_wi.organization_id, 'RECHAZO_CONFIRMADO', 'HIGH',
          'Rechazo confirmado — ' || COALESCE(v_wi.radicado, v_wi.title, 'expediente'),
          jsonb_build_object('mensaje', v_text, 'inadmisorio_date', d.trigger_date, 'vencimiento_date', d.deadline_date,
                             'auto_rechazo_act_id', v_rechazo, 'auto_rechazo_date', v_rechazo_date, 'radicado', v_wi.radicado),
          jsonb_build_object('work_item_id', d.work_item_id, 'deadline_id', d.id, 'auto_rechazo_act_id', v_rechazo)
        );
      END IF;
    END IF;

    -- Stage suggestion (never auto-applied)
    v_stage := CASE
      WHEN v_wi.workflow_type IN ('TUTELA','GOV_PROCEDURE','VIA_GUBERNATIVA','LABORAL') THEN 'ARCHIVADO'
      ELSE NULL
    END;

    IF v_wi.organization_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.work_item_stage_suggestions s
      WHERE s.work_item_id = d.work_item_id
        AND s.event_fingerprint = 'RECHAZO_PRESUNTO:' || d.id::text
    ) THEN
      INSERT INTO public.work_item_stage_suggestions (
        work_item_id, organization_id, owner_id, source_type, event_fingerprint,
        suggested_stage, confidence, reason, status
      ) VALUES (
        d.work_item_id, v_wi.organization_id, v_wi.owner_id, 'ACTUACION',
        'RECHAZO_PRESUNTO:' || d.id::text,
        v_stage, 0.75,
        CASE WHEN v_rechazo IS NOT NULL
          THEN 'Rechazo confirmado por auto de rechazo posterior al vencimiento del término de subsanación.'
          ELSE v_text END,
        'PENDING'
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'examined', v_examined,
    'fulfilled_by_evidence', v_fulfilled,
    'rechazo_presunto', v_presunto,
    'rechazo_confirmado', v_confirmado,
    'run_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_rechazo_presunto_rule(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.apply_rechazo_presunto_rule(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.find_subsanacion_evidence_act(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.find_auto_rechazo_act(uuid, date) TO authenticated, service_role;

SELECT cron.schedule(
  'apply-rechazo-presunto-rule',
  '45 11 * * *',
  $$SELECT public.apply_rechazo_presunto_rule();$$
);