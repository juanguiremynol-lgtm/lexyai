-- ============================================================
-- ITERATION 11 — RECHAZO_PRESUNTO / VENCIDO_SIN_SUBSANAR false positives
-- ============================================================

-- 1. Canonical stage ordering ------------------------------------------------
CREATE OR REPLACE FUNCTION public.stage_rank(p_stage text)
RETURNS int
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE upper(COALESCE(p_stage,''))
    WHEN 'DRAFTED' THEN 0
    WHEN 'RADICACION' THEN 10
    WHEN 'RADICADO' THEN 10
    WHEN 'DEMANDA_RADICADA' THEN 10
    WHEN 'DEMANDA_POR_RADICAR' THEN 5
    WHEN 'TUTELA_RADICADA' THEN 10
    WHEN 'ADMISION_PENDIENTE' THEN 12
    WHEN 'PENDING_AUTO_ADMISORIO' THEN 12
    WHEN 'SUBSANACION' THEN 15
    WHEN 'RADICADO_CONFIRMED' THEN 15
    WHEN 'ADMISION' THEN 20
    WHEN 'AUTO_ADMISORIO' THEN 20
    WHEN 'TUTELA_ADMITIDA' THEN 20
    WHEN 'NOTIFICACION' THEN 30
    WHEN 'NOTIFICACION_TRASLADOS' THEN 30
    WHEN 'CONTESTACION' THEN 40
    WHEN 'TRASLADO_DEMANDA' THEN 40
    WHEN 'TRASLADO_EXCEPCIONES' THEN 42
    WHEN 'EXCEPCIONES_PREVIAS' THEN 42
    WHEN 'REQUERIMIENTOS_TRASLADOS' THEN 44
    WHEN 'SANEAMIENTO' THEN 50
    WHEN 'CUADERNO' THEN 50
    WHEN 'AUDIENCIA_INICIAL' THEN 60
    WHEN 'AUDIENCIA_PRUEBAS' THEN 62
    WHEN 'AUDIENCIA_INSTRUCCION' THEN 62
    WHEN 'ALEGATOS_SENTENCIA' THEN 70
    WHEN 'SENTENCIA' THEN 72
    WHEN 'FALLO_PRIMERA_INSTANCIA' THEN 72
    WHEN 'RECURSOS' THEN 80
    WHEN 'SEGUNDA_INSTANCIA' THEN 82
    WHEN 'FALLO_SEGUNDA_INSTANCIA' THEN 82
    ELSE -1
  END
$$;

COMMENT ON FUNCTION public.stage_rank(text) IS
  'Canonical procedural phase ordering. >= 20 means the demand was admitted (iteration 11 forward-progress guard).';

-- 2. Forward-progress detector ----------------------------------------------
CREATE OR REPLACE FUNCTION public.subsanacion_forward_progress(
  p_work_item_id uuid,
  p_trigger date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_acts int := 0;
  v_last_act date;
  v_pubs int := 0;
  v_last_pub date;
  v_memorial uuid;
  v_memorial_subtype text;
  v_memorial_date date;
  v_stage text;
  v_rank int;
  v_reasons text[] := '{}';
BEGIN
  IF p_work_item_id IS NULL OR p_trigger IS NULL THEN RETURN NULL; END IF;

  SELECT count(*), max(COALESCE(a.act_date, a.event_date, a.detected_at::date))
    INTO v_acts, v_last_act
  FROM public.work_item_acts a
  WHERE a.work_item_id = p_work_item_id
    AND COALESCE(a.is_archived, false) = false
    AND COALESCE(a.act_date, a.event_date, a.detected_at::date) > p_trigger;

  SELECT count(*), max(COALESCE(p.fecha_fijacion, p.published_at::date, p.detected_at::date))
    INTO v_pubs, v_last_pub
  FROM public.work_item_publicaciones p
  WHERE p.work_item_id = p_work_item_id
    AND COALESCE(p.is_archived, false) = false
    AND COALESCE(p.fecha_fijacion, p.published_at::date, p.detected_at::date) > p_trigger;

  SELECT l.id, l.memorial_subtype, (l.received_at AT TIME ZONE 'America/Bogota')::date
    INTO v_memorial, v_memorial_subtype, v_memorial_date
  FROM public.work_item_email_links l
  WHERE l.work_item_id = p_work_item_id
    AND l.direction = 'sent'
    AND l.link_status = 'CONFIRMED'
    AND l.received_at IS NOT NULL
    AND (l.received_at AT TIME ZONE 'America/Bogota')::date > p_trigger
  ORDER BY l.received_at ASC
  LIMIT 1;

  SELECT w.stage INTO v_stage FROM public.work_items w WHERE w.id = p_work_item_id;
  v_rank := public.stage_rank(v_stage);

  IF v_acts > 0 THEN v_reasons := v_reasons || 'ACTUACIONES_POSTERIORES'; END IF;
  IF v_pubs > 0 THEN v_reasons := v_reasons || 'ESTADOS_POSTERIORES'; END IF;
  IF v_memorial IS NOT NULL THEN v_reasons := v_reasons || 'MEMORIAL_ENVIADO_CONFIRMADO'; END IF;
  IF v_rank >= 20 THEN v_reasons := v_reasons || 'ETAPA_AVANZADA'; END IF;

  IF array_length(v_reasons, 1) IS NULL THEN RETURN NULL; END IF;

  RETURN jsonb_build_object(
    'reasons', to_jsonb(v_reasons),
    'actuaciones_posteriores', v_acts,
    'ultima_actuacion', v_last_act,
    'estados_posteriores', v_pubs,
    'ultimo_estado', v_last_pub,
    'memorial_link_id', v_memorial,
    'memorial_subtype', v_memorial_subtype,
    'memorial_date', v_memorial_date,
    'stage', v_stage,
    'stage_rank', v_rank,
    'evaluated_at', now()
  );
END;
$$;

-- 3. Evidence search that IGNORES link_status --------------------------------
CREATE OR REPLACE FUNCTION public.find_subsanacion_email_evidence_any_status(
  p_work_item_id uuid,
  p_from date,
  p_to date
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT l.id
  FROM public.work_item_email_links l
  WHERE l.work_item_id = p_work_item_id
    AND l.direction = 'sent'
    AND l.received_at IS NOT NULL
    AND (l.received_at AT TIME ZONE 'America/Bogota')::date
        BETWEEN COALESCE(p_from, '-infinity'::date) AND COALESCE(p_to, 'infinity'::date)
    AND (
      l.memorial_subtype = 'SUBSANACION'
      OR COALESCE(l.subject,'') ~* 'subsan'
    )
  ORDER BY l.received_at ASC
  LIMIT 1
$$;

-- 4. INADMISION classifier precision (RECHAZO_COMPETENCIA) -------------------
CREATE OR REPLACE FUNCTION public.classify_email_evidence_subtype(p_subject text, p_sender text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN NOT public.is_judicial_email_sender(p_sender) THEN NULL
    WHEN COALESCE(p_subject,'') ~* '^(respuesta autom[aá]tica|automatic reply|acuse)' THEN 'ACUSE_AUTOMATICO'
    WHEN COALESCE(p_subject,'') ~* 'token validaci[oó]n|se le ha compartido informaci[oó]n de proceso|acceso a informaci[oó]n de proceso' THEN 'ACCESO_EXPEDIENTE'
    WHEN COALESCE(p_subject,'') ~* 'acta *(de +)?reparto' THEN 'ACTA_REPARTO'
    -- Un rechazo/remisión por competencia NO es inadmisión: no abre subsanación.
    WHEN COALESCE(p_subject,'') ~* '(rechaz[a-zóo]*|remi[st][a-zóo]*|remisi[oó]n|env[ií]a|conflicto)[^.]{0,60}(de +)?competencia|competencia[^.]{0,40}(rechaz|remi)' THEN 'RECHAZO_COMPETENCIA'
    WHEN COALESCE(p_subject,'') ~* 'inadmit|inadmisi[oó]n|so pena de rechazo|t[eé]rmino para subsanar|para subsanar' THEN 'INADMISION'
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
$$;

CREATE OR REPLACE FUNCTION public.email_subtype_label(p_subtype text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE p_subtype
    WHEN 'AUTO_ADMISORIO' THEN 'Auto admisorio' WHEN 'INADMISION' THEN 'Inadmisión'
    WHEN 'RECHAZO_COMPETENCIA' THEN 'Rechazo por competencia'
    WHEN 'TRASLADO' THEN 'Traslado' WHEN 'REQUERIMIENTO' THEN 'Requerimiento'
    WHEN 'CITACION_AUDIENCIA' THEN 'Citación a audiencia' WHEN 'FALLO_SENTENCIA' THEN 'Fallo / sentencia'
    WHEN 'RECURSO_CONCEDIDO' THEN 'Recurso concedido'
    WHEN 'ACTA_REPARTO' THEN 'Acta de reparto' WHEN 'FIJACION_ESTADO' THEN 'Fijación en estado'
    WHEN 'DESISTIMIENTO' THEN 'Desistimiento' WHEN 'NOTIFICACION_PERSONAL' THEN 'Notificación personal'
    WHEN 'ACCESO_EXPEDIENTE' THEN 'Acceso a expediente' WHEN 'ACUSE_AUTOMATICO' THEN 'Acuse automático'
    ELSE 'Comunicación judicial' END
$$;

-- RECHAZO_COMPETENCIA opens no deadline and suggests no stage.
CREATE OR REPLACE FUNCTION public.email_subtype_deadline_type(p_workflow text, p_subtype text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE p_subtype
    WHEN 'AUTO_ADMISORIO' THEN CASE WHEN p_workflow = 'TUTELA' THEN NULL ELSE 'TRASLADO_DEMANDA' END
    WHEN 'INADMISION' THEN 'SUBSANACION'
    WHEN 'RECHAZO_COMPETENCIA' THEN NULL
    WHEN 'TRASLADO' THEN CASE WHEN p_workflow = 'CPACA' THEN 'TRASLADO_DEMANDA' ELSE 'CONTESTACION_DEMANDA' END
    WHEN 'FALLO_SENTENCIA' THEN CASE WHEN p_workflow = 'TUTELA' THEN 'IMPUGNACION_TUTELA' ELSE 'RECURSO_APELACION_SENTENCIA' END
    WHEN 'RECURSO_CONCEDIDO' THEN NULL
    WHEN 'REQUERIMIENTO' THEN 'RESPUESTA_REQUERIMIENTO'
    ELSE NULL
  END
$$;

-- 5. Orphan sweep -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dismiss_orphaned_evidence_deadlines()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count int := 0;
BEGIN
  WITH victims AS (
    SELECT d.id
    FROM public.work_item_deadlines d
    LEFT JOIN public.work_item_email_links l
      ON l.id = NULLIF(d.calculation_meta->'email_evidence'->>'link_id','')::uuid
    WHERE d.calculation_meta->'email_evidence'->>'link_id' IS NOT NULL
      AND d.status NOT IN ('DISMISSED','CANCELLED','FULFILLED','MET','FULFILLED_BY_EMAIL_EVIDENCE')
      AND (l.id IS NULL OR l.link_status = 'DISMISSED')
  ), upd AS (
    UPDATE public.work_item_deadlines d
    SET status = 'DISMISSED',
        notes = COALESCE(d.notes,'') || ' [EVIDENCIA_REVOCADA] El correo que originó este término fue descartado.',
        calculation_meta = COALESCE(d.calculation_meta,'{}'::jsonb) || jsonb_build_object(
          'dismissal', jsonb_build_object('reason','EVIDENCIA_REVOCADA','at', now())
        )
    FROM victims v
    WHERE d.id = v.id
    RETURNING d.id
  )
  SELECT count(*) INTO v_count FROM upd;

  RETURN jsonb_build_object('dismissed', v_count, 'reason','EVIDENCIA_REVOCADA','run_at', now());
END;
$$;

-- 6. Rewritten presumed-rejection rule with the forward-progress guard --------
CREATE OR REPLACE FUNCTION public.apply_rechazo_presunto_rule(p_work_item_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Bogota')::date;
  d record;
  v_evidence uuid;
  v_email_evidence uuid;
  v_progress jsonb;
  v_rechazo uuid;
  v_rechazo_date date;
  v_wi record;
  v_fulfilled int := 0;
  v_fulfilled_email int := 0;
  v_descartada int := 0;
  v_presunto int := 0;
  v_confirmado int := 0;
  v_examined int := 0;
  v_text text;
BEGIN
  FOR d IN
    SELECT * FROM public.work_item_deadlines
    WHERE deadline_type = 'SUBSANACION'
      AND deadline_date < v_today
      AND status NOT IN ('MET','FULFILLED','CANCELLED','DISMISSED','FULFILLED_BY_EMAIL_EVIDENCE','PRESUNCION_DESCARTADA_POR_AVANCE')
      AND (p_work_item_id IS NULL OR work_item_id = p_work_item_id)
  LOOP
    v_examined := v_examined + 1;
    SELECT * INTO v_wi FROM public.work_items WHERE id = d.work_item_id;
    IF NOT FOUND THEN CONTINUE; END IF;

    -- (a) Subsanación visible in the judicial record.
    v_evidence := public.find_subsanacion_evidence_act(d.work_item_id, d.trigger_date, d.deadline_date + 3);
    IF v_evidence IS NOT NULL THEN
      UPDATE public.work_item_deadlines
      SET status = 'FULFILLED',
          met_at = COALESCE(met_at, now()),
          notes = COALESCE(notes,'') || ' [Regla rechazo presunto] Evidencia de memorial de subsanación detectada en el expediente.',
          calculation_meta = COALESCE(calculation_meta,'{}'::jsonb) || jsonb_build_object(
            'subsanacion_rule', jsonb_build_object(
              'outcome','FULFILLED','evidence_act_id', v_evidence,'evaluated_at', now()))
      WHERE id = d.id;
      DELETE FROM public.atenia_ai_observations
       WHERE kind IN ('RECHAZO_PRESUNTO','RECHAZO_CONFIRMADO') AND links->>'deadline_id' = d.id::text;
      v_fulfilled := v_fulfilled + 1;
      CONTINUE;
    END IF;

    -- (b) Subsanación por correo — IGNORANDO link_status (iteración 11).
    v_email_evidence := public.find_subsanacion_email_evidence_any_status(
      d.work_item_id, d.trigger_date, d.deadline_date + 60);
    IF v_email_evidence IS NULL THEN
      v_email_evidence := public.find_email_memorial_evidence(d.work_item_id, d.trigger_date, d.deadline_date + 3);
    END IF;

    IF v_email_evidence IS NOT NULL THEN
      UPDATE public.work_item_deadlines
      SET status = 'FULFILLED_BY_EMAIL_EVIDENCE',
          met_at = COALESCE(met_at, now()),
          calculation_meta = COALESCE(calculation_meta,'{}'::jsonb) || jsonb_build_object(
            'subsanacion_rule', jsonb_build_object(
              'outcome','FULFILLED_BY_EMAIL_EVIDENCE','email_link_id', v_email_evidence,
              'link_status_ignored', true,'evaluated_at', now()))
      WHERE id = d.id;
      DELETE FROM public.atenia_ai_observations
       WHERE kind IN ('RECHAZO_PRESUNTO','RECHAZO_CONFIRMADO') AND links->>'deadline_id' = d.id::text;
      v_fulfilled_email := v_fulfilled_email + 1;
      CONTINUE;
    END IF;

    -- (c) GUARDA DE AVANCE PROCESAL — decisiva.
    v_progress := public.subsanacion_forward_progress(d.work_item_id, d.trigger_date);
    IF v_progress IS NOT NULL THEN
      UPDATE public.work_item_deadlines
      SET status = 'PRESUNCION_DESCARTADA_POR_AVANCE',
          notes = COALESCE(notes,'') || ' [Iteración 11] Presunción de rechazo descartada: el proceso avanzó después del auto inadmisorio.',
          calculation_meta = COALESCE(calculation_meta,'{}'::jsonb) || jsonb_build_object(
            'subsanacion_rule', jsonb_build_object(
              'outcome','PRESUNCION_DESCARTADA_POR_AVANCE','forward_progress', v_progress,
              'evaluated_at', now()))
      WHERE id = d.id;

      DELETE FROM public.atenia_ai_observations
       WHERE kind IN ('RECHAZO_PRESUNTO','RECHAZO_CONFIRMADO') AND links->>'deadline_id' = d.id::text;
      UPDATE public.work_item_stage_suggestions
         SET status = 'DISMISSED'
       WHERE event_fingerprint = 'RECHAZO_PRESUNTO:' || d.id::text AND status = 'PENDING';

      v_descartada := v_descartada + 1;
      CONTINUE;
    END IF;

    -- (d) Sin evidencia y sin avance: hipótesis a verificar.
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
            'ventana_ausencia_evidencia', jsonb_build_object('desde', d.trigger_date, 'hasta', d.deadline_date + 60),
            'auto_rechazo_act_id', v_rechazo,
            'auto_rechazo_date', v_rechazo_date,
            'forward_progress_checked', true,
            'evaluated_at', now()))
    WHERE id = d.id;

    v_text := 'Posible rechazo presunto — verificar en el expediente. Demanda inadmitida el '
      || to_char(d.trigger_date,'DD/MM/YYYY')
      || '; el término de subsanación venció el ' || to_char(d.deadline_date,'DD/MM/YYYY')
      || '. Entre el ' || to_char(d.trigger_date,'DD/MM/YYYY') || ' y el '
      || to_char(d.deadline_date + 60,'DD/MM/YYYY')
      || ' no se detectó escrito de subsanación (ni en el expediente ni en el correo, incluidos vínculos descartados) '
      || 'ni actuación, estado o etapa posterior al auto inadmisorio. Es una hipótesis: confirme en el expediente antes de actuar.';

    IF v_rechazo IS NULL THEN
      v_presunto := v_presunto + 1;
    ELSE
      v_confirmado := v_confirmado + 1;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.atenia_ai_observations o
      WHERE o.kind IN ('RECHAZO_PRESUNTO','RECHAZO_CONFIRMADO')
        AND o.links->>'deadline_id' = d.id::text
    ) THEN
      INSERT INTO public.atenia_ai_observations (organization_id, kind, severity, title, payload, links)
      VALUES (
        v_wi.organization_id,
        CASE WHEN v_rechazo IS NULL THEN 'RECHAZO_PRESUNTO' ELSE 'RECHAZO_CONFIRMADO' END,
        'WARNING',
        CASE WHEN v_rechazo IS NULL
             THEN 'Posible rechazo presunto — verificar en el expediente — ' || COALESCE(v_wi.radicado, v_wi.title, 'expediente')
             ELSE 'Rechazo confirmado — ' || COALESCE(v_wi.radicado, v_wi.title, 'expediente') END,
        jsonb_build_object('mensaje', v_text, 'inadmisorio_date', d.trigger_date,
                           'vencimiento_date', d.deadline_date, 'radicado', v_wi.radicado,
                           'auto_rechazo_act_id', v_rechazo, 'auto_rechazo_date', v_rechazo_date,
                           'requiere_verificacion', true),
        jsonb_build_object('work_item_id', d.work_item_id, 'deadline_id', d.id)
      );
    END IF;
    -- Iteración 11: la presunción NUNCA sugiere ni cambia etapa.
  END LOOP;

  RETURN jsonb_build_object(
    'run_at', now(),
    'examined', v_examined,
    'fulfilled_by_evidence', v_fulfilled,
    'fulfilled_by_email_evidence', v_fulfilled_email,
    'presuncion_descartada_por_avance', v_descartada,
    'rechazo_presunto', v_presunto,
    'rechazo_confirmado', v_confirmado
  );
END;
$$;