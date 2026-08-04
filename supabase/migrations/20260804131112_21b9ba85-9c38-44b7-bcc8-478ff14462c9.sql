-- ============ ITERATION 19 · PART A: source primacy (providers first, email second) ============

-- A2: informational (non-actionable) effect chip
ALTER TABLE public.work_item_email_link_effects
  DROP CONSTRAINT IF EXISTS work_item_email_link_effects_effect_type_check;
ALTER TABLE public.work_item_email_link_effects
  ADD CONSTRAINT work_item_email_link_effects_effect_type_check
  CHECK (effect_type = ANY (ARRAY['DEADLINE_OPENED','DEADLINE_SATISFIED','STAGE_SUGGESTED',
                                  'EXPEDIENTE_LINK_OFFERED','NOTICIA_INFORMATIVA','HEARING_SUGGESTED']));

-- A3(i): data-driven coverage-gap predicate
CREATE OR REPLACE FUNCTION public.despacho_has_coverage_gap(p_radicado text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.despacho_coverage c
     WHERE c.publishes = false
       AND c.provider_key IN ('cpnu','publicaciones','samai','samai_estados')
       AND left(regexp_replace(COALESCE(p_radicado,''), '\D', '', 'g'), length(c.radicado_prefix)) = c.radicado_prefix
  )
$$;

-- A3(i): transition log when a silent despacho starts publishing again
CREATE TABLE IF NOT EXISTS public.despacho_coverage_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  radicado_prefix text NOT NULL,
  provider_key text NOT NULL,
  from_publishes boolean NOT NULL,
  to_publishes boolean NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.despacho_coverage_transitions TO authenticated;
GRANT ALL ON public.despacho_coverage_transitions TO service_role;
ALTER TABLE public.despacho_coverage_transitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated read coverage transitions" ON public.despacho_coverage_transitions;
CREATE POLICY "authenticated read coverage transitions"
  ON public.despacho_coverage_transitions FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.detect_despacho_coverage_recovery()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE c record; v_rows int; v_flipped int := 0;
BEGIN
  FOR c IN SELECT * FROM public.despacho_coverage WHERE publishes = false LOOP
    SELECT count(*) INTO v_rows
      FROM public.work_item_acts a
      JOIN public.work_items w ON w.id = a.work_item_id
     WHERE left(regexp_replace(COALESCE(w.radicado,''), '\D', '', 'g'), length(c.radicado_prefix)) = c.radicado_prefix
       AND COALESCE(a.source,'') <> 'email'
       AND COALESCE(a.is_archived,false) = false
       AND a.created_at > c.updated_at;
    IF v_rows > 0 THEN
      UPDATE public.despacho_coverage SET publishes = true, updated_at = now() WHERE id = c.id;
      INSERT INTO public.despacho_coverage_transitions
        (radicado_prefix, provider_key, from_publishes, to_publishes, evidence)
      VALUES (c.radicado_prefix, c.provider_key, false, true,
              jsonb_build_object('provider_rows_since', c.updated_at, 'row_count', v_rows));
      v_flipped := v_flipped + 1;
      RAISE NOTICE 'coverage gap cleared for % (%): % provider rows', c.radicado_prefix, c.provider_key, v_rows;
    END IF;
  END LOOP;
  RETURN v_flipped;
END;
$$;

-- ---- A1/A2/A3: email effects, rewritten under source primacy ----
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
BEGIN
  SELECT * INTO l FROM public.work_item_email_links WHERE id = p_link_id;
  IF NOT FOUND OR l.link_status <> 'CONFIRMED' THEN
    RETURN jsonb_build_object('skipped','not_confirmed');
  END IF;

  SELECT * INTO wi FROM public.work_items WHERE id = l.work_item_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('skipped','no_work_item'); END IF;

  v_gap := public.despacho_has_coverage_gap(wi.radicado);

  IF l.evidence_type = 'SGDE_ACCESO_EXPEDIENTE' THEN
    INSERT INTO public.work_item_email_link_effects
      (link_id, work_item_id, user_id, organization_id, effect_type, target_table, target_id, label)
    VALUES (l.id, l.work_item_id, l.user_id, l.organization_id, 'EXPEDIENTE_LINK_OFFERED', NULL, NULL,
            'Enlace de expediente ofrecido')
    ON CONFLICT DO NOTHING;
  END IF;

  -- ITER19 A1: observed instance shift no longer suggests a stage — informational only.
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
    'source_primacy', CASE WHEN v_gap THEN 'EMAIL_COVERAGE_GAP' ELSE 'EMAIL_SECONDARY' END,
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
                                             'exception','HEARING_CITATION_ITER19',
                                             'nij', l.evidence_meta->>'nij',
                                             'ai_classified', COALESCE(l.ai_classified,false)))
        ON CONFLICT (work_item_id, deadline_type, trigger_date) DO NOTHING
        RETURNING id INTO v_aud_id;
        v_aud_created := v_aud_id IS NOT NULL;
      END IF;

      -- canonical hearing record (suggestion until confirmed)
      IF v_aud_ts IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.work_item_hearings
         WHERE work_item_id = l.work_item_id AND scheduled_at = v_aud_ts
      ) THEN
        INSERT INTO public.work_item_hearings
          (organization_id, work_item_id, custom_name, scheduled_at, auto_detected, status,
           extraction_method, discovery_type, notes_plain_text)
        VALUES (wi.organization_id, l.work_item_id,
                'Audiencia (según correo del despacho)', v_aud_ts, true,
                CASE WHEN v_aud_ts > now() THEN 'scheduled' ELSE 'held' END,
                'email_citacion_iter19',
                CASE WHEN v_aud_ts > now() THEN 'NOVEDAD' ELSE 'HISTORICO_DETECTADO' END,
                'Fecha tomada de un correo del despacho: ' || COALESCE(l.subject,'(sin asunto)'))
        RETURNING id INTO v_hearing_id;
      END IF;

      IF v_aud_id IS NOT NULL OR v_hearing_id IS NOT NULL THEN
        INSERT INTO public.work_item_email_link_effects
          (link_id, work_item_id, user_id, organization_id, effect_type, target_table, target_id, label)
        VALUES (l.id, l.work_item_id, l.user_id, l.organization_id, 'HEARING_SUGGESTED',
                'work_item_hearings', v_hearing_id,
                'Audiencia según correo del despacho: ' || to_char(v_aud_date, 'DD/MM/YYYY'))
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END IF;

  -- ---- corroboration of an EXISTING term always allowed (does not create state) ----
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
    ELSIF v_gap THEN
      -- A3(i) EXCEPTION: no provider publishes for this despacho — email is substantive.
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
                'Fuente: correo (despacho sin publicación en proveedores). '
                  || COALESCE(l.subject,'(sin asunto)'),
                'EMAIL_' || l.evidence_subtype, v_trigger, r.deadline_date, r.days_amount,
                'SUGGESTED_BY_EMAIL',
                v_meta || jsonb_build_object('day_type', r.day_type, 'norma', r.norma,
                          'exception','COVERAGE_GAP_ITER19',
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
                'Fuente: correo (despacho sin publicación en proveedores) — '
                  || public.email_subtype_label(l.evidence_subtype))
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END IF;

  -- ---- A3(i): under a coverage gap the email also lands as an actuación ----
  IF v_gap THEN
    INSERT INTO public.work_item_acts
      (owner_id, organization_id, work_item_id, act_date, description, act_type,
       source, source_reference, hash_fingerprint, workflow_type, raw_data)
    VALUES (wi.owner_id, wi.organization_id, l.work_item_id, v_trigger,
            'Fuente: correo (despacho sin publicación en proveedores) — '
              || COALESCE(l.subject,'(sin asunto)'),
            public.email_subtype_label(l.evidence_subtype),
            'email', COALESCE(l.internet_message_id, l.id::text),
            md5('EMAIL_ACT:' || COALESCE(l.internet_message_id, l.id::text)),
            wi.workflow_type::text,
            jsonb_build_object('email_link_id', l.id, 'coverage_gap', true,
                               'marker','Fuente: correo (despacho sin publicación en proveedores)'))
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_act_id;
  END IF;

  -- ---- A1: stage. Provider primacy — email only suggests under a coverage gap ----
  IF v_stage IS NOT NULL AND COALESCE(wi.stage,'') <> v_stage THEN
    IF v_gap THEN
      v_fp := 'EMAIL_GAP:' || COALESCE(l.internet_message_id, l.id::text) || ':' || l.evidence_subtype;
      v_reason := 'Fuente: correo (despacho sin publicación en proveedores) — '
                  || public.email_subtype_label(l.evidence_subtype)
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
  ELSIF v_dl_type IS NOT NULL AND NOT v_gap AND v_deadline_id IS NULL
        AND l.evidence_subtype <> 'CITACION_AUDIENCIA' THEN
    INSERT INTO public.work_item_email_link_effects
      (link_id, work_item_id, user_id, organization_id, effect_type, target_table, target_id, label)
    VALUES (l.id, l.work_item_id, l.user_id, l.organization_id, 'NOTICIA_INFORMATIVA', NULL, NULL,
            'Según correo del despacho, ' || public.email_subtype_label(l.evidence_subtype)
              || '. Verifíquelo en el expediente.')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN jsonb_build_object('coverage_gap', v_gap,
                            'deadline_id', v_deadline_id, 'deadline_created', v_created_deadline,
                            'deadline_skipped_fulfilled', v_skipped_fulfilled,
                            'audiencia_deadline_id', v_aud_id, 'audiencia_created', v_aud_created,
                            'hearing_id', v_hearing_id, 'act_id', v_act_id,
                            'stage_suggestion_id', v_sugg_id, 'stage_created', v_created_stage);
END;
$function$;

-- ---- A1 migration: retire email-produced procedural state ----
UPDATE public.work_item_stage_suggestions s
   SET status = 'DISMISSED',
       dismiss_reason = 'FUENTE_SECUNDARIA_ITER19',
       updated_at = now()
  FROM public.work_items w
 WHERE w.id = s.work_item_id
   AND s.status = 'PENDING'
   AND s.source_type = 'EMAIL'
   AND public.despacho_has_coverage_gap(w.radicado) = false;

UPDATE public.work_item_deadlines d
   SET status = 'DISMISSED',
       calculation_meta = COALESCE(d.calculation_meta,'{}'::jsonb)
         || jsonb_build_object('dismiss_reason','FUENTE_SECUNDARIA_ITER19'),
       updated_at = now()
  FROM public.work_items w
 WHERE w.id = d.work_item_id
   AND d.status = 'SUGGESTED_BY_EMAIL'
   AND d.deadline_type <> 'AUDIENCIA'
   AND public.despacho_has_coverage_gap(w.radicado) = false;

-- coverage recovery detector runs daily
DO $$
BEGIN
  PERFORM cron.unschedule('despacho-coverage-recovery-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule('despacho-coverage-recovery-daily', '50 6 * * *',
  $$SELECT public.detect_despacho_coverage_recovery();$$);