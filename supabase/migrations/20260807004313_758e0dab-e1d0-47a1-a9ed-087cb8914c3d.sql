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
  v_skipped_fulfilled boolean := false; v_gap boolean := false;
  v_aud_raw text; v_aud_ts timestamptz; v_aud_date date; v_aud_id uuid;
  v_aud_created boolean := false; v_hearing_id uuid; v_termino_dias int;
  v_notice text; v_act_id uuid;
  v_reserva boolean := false; v_substantive boolean := false;
  v_marker text; v_exception text;
BEGIN
  SELECT * INTO l FROM public.work_item_email_links WHERE id = p_link_id;
  IF NOT FOUND OR l.link_status <> 'CONFIRMED' THEN
    RETURN jsonb_build_object('skipped','not_confirmed');
  END IF;

  SELECT * INTO wi FROM public.work_items WHERE id = l.work_item_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('skipped','no_work_item'); END IF;

  v_gap := public.despacho_has_coverage_gap(wi.radicado);
  -- ITER43 A3(iii): reserva sumarial (Ley 906). The provider lawfully publishes
  -- nothing, so email is substantive for this matter and only for this matter.
  v_reserva := public.work_item_reserva_activa(wi.id);
  v_substantive := v_gap OR v_reserva;
  v_marker := CASE WHEN v_reserva
                   THEN 'Fuente: correo (proceso con reserva sumarial)'
                   ELSE 'Fuente: correo (despacho sin publicación en proveedores)' END;
  v_exception := CASE WHEN v_reserva THEN 'RESERVA_SUMARIAL_ITER43' ELSE 'COVERAGE_GAP_ITER19' END;

  IF l.evidence_type = 'SGDE_ACCESO_EXPEDIENTE' THEN
    INSERT INTO public.work_item_email_link_effects
      (link_id, work_item_id, user_id, organization_id, effect_type, target_table, target_id, label)
    VALUES (l.id, l.work_item_id, l.user_id, l.organization_id, 'EXPEDIENTE_LINK_OFFERED', NULL, NULL,
            'Enlace de expediente ofrecido')
    ON CONFLICT DO NOTHING;
  END IF;

  IF NULLIF(l.evidence_meta->>'instance_observed','') IS NOT NULL
     AND l.evidence_meta->>'instance_observed' ~ '^0\d$'
     AND COALESCE(public.radicado_instance(wi.radicado), '00') = '00'
     AND l.evidence_meta->>'instance_observed' > '00' THEN
    INSERT INTO public.work_item_email_link_effects
      (link_id, work_item_id, user_id, organization_id, effect_type, target_table, target_id, label)
    VALUES (l.id, l.work_item_id, l.user_id, l.organization_id, 'NOTICIA_INFORMATIVA', NULL, NULL,
            'Según correo del despacho, el radicado aparece en instancia '
              || (l.evidence_meta->>'instance_observed') || '. Verifíquelo en el expediente.')
    ON CONFLICT DO NOTHING;
  END IF;

  IF l.direction <> 'received' OR l.evidence_subtype IS NULL THEN
    RETURN jsonb_build_object('skipped','not_classified_inbound');
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
    'source_primacy', CASE WHEN v_reserva THEN 'EMAIL_RESERVA_SUMARIAL'
                           WHEN v_gap THEN 'EMAIL_COVERAGE_GAP'
                           ELSE 'EMAIL_SECONDARY' END,
    'workflow_type', wi.workflow_type::text);

  -- ---- A3(ii) EXCEPTION: hearing citation with a parsed date ----
  v_aud_raw := NULLIF(l.evidence_meta->>'audiencia_fecha', '');
  IF l.evidence_subtype = 'CITACION_AUDIENCIA' AND v_aud_raw IS NOT NULL THEN
    BEGIN
      v_aud_ts := v_aud_raw::timestamptz;
      v_aud_date := (v_aud_ts AT TIME ZONE 'America/Bogota')::date;
    EXCEPTION WHEN others THEN
      v_aud_ts := NULL; v_aud_date := NULL;
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
                'Audiencia programada (según correo del despacho)',
                'Citación a audiencia detectada en un correo del despacho: '
                  || COALESCE(l.subject,'(sin asunto)')
                  || ' — sugerencia según correo del despacho; confírmela en el expediente.',
                'EMAIL_CITACION_AUDIENCIA', v_trigger, v_aud_date, NULL,
                'SUGGESTED_BY_EMAIL',
                v_meta || jsonb_build_object('audiencia_at', v_aud_raw,
                                             'exception', CASE WHEN v_reserva THEN 'RESERVA_SUMARIAL_ITER43' ELSE 'HEARING_CITATION_ITER19' END,
                                             'nij', l.evidence_meta->>'nij',
                                             'ai_classified', COALESCE(l.ai_classified,false)))
        ON CONFLICT (work_item_id, deadline_type, trigger_date) DO NOTHING
        RETURNING id INTO v_aud_id;
        v_aud_created := v_aud_id IS NOT NULL;
      END IF;

      IF v_aud_ts IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.work_item_hearings
         WHERE work_item_id = l.work_item_id AND scheduled_at = v_aud_ts
      ) THEN
        INSERT INTO public.work_item_hearings
          (organization_id, work_item_id, custom_name, scheduled_at, auto_detected, status,
           extraction_method, discovery_type, notes_plain_text)
        VALUES (wi.organization_id, l.work_item_id,
                CASE WHEN v_reserva THEN 'Audiencia (correo — proceso con reserva sumarial)'
                     ELSE 'Audiencia (según correo del despacho)' END,
                v_aud_ts, true,
                CASE WHEN v_aud_ts > now() THEN 'scheduled' ELSE 'held' END,
                CASE WHEN v_reserva THEN 'email_reserva_iter43' ELSE 'email_citacion_iter19' END,
                CASE WHEN v_aud_ts > now() THEN 'NOVEDAD' ELSE 'HISTORICO_DETECTADO' END,
                CASE WHEN v_reserva THEN v_marker || ' — ' ELSE 'Fecha tomada de un correo del despacho: ' END
                  || COALESCE(l.subject,'(sin asunto)'))
        RETURNING id INTO v_hearing_id;
      END IF;

      IF v_aud_id IS NOT NULL OR v_hearing_id IS NOT NULL THEN
        INSERT INTO public.work_item_email_link_effects
          (link_id, work_item_id, user_id, organization_id, effect_type, target_table, target_id, label)
        VALUES (l.id, l.work_item_id, l.user_id, l.organization_id, 'HEARING_SUGGESTED',
                'work_item_hearings', v_hearing_id,
                CASE WHEN v_reserva THEN v_marker || ' — audiencia: ' ELSE 'Audiencia según correo del despacho: ' END
                  || to_char(v_aud_date, 'DD/MM/YYYY'))
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END IF;

  -- ---- corroboration of an EXISTING term always allowed ----
  IF v_dl_type IS NOT NULL THEN
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
    ELSIF v_substantive THEN
      IF EXISTS (
        SELECT 1 FROM public.work_item_deadlines
         WHERE work_item_id = l.work_item_id AND deadline_type = v_dl_type
           AND status IN ('FULFILLED','FULFILLED_BY_EMAIL_EVIDENCE')
           AND trigger_date BETWEEN v_trigger - 30 AND v_trigger + 30
      ) THEN
        v_skipped_fulfilled := true;
      ELSE
        SELECT * INTO r FROM public.compute_deadline_from_rule(v_trigger, wi.workflow_type::text, v_dl_type);
        v_termino_dias := NULLIF(l.evidence_meta->>'termino_dias','')::int;
        INSERT INTO public.work_item_deadlines
          (owner_id, organization_id, work_item_id, deadline_type, label, description,
           trigger_event, trigger_date, deadline_date, business_days_count, status, calculation_meta)
        VALUES (wi.owner_id, wi.organization_id, l.work_item_id, v_dl_type,
                public.email_subtype_label(l.evidence_subtype) || ' (correo)',
                v_marker || '. ' || COALESCE(l.subject,'(sin asunto)'),
                'EMAIL_' || l.evidence_subtype, v_trigger, r.deadline_date, r.days_amount,
                'SUGGESTED_BY_EMAIL',
                v_meta || jsonb_build_object('day_type', r.day_type, 'norma', r.norma,
                          'exception', v_exception,
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
                v_marker || ' — ' || public.email_subtype_label(l.evidence_subtype))
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END IF;

  -- ---- substantive source: the email also lands as an actuación ----
  IF v_substantive THEN
    INSERT INTO public.work_item_acts
      (owner_id, organization_id, work_item_id, act_date, description, act_type,
       source, source_reference, hash_fingerprint, workflow_type, raw_data)
    VALUES (wi.owner_id, wi.organization_id, l.work_item_id, v_trigger,
            v_marker || ' — ' || COALESCE(l.subject,'(sin asunto)'),
            public.email_subtype_label(l.evidence_subtype),
            'email', COALESCE(l.internet_message_id, l.id::text),
            md5('EMAIL_ACT:' || COALESCE(l.internet_message_id, l.id::text)),
            wi.workflow_type::text,
            jsonb_build_object('email_link_id', l.id,
                               'coverage_gap', v_gap,
                               'reserva_sumarial', v_reserva,
                               'marker', v_marker))
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_act_id;
  END IF;

  -- ---- A1: stage. Provider primacy — email only suggests when substantive ----
  IF v_stage IS NOT NULL AND COALESCE(wi.stage,'') <> v_stage THEN
    IF v_substantive THEN
      v_fp := CASE WHEN v_reserva THEN 'EMAIL_RESERVA:' ELSE 'EMAIL_GAP:' END
              || COALESCE(l.internet_message_id, l.id::text) || ':' || l.evidence_subtype;
      v_reason := v_marker || ' — ' || public.email_subtype_label(l.evidence_subtype)
                  || ': "' || COALESCE(l.subject,'(sin asunto)') || '"';
      v_sugg_id := public.upsert_standing_stage_suggestion(
        l.work_item_id, v_stage, public.email_subtype_confidence(l.evidence_subtype),
        v_reason, 'EMAIL', v_fp, v_trigger, COALESCE(l.subject,''));
      v_created_stage := v_sugg_id IS NOT NULL;
      IF v_sugg_id IS NOT NULL THEN
        INSERT INTO public.work_item_email_link_effects
          (link_id, work_item_id, user_id, organization_id, effect_type, target_table, target_id, label)
        VALUES (l.id, l.work_item_id, l.user_id, l.organization_id, 'STAGE_SUGGESTED',
                'work_item_stage_suggestions', v_sugg_id, 'Sugirió etapa: ' || v_stage)
        ON CONFLICT DO NOTHING;
      END IF;
    ELSE
      v_notice := 'Según correo del despacho, ' || public.email_subtype_label(l.evidence_subtype)
                  || '. Verifíquelo en el expediente.';
      INSERT INTO public.work_item_email_link_effects
        (link_id, work_item_id, user_id, organization_id, effect_type, target_table, target_id, label)
      VALUES (l.id, l.work_item_id, l.user_id, l.organization_id, 'NOTICIA_INFORMATIVA', NULL, NULL, v_notice)
      ON CONFLICT DO NOTHING;
    END IF;
  ELSIF v_dl_type IS NOT NULL AND NOT v_substantive AND v_deadline_id IS NULL
        AND l.evidence_subtype <> 'CITACION_AUDIENCIA' THEN
    INSERT INTO public.work_item_email_link_effects
      (link_id, work_item_id, user_id, organization_id, effect_type, target_table, target_id, label)
    VALUES (l.id, l.work_item_id, l.user_id, l.organization_id, 'NOTICIA_INFORMATIVA', NULL, NULL,
            'Según correo del despacho, ' || public.email_subtype_label(l.evidence_subtype)
              || '. Verifíquelo en el expediente.')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN jsonb_build_object('coverage_gap', v_gap,
                            'reserva_sumarial', v_reserva,
                            'email_substantive', v_substantive,
                            'deadline_id', v_deadline_id, 'deadline_created', v_created_deadline,
                            'deadline_skipped_fulfilled', v_skipped_fulfilled,
                            'audiencia_deadline_id', v_aud_id, 'audiencia_created', v_aud_created,
                            'hearing_id', v_hearing_id, 'act_id', v_act_id,
                            'stage_suggestion_id', v_sugg_id, 'stage_created', v_created_stage);
END;
$function$;