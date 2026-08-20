-- ═══ P0-B.1 CANONICAL VIEWS ═══
CREATE OR REPLACE VIEW public.v_live_work_items AS
  SELECT * FROM public.work_items WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW public.v_monitored_work_items AS
  SELECT * FROM public.work_items
  WHERE deleted_at IS NULL
    AND monitoring_enabled = true
    AND monitoring_suspended_at IS NULL;

ALTER VIEW public.v_live_work_items      SET (security_invoker = true);
ALTER VIEW public.v_monitored_work_items SET (security_invoker = true);

GRANT SELECT ON public.v_live_work_items      TO anon, authenticated, service_role;
GRANT SELECT ON public.v_monitored_work_items TO anon, authenticated, service_role;

-- ═══ P0-B.2 (1/8) atenia_get_missing_sync_coverage → v_monitored_work_items ═══
CREATE OR REPLACE FUNCTION public.atenia_get_missing_sync_coverage()
 RETURNS TABLE(total_monitored bigint, attempted_24h bigint, missing_attempts bigint, coverage_pct numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH monitored AS (
    SELECT id FROM public.v_monitored_work_items
  ),
  attempted AS (
    SELECT DISTINCT st.work_item_id
    FROM sync_traces st
    JOIN monitored m ON m.id = st.work_item_id
    WHERE st.created_at > now() - interval '24 hours'
  )
  SELECT
    (SELECT count(*) FROM monitored)::bigint AS total_monitored,
    (SELECT count(*) FROM attempted)::bigint AS attempted_24h,
    ((SELECT count(*) FROM monitored) - (SELECT count(*) FROM attempted))::bigint AS missing_attempts,
    CASE
      WHEN (SELECT count(*) FROM monitored) = 0 THEN 100.0
      ELSE round((SELECT count(*) FROM attempted)::numeric / (SELECT count(*) FROM monitored)::numeric * 100, 1)
    END AS coverage_pct;
$function$;

-- ═══ P0-B.2 (2/8) detect_stale_monitoring → v_monitored_work_items ═══
CREATE OR REPLACE FUNCTION public.detect_stale_monitoring(p_threshold_days integer DEFAULT 45)
 RETURNS TABLE(work_item_id uuid, radicado text, reason text, days_since_ingest integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  v_day TEXT := to_char(now() AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD');
  v_reason TEXT;
  v_title TEXT;
  v_explained boolean;
BEGIN
  FOR r IN
    SELECT mc.* FROM public.monitoring_coverage_v mc
    -- P0-B.2: canonical monitored source. Deleted / suspended items are invisible here.
    JOIN public.v_monitored_work_items m ON m.id = mc.work_item_id
    WHERE mc.monitoring_enabled
      AND public.is_provider_monitored_workflow(mc.workflow_type)
      AND (
        mc.coverage_status IN ('SIN_ENROLAMIENTO', 'ENROLAMIENTO_PARCIAL', 'SIN_RADICADO_VALIDO')
        OR mc.last_ingest IS NULL
        OR mc.last_ingest < now() - make_interval(days => p_threshold_days)
      )
  LOOP
    SELECT bool_and(public.despacho_silence_note(r.radicado, r.workflow_type, p) IS NOT NULL)
      INTO v_explained
      FROM unnest(public.provider_chain_for_workflow(r.workflow_type)) p
     WHERE public.provider_scope(p) = 'ACTS';
    IF COALESCE(v_explained, false) THEN
      CONTINUE;
    END IF;

    IF r.coverage_status = 'SIN_ENROLAMIENTO' OR r.coverage_status = 'SIN_RADICADO_VALIDO' THEN
      v_reason := r.coverage_status;
      v_title := 'Proceso monitoreado sin proveedor activo';
    ELSIF r.coverage_status = 'ENROLAMIENTO_PARCIAL' THEN
      v_reason := 'ENROLAMIENTO_PARCIAL';
      v_title := 'Cobertura incompleta de proveedores';
    ELSE
      v_reason := 'SIN_INGESTA';
      v_title := 'Sin ingesta desde ' ||
                 COALESCE(to_char(r.last_ingest AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY'), 'nunca');
    END IF;

    BEGIN
      INSERT INTO alert_instances (
        owner_id, organization_id, entity_id, entity_type,
        severity, alert_type, alert_source, title, message, status, fingerprint, payload
      ) VALUES (
        r.owner_id, r.organization_id, r.work_item_id, 'WORK_ITEM',
        'WARN'::alert_severity,
        CASE WHEN v_reason = 'SIN_INGESTA' THEN 'MONITOREO_SIN_INGESTA' ELSE 'MONITOREO_SIN_PROVEEDOR' END,
        'SISTEMA', v_title,
        'El proceso ' || COALESCE(r.radicado, '(sin radicado)') ||
        ' está monitoreado pero ' ||
        CASE WHEN v_reason = 'SIN_INGESTA'
             THEN 'no recibe filas nuevas de los proveedores hace ' || COALESCE(r.days_since_ingest, 9999) || ' días, pese a que reportan éxito.'
             ELSE 'no está inscrito con los proveedores esperados (' || array_to_string(r.missing_providers, ', ') || ').'
        END,
        'PENDING',
        build_dedupe_key('monitoreo_' || lower(v_reason), r.work_item_id::text, v_day),
        jsonb_build_object(
          'radicado', r.radicado, 'reason', v_reason,
          'days_since_ingest', r.days_since_ingest,
          'last_ingest', r.last_ingest, 'last_ok_run', r.last_ok_run,
          'expected_providers', r.expected_providers,
          'enrolled_providers', r.enrolled_providers,
          'missing_providers', r.missing_providers
        )
      ) ON CONFLICT (fingerprint) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[detect_stale_monitoring] alert insert failed: %', SQLERRM;
    END;

    work_item_id := r.work_item_id;
    radicado := r.radicado;
    reason := v_reason;
    days_since_ingest := COALESCE(r.days_since_ingest, 9999);
    RETURN NEXT;
  END LOOP;
END $function$;

-- ═══ P0-B.2 (3/8) age_out_pending_review_deadlines → v_live_work_items ═══
CREATE OR REPLACE FUNCTION public.age_out_pending_review_deadlines()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count INTEGER;
BEGIN
  WITH aged AS (
    UPDATE public.work_item_deadlines d
    SET status = 'HISTORICAL_BACKFILL',
        calculation_meta = COALESCE(calculation_meta, '{}'::jsonb) || jsonb_build_object(
          'aged_out_at', now(),
          'aged_out_rule', 'PENDING_REVIEW_30D_AGING'
        )
    WHERE d.status = 'PENDING_REVIEW'
      AND d.deadline_date IS NOT NULL
      AND d.deadline_date < (CURRENT_DATE - INTERVAL '30 days')::date
      -- P0-B.2: never touch deadlines of soft-deleted matters.
      AND EXISTS (SELECT 1 FROM public.v_live_work_items w WHERE w.id = d.work_item_id)
    RETURNING 1
  )
  SELECT count(*)::INTEGER INTO v_count FROM aged;
  RETURN v_count;
END;
$function$;

-- ═══ P0-B.2 (4/8) detect_despacho_coverage_recovery → v_live_work_items ═══
CREATE OR REPLACE FUNCTION public.detect_despacho_coverage_recovery()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c record; v_rows int; v_flipped int := 0;
BEGIN
  FOR c IN SELECT * FROM public.despacho_coverage WHERE publishes = false LOOP
    SELECT count(*) INTO v_rows
      FROM public.work_item_acts a
      -- P0-B.2: canonical live source.
      JOIN public.v_live_work_items w ON w.id = a.work_item_id
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
$function$;

-- ═══ P0-B.2 (5/8) emit_appellate_blindspot_alerts → v_live_work_items ═══
CREATE OR REPLACE FUNCTION public.emit_appellate_blindspot_alerts()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb; item jsonb; v_created int := 0; v_cancelled int := 0; v_fp text;
  v_open jsonb := '[]'::jsonb;
BEGIN
  v := public.portfolio_appellate_blindspots();
  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(v->'items','[]'::jsonb)) LOOP
    -- P0-B.2: soft-deleted matters must never reach a procedural alert.
    IF NOT EXISTS (
      SELECT 1 FROM public.v_live_work_items w
       WHERE w.id = NULLIF(item->>'work_item_id','')::uuid
    ) THEN
      CONTINUE;
    END IF;

    v_fp := 'appellate_blindspot_' || (item->>'work_item_id');
    v_open := v_open || to_jsonb(v_fp);
    IF NOT EXISTS (
      SELECT 1 FROM public.alert_instances
       WHERE fingerprint = v_fp AND status IN ('PENDING','SENT','ACKNOWLEDGED')
    ) THEN
      INSERT INTO public.alert_instances (
        owner_id, organization_id, entity_id, entity_type, severity, alert_type,
        status, title, message, fingerprint, payload
      ) VALUES (
        (item->>'owner_id')::uuid,
        NULLIF(item->>'organization_id','')::uuid,
        (item->>'work_item_id')::uuid,
        'WORK_ITEM','WARNING','ACTIVIDAD_EN_SUPERIOR_NO_VISIBLE','PENDING',
        'Apelación en el superior: la fuente de estados no cubre esa actividad',
        'El expediente ' || COALESCE(item->>'radicado','') || ' fue enviado al superior el '
          || COALESCE(item->>'apelacion_date','(sin fecha)') || ' y desde entonces la fuente de estados no ha entregado ninguna publicación ('
          || COALESCE(item->>'dias_sin_estados','?') || ' días). La fuente deriva el despacho del radicado, de modo que la actividad en segunda instancia no es visible por esta vía: revísela directamente en el despacho de segunda instancia.',
        v_fp,
        jsonb_build_object(
          'signal_class','APELACION_EN_SUPERIOR',
          'apelacion_date', item->>'apelacion_date',
          'dias_sin_estados', item->>'dias_sin_estados',
          'despacho_origen', item->>'despacho_origen',
          'estados_provider', item->>'estados_provider',
          'radicado', item->>'radicado')
      );
      v_created := v_created + 1;
    END IF;
  END LOOP;

  UPDATE public.alert_instances a
     SET status = 'RESOLVED', resolved_at = now()
   WHERE a.alert_type = 'ACTIVIDAD_EN_SUPERIOR_NO_VISIBLE'
     AND a.status IN ('PENDING','SENT','ACKNOWLEDGED')
     AND NOT (to_jsonb(a.fingerprint) <@ v_open)
     -- P0-B.2 / C1: alerts of non-live items are left exactly as they are,
     -- so narrowing visibility never resolves anything as a side effect.
     AND EXISTS (SELECT 1 FROM public.v_live_work_items w WHERE w.id = a.entity_id);
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  RETURN jsonb_build_object('created', v_created, 'retired', v_cancelled, 'open', jsonb_array_length(v_open));
END;
$function$;

-- ═══ P0-B.2 (6/8) apply_rechazo_presunto_rule → v_live_work_items ═══
CREATE OR REPLACE FUNCTION public.apply_rechazo_presunto_rule(p_work_item_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    SELECT dl.* FROM public.work_item_deadlines dl
    WHERE dl.deadline_type = 'SUBSANACION'
      AND dl.deadline_date < v_today
      AND dl.status NOT IN ('MET','FULFILLED','CANCELLED','DISMISSED','FULFILLED_BY_EMAIL_EVIDENCE','PRESUNCION_DESCARTADA_POR_AVANCE')
      AND (p_work_item_id IS NULL OR dl.work_item_id = p_work_item_id)
      -- P0-B.2: procedural consequences must never reach a soft-deleted matter.
      AND EXISTS (SELECT 1 FROM public.v_live_work_items w WHERE w.id = dl.work_item_id)
  LOOP
    v_examined := v_examined + 1;
    SELECT * INTO v_wi FROM public.v_live_work_items WHERE id = d.work_item_id;
    IF NOT FOUND THEN CONTINUE; END IF;

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
$function$;

-- ═══ P0-B.2 (7/8) sync_suggestion_alerts → v_live_work_items ═══
CREATE OR REPLACE FUNCTION public.sync_suggestion_alerts()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_updated int := 0; v_inserted int := 0; v_resolved int := 0;
BEGIN
  PERFORM set_config('app.alert_bypass_breaker', 'on', true);

  CREATE TEMP TABLE _sugg_agg ON COMMIT DROP AS
  SELECT w.id AS work_item_id, w.owner_id, w.organization_id, w.radicado,
         COALESCE(st.n,0) + COALESCE(dl.n,0) AS n
    FROM public.v_live_work_items w
    LEFT JOIN (SELECT work_item_id, count(*) n
                 FROM public.work_item_stage_suggestions
                WHERE status = 'PENDING' GROUP BY 1) st ON st.work_item_id = w.id
    LEFT JOIN (SELECT work_item_id, count(*) n
                 FROM public.work_item_deadlines
                WHERE status = 'SUGGESTED_BY_EMAIL' GROUP BY 1) dl ON dl.work_item_id = w.id
   WHERE COALESCE(w.lifecycle_state::text,'ACTIVE') NOT IN ('DELETED','ARCHIVED')
     AND w.owner_id IS NOT NULL
     AND COALESCE(st.n,0) + COALESCE(dl.n,0) > 0;

  WITH upd AS (
    UPDATE public.alert_instances a
       SET title = g.n || ' sugerencia(s) pendientes de revisión',
           message = 'Radicado ' || COALESCE(g.radicado,'—') || ' — hay cambios sugeridos sin decidir.',
           payload = COALESCE(a.payload,'{}'::jsonb)
                     || jsonb_build_object('radicado', g.radicado, 'pending_count', g.n),
           severity = 'WARNING'
      FROM _sugg_agg g
     WHERE a.alert_type = 'SUGERENCIA_PENDIENTE'
       AND a.entity_id = g.work_item_id
       AND a.status IN ('PENDING','SENT','ACKNOWLEDGED')
    RETURNING 1)
  SELECT count(*) INTO v_updated FROM upd;

  WITH ins AS (
    INSERT INTO public.alert_instances (
      owner_id, organization_id, entity_id, entity_type, severity, alert_type,
      status, title, message, payload, alert_source, fingerprint)
    SELECT g.owner_id, g.organization_id, g.work_item_id, 'WORK_ITEM', 'WARNING',
      'SUGERENCIA_PENDIENTE', 'PENDING',
      g.n || ' sugerencia(s) pendientes de revisión',
      'Radicado ' || COALESCE(g.radicado,'—') || ' — hay cambios sugeridos sin decidir.',
      jsonb_build_object('radicado', g.radicado, 'pending_count', g.n),
      'SUGGESTIONS',
      public.alert_standing_fingerprint(g.owner_id, g.work_item_id, 'SUGERENCIA_PENDIENTE')
      FROM _sugg_agg g
     WHERE NOT EXISTS (
       SELECT 1 FROM public.alert_instances a
        WHERE a.alert_type = 'SUGERENCIA_PENDIENTE'
          AND a.entity_id = g.work_item_id
          AND a.status IN ('PENDING','SENT','ACKNOWLEDGED'))
    ON CONFLICT (fingerprint) DO NOTHING
    RETURNING 1)
  SELECT count(*) INTO v_inserted FROM ins;

  WITH upd AS (
    UPDATE public.alert_instances a
       SET status = 'RESOLVED', resolved_at = now()
     WHERE a.alert_type = 'SUGERENCIA_PENDIENTE'
       AND a.status IN ('PENDING','SENT','ACKNOWLEDGED')
       AND NOT EXISTS (SELECT 1 FROM _sugg_agg g WHERE g.work_item_id = a.entity_id)
       -- P0-B.2 / C1: never resolve an alert merely because its matter became invisible.
       AND EXISTS (SELECT 1 FROM public.v_live_work_items w WHERE w.id = a.entity_id)
    RETURNING 1)
  SELECT count(*) INTO v_resolved FROM upd;

  PERFORM set_config('app.alert_bypass_breaker', 'off', true);
  RETURN jsonb_build_object('updated', v_updated, 'inserted', v_inserted, 'resolved', v_resolved);
END
$function$;

-- ═══ P0-B.2 (8/8) regenerate_doctrine_alerts → v_live_work_items ═══
CREATE OR REPLACE FUNCTION public.regenerate_doctrine_alerts()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_terms int := 0; v_hearings int := 0; v_sugg jsonb;
BEGIN
  PERFORM set_config('app.alert_bypass_breaker', 'on', true);

  WITH cand AS (
    SELECT d.id, d.owner_id, d.organization_id, d.work_item_id, d.label, d.deadline_date,
           w.radicado,
           public.business_days_between_sql(
             (now() AT TIME ZONE 'America/Bogota')::date, d.deadline_date) AS bd
      FROM public.work_item_deadlines d
      -- P0-B.2: canonical live source (no monitoring filter by design).
      JOIN public.v_live_work_items w ON w.id = d.work_item_id
     WHERE d.status = 'PENDING'
       AND d.deadline_date IS NOT NULL
       AND COALESCE(w.lifecycle_state::text,'ACTIVE') NOT IN ('DELETED','ARCHIVED')
  ), ins AS (
    INSERT INTO public.alert_instances (
      owner_id, organization_id, entity_id, entity_type, severity, alert_type,
      status, title, message, payload, alert_source)
    SELECT c.owner_id, c.organization_id, c.work_item_id, 'WORK_ITEM',
      CASE WHEN c.deadline_date < (now() AT TIME ZONE 'America/Bogota')::date THEN 'CRITICAL'
           WHEN c.bd <= 3 THEN 'CRITICAL' ELSE 'WARNING' END,
      CASE WHEN c.deadline_date < (now() AT TIME ZONE 'America/Bogota')::date THEN 'TERMINO_VENCIDO'
           WHEN c.bd <= 3 THEN 'TERMINO_CRITICO' ELSE 'TERMINO_POR_VENCER' END,
      'PENDING',
      CASE WHEN c.deadline_date < (now() AT TIME ZONE 'America/Bogota')::date
             THEN 'Término vencido: ' || c.label
           ELSE 'Término por vencer (' || c.bd || ' días hábiles): ' || c.label END,
      'Radicado ' || COALESCE(c.radicado,'—') || ' — vence ' || to_char(c.deadline_date,'DD/MM/YYYY'),
      jsonb_build_object('deadline_id', c.id, 'radicado', c.radicado,
                         'deadline_date', c.deadline_date, 'business_days', c.bd),
      'DEADLINE_ENGINE'
      FROM cand c
     WHERE c.deadline_date < (now() AT TIME ZONE 'America/Bogota')::date OR c.bd <= 8
    ON CONFLICT (fingerprint) DO NOTHING
    RETURNING 1)
  SELECT count(*) INTO v_terms FROM ins;

  WITH ins AS (
    INSERT INTO public.alert_instances (
      owner_id, organization_id, entity_id, entity_type, severity, alert_type,
      status, title, message, payload, alert_source)
    SELECT h.owner_id, h.organization_id, COALESCE(h.work_item_id, h.id), 'WORK_ITEM',
      CASE WHEN (h.scheduled_at AT TIME ZONE 'America/Bogota')::date
                = (now() AT TIME ZONE 'America/Bogota')::date THEN 'CRITICAL' ELSE 'WARNING' END,
      CASE WHEN (h.scheduled_at AT TIME ZONE 'America/Bogota')::date
                = (now() AT TIME ZONE 'America/Bogota')::date THEN 'HEARING_TODAY' ELSE 'HEARING_UPCOMING' END,
      'PENDING',
      CASE WHEN (h.scheduled_at AT TIME ZONE 'America/Bogota')::date
                = (now() AT TIME ZONE 'America/Bogota')::date
           THEN 'Audiencia hoy: ' || COALESCE(h.title,'sin título')
           ELSE 'Audiencia próxima: ' || COALESCE(h.title,'sin título') END,
      'Radicado ' || COALESCE(w.radicado,'—') || ' — '
        || to_char(h.scheduled_at AT TIME ZONE 'America/Bogota','DD/MM/YYYY HH24:MI'),
      jsonb_build_object('hearing_id', h.id, 'radicado', w.radicado,
                         'scheduled_at', h.scheduled_at),
      'HEARINGS'
      FROM public.hearings h
      LEFT JOIN public.v_live_work_items w ON w.id = h.work_item_id
     WHERE h.deleted_at IS NULL
       AND COALESCE(h.status,'SCHEDULED') NOT IN ('CANCELLED','COMPLETED')
       AND h.scheduled_at >= date_trunc('day', now() AT TIME ZONE 'America/Bogota')
       AND h.scheduled_at < date_trunc('day', now() AT TIME ZONE 'America/Bogota') + interval '8 days'
       AND h.owner_id IS NOT NULL
       AND (h.work_item_id IS NULL OR w.id IS NOT NULL)
    ON CONFLICT (fingerprint) DO NOTHING
    RETURNING 1)
  SELECT count(*) INTO v_hearings FROM ins;

  v_sugg := public.sync_suggestion_alerts();

  PERFORM set_config('app.alert_bypass_breaker', 'off', true);

  RETURN jsonb_build_object('terminos', v_terms, 'audiencias', v_hearings, 'sugerencias', v_sugg);
END
$function$;