ALTER TABLE public.work_item_email_links
  ADD COLUMN IF NOT EXISTS ai_classified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_classified_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_email_links_ai_pending
  ON public.work_item_email_links (link_status, ai_classified)
  WHERE ai_classified = false;

-- Anotación de los dos resúmenes espurios (eran corridas delta, no barridos).
UPDATE public.sync_full_sweep_runs
   SET status = 'SUPERSEDED',
       last_error = 'Corrida delta registrada por error como resumen de barrido (iter 5, Parte D). Desde ahora solo full_sweep=true escribe filas.'
 WHERE full_sweep = false AND messages_scanned = 0;

CREATE OR REPLACE FUNCTION public.apply_email_evidence_effects(p_link_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  l record; wi record; r record;
  v_dl_type text; v_stage text; v_trigger date; v_deadline_id uuid; v_existing record;
  v_sugg_id uuid; v_fp text; v_meta jsonb; v_reason text;
  v_created_deadline boolean := false; v_created_stage boolean := false;
  v_skipped_fulfilled boolean := false;
  v_obs_instance text; v_wi_instance text; v_inst_stage text;
  v_inst_sugg_id uuid; v_inst_created boolean := false;
  v_aud_raw text; v_aud_ts timestamptz; v_aud_date date; v_aud_id uuid;
  v_aud_created boolean := false; v_termino_dias int;
BEGIN
  SELECT * INTO l FROM public.work_item_email_links WHERE id = p_link_id;
  IF NOT FOUND OR l.link_status <> 'CONFIRMED' THEN
    RETURN jsonb_build_object('skipped','not_confirmed');
  END IF;

  SELECT * INTO wi FROM public.work_items WHERE id = l.work_item_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('skipped','no_work_item'); END IF;

  IF l.evidence_type = 'SGDE_ACCESO_EXPEDIENTE' THEN
    INSERT INTO public.work_item_email_link_effects
      (link_id, work_item_id, user_id, organization_id, effect_type, target_table, target_id, label)
    VALUES (l.id, l.work_item_id, l.user_id, l.organization_id, 'EXPEDIENTE_LINK_OFFERED', NULL, NULL,
            'Enlace de expediente ofrecido')
    ON CONFLICT DO NOTHING;
  END IF;

  -- ---- PART F (iter 4.2): observed instance shift (00 -> 01+) ----
  v_obs_instance := NULLIF(l.evidence_meta->>'instance_observed', '');
  v_wi_instance  := public.radicado_instance(wi.radicado);
  IF v_obs_instance IS NOT NULL AND v_obs_instance ~ '^0\d$'
     AND COALESCE(v_wi_instance, '00') = '00' AND v_obs_instance > '00' THEN
    v_inst_stage := CASE wi.workflow_type::text
      WHEN 'TUTELA' THEN 'FALLO_SEGUNDA_INSTANCIA' ELSE 'RECURSOS' END;
    v_fp := 'EMAIL_INSTANCE:' || COALESCE(l.internet_message_id, l.id::text) || ':' || v_obs_instance;
    IF COALESCE(wi.stage,'') <> v_inst_stage THEN
      SELECT id INTO v_inst_sugg_id FROM public.work_item_stage_suggestions
        WHERE work_item_id = l.work_item_id AND event_fingerprint = v_fp LIMIT 1;
      IF v_inst_sugg_id IS NULL THEN
        INSERT INTO public.work_item_stage_suggestions
          (work_item_id, organization_id, owner_id, source_type, event_fingerprint,
           suggested_stage, confidence, reason, status)
        VALUES (l.work_item_id, wi.organization_id, wi.owner_id, 'EMAIL', v_fp, v_inst_stage,
                0.85,
                'El despacho referencia el radicado en segunda instancia (' || v_obs_instance || ')',
                'PENDING')
        RETURNING id INTO v_inst_sugg_id;
        v_inst_created := true;
      END IF;
    END IF;
    INSERT INTO public.work_item_email_link_effects
      (link_id, work_item_id, user_id, organization_id, effect_type, target_table, target_id, label)
    VALUES (l.id, l.work_item_id, l.user_id, l.organization_id, 'STAGE_SUGGESTED',
            'work_item_stage_suggestions', v_inst_sugg_id,
            'Instancia observada: ' || v_obs_instance || ' — segunda instancia')
    ON CONFLICT DO NOTHING;
  END IF;

  IF l.direction <> 'received' OR l.evidence_subtype IS NULL THEN
    RETURN jsonb_build_object('skipped','not_classified_inbound',
                              'instance_suggestion_id', v_inst_sugg_id,
                              'instance_stage_created', v_inst_created);
  END IF;

  v_trigger := (l.received_at AT TIME ZONE 'America/Bogota')::date;
  v_dl_type := public.email_subtype_deadline_type(wi.workflow_type::text, l.evidence_subtype);
  v_stage   := public.email_subtype_stage(wi.workflow_type::text, l.evidence_subtype, l.subject);
  v_meta := jsonb_build_object(
    'email_evidence', jsonb_build_object(
      'internet_message_id', l.internet_message_id,
      'subject', l.subject,
      'web_link', l.web_link,
      'link_id', l.id,
      'evidence_subtype', l.evidence_subtype),
    'anchor_source','EMAIL_NOTIFICATION',
    'anchor_date', v_trigger,
    'workflow_type', wi.workflow_type::text);

  -- ---- PART B2 (iter 5): citación a audiencia con fecha extraída del cuerpo ----
  -- La fecha de la audiencia ES el vencimiento: el término no se calcula por regla.
  v_aud_raw := NULLIF(l.evidence_meta->>'audiencia_fecha', '');
  IF l.evidence_subtype = 'CITACION_AUDIENCIA' AND v_aud_raw IS NOT NULL THEN
    BEGIN
      v_aud_ts := v_aud_raw::timestamptz;
      v_aud_date := (v_aud_ts AT TIME ZONE 'America/Bogota')::date;
    EXCEPTION WHEN others THEN
      v_aud_date := NULL;
    END;
    IF v_aud_date IS NOT NULL THEN
      SELECT id INTO v_aud_id FROM public.work_item_deadlines
        WHERE work_item_id = l.work_item_id AND deadline_type = 'AUDIENCIA'
          AND deadline_date = v_aud_date LIMIT 1;
      IF v_aud_id IS NULL THEN
        INSERT INTO public.work_item_deadlines
          (owner_id, organization_id, work_item_id, deadline_type, label, description,
           trigger_event, trigger_date, deadline_date, business_days_count, status, calculation_meta)
        VALUES (wi.owner_id, wi.organization_id, l.work_item_id, 'AUDIENCIA',
                'Audiencia programada (correo)',
                'Citación a audiencia detectada en un correo del despacho: '
                  || COALESCE(l.subject,'(sin asunto)'),
                'EMAIL_CITACION_AUDIENCIA', v_trigger, v_aud_date, NULL,
                'SUGGESTED_BY_EMAIL',
                v_meta || jsonb_build_object(
                  'audiencia_at', v_aud_raw,
                  'nij', l.evidence_meta->>'nij',
                  'ai_classified', COALESCE(l.ai_classified, false)))
        ON CONFLICT (work_item_id, deadline_type, trigger_date) DO NOTHING
        RETURNING id INTO v_aud_id;
        v_aud_created := v_aud_id IS NOT NULL;
      END IF;
      IF v_aud_id IS NOT NULL THEN
        INSERT INTO public.work_item_email_link_effects
          (link_id, work_item_id, user_id, organization_id, effect_type, target_table, target_id, label)
        VALUES (l.id, l.work_item_id, l.user_id, l.organization_id, 'DEADLINE_OPENED',
                'work_item_deadlines', v_aud_id,
                'Audiencia programada: ' || to_char(v_aud_date, 'DD/MM/YYYY'))
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END IF;

  -- ---- PART B: deadline suggestion ----
  IF v_dl_type IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.work_item_deadlines
      WHERE work_item_id = l.work_item_id
        AND deadline_type = v_dl_type
        AND status IN ('FULFILLED','FULFILLED_BY_EMAIL_EVIDENCE')
        AND trigger_date BETWEEN v_trigger - 30 AND v_trigger + 30
    ) THEN
      v_skipped_fulfilled := true;
    ELSE
      SELECT * INTO v_existing FROM public.work_item_deadlines
        WHERE work_item_id = l.work_item_id AND deadline_type = v_dl_type
          AND trigger_date BETWEEN v_trigger - 1 AND v_trigger + 1
        ORDER BY created_at LIMIT 1;

      IF FOUND THEN
        UPDATE public.work_item_deadlines
          SET calculation_meta = COALESCE(calculation_meta,'{}'::jsonb)
                || jsonb_build_object('corroborating_email', v_meta->'email_evidence'),
              updated_at = now()
          WHERE id = v_existing.id;
        v_deadline_id := v_existing.id;
      ELSE
        SELECT * INTO r FROM public.compute_deadline_from_rule(v_trigger, wi.workflow_type::text, v_dl_type);
        v_termino_dias := NULLIF(l.evidence_meta->>'termino_dias','')::int;
        INSERT INTO public.work_item_deadlines
          (owner_id, organization_id, work_item_id, deadline_type, label, description,
           trigger_event, trigger_date, deadline_date, business_days_count, status, calculation_meta)
        VALUES (wi.owner_id, wi.organization_id, l.work_item_id, v_dl_type,
                public.email_subtype_label(l.evidence_subtype) || ' (correo)',
                'Término sugerido a partir de una notificación por correo: ' || COALESCE(l.subject,'(sin asunto)'),
                'EMAIL_' || l.evidence_subtype, v_trigger, r.deadline_date, r.days_amount,
                'SUGGESTED_BY_EMAIL',
                v_meta || jsonb_build_object('day_type', r.day_type, 'norma', r.norma,
                                             'requires_manual_review', COALESCE(r.requires_manual_review,false))
                       || CASE WHEN v_termino_dias IS NOT NULL
                               THEN jsonb_build_object('termino_dias_observado', v_termino_dias)
                               ELSE '{}'::jsonb END)
        ON CONFLICT (work_item_id, deadline_type, trigger_date) DO NOTHING
        RETURNING id INTO v_deadline_id;
        v_created_deadline := v_deadline_id IS NOT NULL;
      END IF;

      IF v_deadline_id IS NOT NULL THEN
        INSERT INTO public.work_item_email_link_effects
          (link_id, work_item_id, user_id, organization_id, effect_type, target_table, target_id, label)
        VALUES (l.id, l.work_item_id, l.user_id, l.organization_id, 'DEADLINE_OPENED',
                'work_item_deadlines', v_deadline_id,
                'Abrió término: ' || public.email_subtype_label(l.evidence_subtype))
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END IF;

  -- ---- PART C: stage suggestion ----
  IF v_stage IS NOT NULL AND COALESCE(wi.stage,'') <> v_stage THEN
    v_fp := 'EMAIL:' || COALESCE(l.internet_message_id, l.id::text) || ':' || l.evidence_subtype;
    v_reason := CASE
      WHEN l.evidence_subtype = 'RECURSO_CONCEDIDO'
        THEN 'Recurso concedido — expediente remitido al superior'
      ELSE 'Correo del despacho clasificado como ' || public.email_subtype_label(l.evidence_subtype)
             || ': "' || COALESCE(l.subject,'(sin asunto)') || '"'
    END;
    IF NOT EXISTS (SELECT 1 FROM public.work_item_stage_suggestions
                   WHERE work_item_id = l.work_item_id AND event_fingerprint = v_fp) THEN
      INSERT INTO public.work_item_stage_suggestions
        (work_item_id, organization_id, owner_id, source_type, event_fingerprint,
         suggested_stage, confidence, reason, status)
      VALUES (l.work_item_id, wi.organization_id, wi.owner_id, 'EMAIL', v_fp, v_stage,
              public.email_subtype_confidence(l.evidence_subtype), v_reason, 'PENDING')
      RETURNING id INTO v_sugg_id;
      v_created_stage := true;
    ELSE
      SELECT id INTO v_sugg_id FROM public.work_item_stage_suggestions
        WHERE work_item_id = l.work_item_id AND event_fingerprint = v_fp LIMIT 1;
    END IF;

    IF v_sugg_id IS NOT NULL THEN
      INSERT INTO public.work_item_email_link_effects
        (link_id, work_item_id, user_id, organization_id, effect_type, target_table, target_id, label)
      VALUES (l.id, l.work_item_id, l.user_id, l.organization_id, 'STAGE_SUGGESTED',
              'work_item_stage_suggestions', v_sugg_id, 'Sugirió etapa: ' || v_stage)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  RETURN jsonb_build_object('deadline_id', v_deadline_id, 'deadline_created', v_created_deadline,
                            'deadline_skipped_fulfilled', v_skipped_fulfilled,
                            'audiencia_deadline_id', v_aud_id, 'audiencia_created', v_aud_created,
                            'stage_suggestion_id', v_sugg_id, 'stage_created', v_created_stage,
                            'instance_suggestion_id', v_inst_sugg_id,
                            'instance_stage_created', v_inst_created);
END;
$function$;