-- 1. Allow the new portfolio-only match type (22-digit radicado tolerance)
ALTER TABLE public.work_item_email_links
  DROP CONSTRAINT IF EXISTS work_item_email_links_matched_by_chk;
ALTER TABLE public.work_item_email_links
  ADD CONSTRAINT work_item_email_links_matched_by_chk
  CHECK (matched_by = ANY (ARRAY['RADICADO','RADICADO_PARCIAL','RADICADO_SIN_CERO','PARTE','DESPACHO','CLIENTE','MANUAL']));

-- 2. Classifier mirror (exact mirror of emailMatcher.ts EVIDENCE_SUBTYPE_RULES)
CREATE OR REPLACE FUNCTION public.classify_email_evidence_subtype(p_subject text, p_sender text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
  SELECT CASE
    WHEN NOT public.is_judicial_email_sender(p_sender) THEN NULL
    WHEN COALESCE(p_subject,'') ~* '^(respuesta autom[aá]tica|automatic reply|acuse)' THEN 'ACUSE_AUTOMATICO'
    WHEN COALESCE(p_subject,'') ~* 'token validaci[oó]n|se le ha compartido informaci[oó]n de proceso|acceso a informaci[oó]n de proceso' THEN 'ACCESO_EXPEDIENTE'
    WHEN COALESCE(p_subject,'') ~* 'acta *(de +)?reparto' THEN 'ACTA_REPARTO'
    WHEN COALESCE(p_subject,'') ~* 'inadmit|inadmisi[oó]n|rechaza' THEN 'INADMISION'
    WHEN COALESCE(p_subject,'') ~* 'admite|auto admisorio|admisi[oó]n' THEN 'AUTO_ADMISORIO'
    WHEN COALESCE(p_subject,'') ~* 'estado electr[oó]nico|fija[a-z]* +(el +)?estado' THEN 'FIJACION_ESTADO'
    WHEN COALESCE(p_subject,'') ~* 'desistimiento' THEN 'DESISTIMIENTO'
    WHEN COALESCE(p_subject,'') ~* 'concede\s+(la\s+|el\s+|los\s+|las\s+)?(impugnaci[óo]n|apelaci[óo]n|recurso|recursos|alzada)' THEN 'RECURSO_CONCEDIDO'
    WHEN COALESCE(p_subject,'') ~* 'fallo|sentencia|resuelve|tutela +amparo|(niega|concede)\s+(el\s+|la\s+|las\s+|los\s+)?(amparo|tutela|pretensi[óo]n|pretensiones)' THEN 'FALLO_SENTENCIA'
    WHEN COALESCE(p_subject,'') ~* 'traslado' THEN 'TRASLADO'
    WHEN COALESCE(p_subject,'') ~* 'requerimiento|requiere' THEN 'REQUERIMIENTO'
    WHEN COALESCE(p_subject,'') ~* 'audiencia|diligencia' THEN 'CITACION_AUDIENCIA'
    WHEN COALESCE(p_subject,'') ~* 'notifica[a-z]*.*(proceso|curador|personal|demanda)|curador ad litem' THEN 'NOTIFICACION_PERSONAL'
    ELSE 'OTRO_JUDICIAL'
  END
$function$;

-- 3. RECURSO_CONCEDIDO opens no deadline (explicit NULL, defensive)
CREATE OR REPLACE FUNCTION public.email_subtype_deadline_type(p_workflow text, p_subtype text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
  SELECT CASE p_subtype
    WHEN 'AUTO_ADMISORIO' THEN CASE WHEN p_workflow = 'TUTELA' THEN NULL ELSE 'TRASLADO_DEMANDA' END
    WHEN 'INADMISION' THEN 'SUBSANACION'
    WHEN 'TRASLADO' THEN CASE WHEN p_workflow = 'CPACA' THEN 'TRASLADO_DEMANDA' ELSE 'CONTESTACION_DEMANDA' END
    WHEN 'FALLO_SENTENCIA' THEN CASE WHEN p_workflow = 'TUTELA' THEN 'IMPUGNACION_TUTELA' ELSE 'RECURSO_APELACION_SENTENCIA' END
    WHEN 'RECURSO_CONCEDIDO' THEN NULL
    WHEN 'REQUERIMIENTO' THEN 'RESPUESTA_REQUERIMIENTO'
    ELSE NULL
  END
$function$;

-- 4. Stage mapping: second instance / recursos
CREATE OR REPLACE FUNCTION public.email_subtype_stage(p_workflow text, p_subtype text, p_subject text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
  SELECT CASE
    WHEN p_subtype = 'ACTA_REPARTO' THEN CASE p_workflow
      WHEN 'CGP' THEN 'RADICADO_CONFIRMED' WHEN 'CPACA' THEN 'DEMANDA_RADICADA'
      WHEN 'TUTELA' THEN 'TUTELA_RADICADA' ELSE 'RADICACION' END
    WHEN p_subtype = 'AUTO_ADMISORIO' THEN CASE p_workflow
      WHEN 'CGP' THEN 'AUTO_ADMISORIO' WHEN 'CPACA' THEN 'AUTO_ADMISORIO'
      WHEN 'TUTELA' THEN 'TUTELA_ADMITIDA' ELSE 'AUTO_ADMISORIO' END
    WHEN p_subtype = 'INADMISION' THEN 'SUBSANACION'
    WHEN p_subtype = 'TRASLADO' THEN CASE p_workflow
      WHEN 'CPACA' THEN 'TRASLADO_EXCEPCIONES' WHEN 'CGP' THEN 'EXCEPCIONES_PREVIAS' ELSE 'TRASLADO_DEMANDA' END
    WHEN p_subtype = 'CITACION_AUDIENCIA' THEN CASE
      WHEN COALESCE(p_subject,'') ~* 'pruebas' THEN CASE p_workflow WHEN 'CGP' THEN 'AUDIENCIA_INSTRUCCION' ELSE 'AUDIENCIA_PRUEBAS' END
      ELSE 'AUDIENCIA_INICIAL' END
    WHEN p_subtype = 'RECURSO_CONCEDIDO' THEN CASE p_workflow
      WHEN 'TUTELA' THEN 'FALLO_SEGUNDA_INSTANCIA' ELSE 'RECURSOS' END
    WHEN p_subtype = 'FALLO_SENTENCIA' THEN CASE p_workflow
      WHEN 'CGP' THEN 'ALEGATOS_SENTENCIA' WHEN 'CPACA' THEN 'ALEGATOS_SENTENCIA'
      WHEN 'TUTELA' THEN 'FALLO_PRIMERA_INSTANCIA' ELSE 'ALEGATOS_SENTENCIA' END
    ELSE NULL
  END
$function$;

CREATE OR REPLACE FUNCTION public.email_subtype_confidence(p_subtype text)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
  SELECT CASE p_subtype
    WHEN 'FALLO_SENTENCIA' THEN 0.9 WHEN 'AUTO_ADMISORIO' THEN 0.85
    WHEN 'RECURSO_CONCEDIDO' THEN 0.85
    WHEN 'INADMISION' THEN 0.85 WHEN 'ACTA_REPARTO' THEN 0.8
    WHEN 'CITACION_AUDIENCIA' THEN 0.7 WHEN 'TRASLADO' THEN 0.65
    ELSE 0.6 END
$function$;

CREATE OR REPLACE FUNCTION public.email_subtype_label(p_subtype text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
  SELECT CASE p_subtype
    WHEN 'AUTO_ADMISORIO' THEN 'Auto admisorio' WHEN 'INADMISION' THEN 'Inadmisión'
    WHEN 'TRASLADO' THEN 'Traslado' WHEN 'REQUERIMIENTO' THEN 'Requerimiento'
    WHEN 'CITACION_AUDIENCIA' THEN 'Citación a audiencia' WHEN 'FALLO_SENTENCIA' THEN 'Fallo / sentencia'
    WHEN 'RECURSO_CONCEDIDO' THEN 'Recurso concedido'
    WHEN 'ACTA_REPARTO' THEN 'Acta de reparto' WHEN 'FIJACION_ESTADO' THEN 'Fijación en estado'
    WHEN 'DESISTIMIENTO' THEN 'Desistimiento' WHEN 'NOTIFICACION_PERSONAL' THEN 'Notificación personal'
    WHEN 'ACCESO_EXPEDIENTE' THEN 'Acceso a expediente' WHEN 'ACUSE_AUTOMATICO' THEN 'Acuse automático'
    ELSE 'Comunicación judicial' END
$function$;

-- 5. Effects: skip deadline when an equivalent term is already fulfilled;
--    tailored Spanish reason for RECURSO_CONCEDIDO.
CREATE OR REPLACE FUNCTION public.apply_email_evidence_effects(p_link_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  l record; wi record; r record;
  v_dl_type text; v_stage text; v_trigger date; v_deadline_id uuid; v_existing record;
  v_sugg_id uuid; v_fp text; v_meta jsonb; v_reason text;
  v_created_deadline boolean := false; v_created_stage boolean := false;
  v_skipped_fulfilled boolean := false;
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
    'workflow_type', wi.workflow_type::text);

  -- ---- PART B: deadline suggestion ----
  IF v_dl_type IS NOT NULL THEN
    -- Guard: an equivalent term already satisfied for this fallo window means
    -- the party already acted; a new suggestion would be noise.
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
        INSERT INTO public.work_item_deadlines
          (owner_id, organization_id, work_item_id, deadline_type, label, description,
           trigger_event, trigger_date, deadline_date, business_days_count, status, calculation_meta)
        VALUES (wi.owner_id, wi.organization_id, l.work_item_id, v_dl_type,
                public.email_subtype_label(l.evidence_subtype) || ' (correo)',
                'Término sugerido a partir de una notificación por correo: ' || COALESCE(l.subject,'(sin asunto)'),
                'EMAIL_' || l.evidence_subtype, v_trigger, r.deadline_date, r.days_amount,
                'SUGGESTED_BY_EMAIL',
                v_meta || jsonb_build_object('day_type', r.day_type, 'norma', r.norma,
                                             'requires_manual_review', COALESCE(r.requires_manual_review,false)))
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
                            'stage_suggestion_id', v_sugg_id, 'stage_created', v_created_stage);
END;
$function$;

-- 6. Idempotent cleanup + reclassification of existing links
DO $cleanup$
DECLARE
  v_reclassified int := 0;
  v_deadlines_removed int := 0;
  v_effects_removed int := 0;
  v_stage_fixed int := 0;
BEGIN
  WITH upd AS (
    UPDATE public.work_item_email_links
      SET evidence_subtype = 'RECURSO_CONCEDIDO'
    WHERE direction = 'received'
      AND evidence_subtype = 'FALLO_SENTENCIA'
      AND COALESCE(subject,'') ~* 'concede\s+(la\s+|el\s+|los\s+|las\s+)?(impugnaci[óo]n|apelaci[óo]n|recurso|recursos|alzada)'
    RETURNING id
  ) SELECT count(*) INTO v_reclassified FROM upd;

  -- Spurious email-suggested deadlines born from a "concede recurso" mail
  WITH del_eff AS (
    DELETE FROM public.work_item_email_link_effects e
    USING public.work_item_email_links l
    WHERE e.link_id = l.id
      AND l.evidence_subtype = 'RECURSO_CONCEDIDO'
      AND e.effect_type = 'DEADLINE_OPENED'
    RETURNING e.target_id
  ), del_dl AS (
    DELETE FROM public.work_item_deadlines d
    WHERE d.status = 'SUGGESTED_BY_EMAIL'
      AND (d.id IN (SELECT target_id FROM del_eff)
           OR d.id = 'd78f2c11-e3cb-4941-a86e-261a56a58caa'::uuid)
    RETURNING d.id
  )
  SELECT (SELECT count(*) FROM del_eff), (SELECT count(*) FROM del_dl)
    INTO v_effects_removed, v_deadlines_removed;

  -- Re-point stage suggestions emitted by reclassified links
  WITH fixed AS (
    UPDATE public.work_item_stage_suggestions s
      SET suggested_stage = public.email_subtype_stage(wi.workflow_type::text, 'RECURSO_CONCEDIDO', l.subject),
          confidence = 0.85,
          reason = 'Recurso concedido — expediente remitido al superior',
          event_fingerprint = 'EMAIL:' || COALESCE(l.internet_message_id, l.id::text) || ':RECURSO_CONCEDIDO'
    FROM (
      SELECT DISTINCT ON (work_item_id, COALESCE(internet_message_id, id::text))
             id, work_item_id, internet_message_id, subject
      FROM public.work_item_email_links
      WHERE evidence_subtype = 'RECURSO_CONCEDIDO'
      ORDER BY work_item_id, COALESCE(internet_message_id, id::text), created_at
    ) l
    JOIN public.work_items wi ON wi.id = l.work_item_id
    WHERE s.work_item_id = l.work_item_id
      AND s.status = 'PENDING'
      AND s.event_fingerprint = 'EMAIL:' || COALESCE(l.internet_message_id, l.id::text) || ':FALLO_SENTENCIA'
      AND NOT EXISTS (
        SELECT 1 FROM public.work_item_stage_suggestions s2
        WHERE s2.work_item_id = l.work_item_id
          AND s2.event_fingerprint = 'EMAIL:' || COALESCE(l.internet_message_id, l.id::text) || ':RECURSO_CONCEDIDO'
      )
    RETURNING s.id
  ) SELECT count(*) INTO v_stage_fixed FROM fixed;

  RAISE NOTICE 'iter4.1 cleanup: links_reclassified=%, deadlines_removed=%, effects_removed=%, stage_suggestions_repointed=%',
    v_reclassified, v_deadlines_removed, v_effects_removed, v_stage_fixed;
END
$cleanup$;