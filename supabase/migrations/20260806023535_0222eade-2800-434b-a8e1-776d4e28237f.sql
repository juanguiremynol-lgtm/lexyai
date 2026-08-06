CREATE OR REPLACE FUNCTION public.refresh_estados_coverage_signals(p_alert boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  wi record;
  j jsonb;
  v_counts jsonb := jsonb_build_object(
    'CUBIERTO',0,'ESTADOS_ESPERADOS_AUSENTES',0,'ESTADOS_SIN_FIJACION_CONOCIDA',0,
    'SIN_COBERTURA_DECLARADA',0,'SIN_COBERTURA_EN_ESA_FECHA',0,'ESTADO_SIN_DOCUMENTO',0,
    'REMITIDO_A_SUPERIOR',0);
  v_class text;
  v_total int := 0;
  v_alerts int := 0;
  v_remisiones int := 0;
  v_recent int := 0;
  v_alertable int := 0;
  v_remision date;
  v_fp text;
  v_fp_rem text;
BEGIN
  FOR wi IN
    SELECT w.id, w.owner_id, w.organization_id, w.radicado, w.authority_name, w.workflow_type
      FROM public.work_items w
     WHERE w.lifecycle_state = 'ACTIVE'
       AND w.monitoring_enabled IS TRUE
       AND COALESCE(w.radicado,'') <> ''
       AND public.is_provider_monitored_workflow(w.workflow_type::text)
  LOOP
    j := public.classify_work_item_estados_signal(wi.id);
    CONTINUE WHEN j IS NULL;
    v_class := j->>'signal_class';
    v_recent := COALESCE((j->>'recent_unmatched_count')::int, 0);
    v_alertable := COALESCE((j->>'alertable_unmatched_count')::int, 0);
    v_remision := NULLIF(j->>'remision_date','')::date;
    v_total := v_total + 1;
    v_counts := jsonb_set(v_counts, ARRAY[v_class],
      to_jsonb(COALESCE((v_counts->>v_class)::int,0) + 1));

    INSERT INTO public.work_item_estados_signal AS s (
      work_item_id, organization_id, workflow_type, radicado, despacho, signal_class,
      estados_provider, acts_count, pubs_count, fijacion_count, unmatched_fijacion_count,
      recent_unmatched_count, out_of_window_count, sin_documento_count,
      remitido_count, remision_date,
      alertable_unmatched_count, last_fijacion_date, evidence, computed_at)
    VALUES (
      wi.id, wi.organization_id, j->>'workflow_type', j->>'radicado', j->>'despacho', v_class,
      j->>'estados_provider', (j->>'acts_count')::int, (j->>'pubs_count')::int,
      (j->>'fijacion_count')::int, (j->>'unmatched_fijacion_count')::int, v_recent,
      (j->>'out_of_window_count')::int, (j->>'sin_documento_count')::int,
      COALESCE((j->>'remitido_count')::int, 0), v_remision,
      v_alertable, NULLIF(j->>'last_fijacion_date','')::date, j->'evidence', now())
    ON CONFLICT (work_item_id) DO UPDATE SET
      organization_id = EXCLUDED.organization_id,
      workflow_type = EXCLUDED.workflow_type,
      radicado = EXCLUDED.radicado,
      despacho = EXCLUDED.despacho,
      signal_class = EXCLUDED.signal_class,
      estados_provider = EXCLUDED.estados_provider,
      acts_count = EXCLUDED.acts_count,
      pubs_count = EXCLUDED.pubs_count,
      fijacion_count = EXCLUDED.fijacion_count,
      unmatched_fijacion_count = EXCLUDED.unmatched_fijacion_count,
      recent_unmatched_count = EXCLUDED.recent_unmatched_count,
      out_of_window_count = EXCLUDED.out_of_window_count,
      sin_documento_count = EXCLUDED.sin_documento_count,
      remitido_count = EXCLUDED.remitido_count,
      remision_date = EXCLUDED.remision_date,
      alertable_unmatched_count = EXCLUDED.alertable_unmatched_count,
      last_fijacion_date = EXCLUDED.last_fijacion_date,
      evidence = EXCLUDED.evidence,
      computed_at = now();

    v_fp := 'estados_ausentes_' || wi.id::text;
    v_fp_rem := 'remision_expediente_' || wi.id::text;

    IF p_alert AND v_class = 'ESTADOS_ESPERADOS_AUSENTES' AND v_recent > 0 AND v_alertable > 0 THEN
      IF NOT EXISTS (SELECT 1 FROM public.alert_instances ai WHERE ai.fingerprint = v_fp AND ai.status = 'PENDING') THEN
        INSERT INTO public.alert_instances (
          owner_id, organization_id, entity_id, entity_type, severity, alert_type,
          title, message, status, fingerprint, payload)
        VALUES (
          wi.owner_id, wi.organization_id, wi.id, 'WORK_ITEM', 'WARNING',
          'BRECHA_COBERTURA_ESTADOS',
          'Estados esperados y ausentes: ' || COALESCE(NULLIF(trim(wi.authority_name),''), 'despacho sin identificar'),
          'El expediente ' || COALESCE(wi.radicado,'') || ' registra ' || v_alertable ||
            ' fijación(es) en estado en las actuaciones sin la publicación correspondiente. Despacho: ' ||
            COALESCE(NULLIF(trim(wi.authority_name),''), 'sin identificar') || '.',
          'PENDING', v_fp,
          jsonb_build_object('signal_class', v_class, 'recent_unmatched', v_recent,
                             'alertable_unmatched', v_alertable,
                             'estados_provider', j->>'estados_provider'))
        ON CONFLICT (fingerprint) DO UPDATE SET
          status = 'PENDING', resolved_at = NULL,
          message = EXCLUDED.message, payload = EXCLUDED.payload;
        v_alerts := v_alerts + 1;
      END IF;
    ELSE
      UPDATE public.alert_instances
         SET status = 'RESOLVED', resolved_at = now()
       WHERE fingerprint = v_fp AND status = 'PENDING';
    END IF;

    -- The remisión sentinel fires on the remisión itself, not on the silence
    -- that follows it: the lawyer must know the file changed hands immediately.
    IF p_alert AND v_remision IS NOT NULL AND v_remision >= (CURRENT_DATE - 120) THEN
      IF NOT EXISTS (SELECT 1 FROM public.alert_instances ai WHERE ai.fingerprint = v_fp_rem AND ai.status = 'PENDING') THEN
        INSERT INTO public.alert_instances (
          owner_id, organization_id, entity_id, entity_type, severity, alert_type,
          title, message, status, fingerprint, payload)
        VALUES (
          wi.owner_id, wi.organization_id, wi.id, 'WORK_ITEM', 'INFO',
          'REMISION_EXPEDIENTE',
          'Expediente remitido a otro despacho',
          'El expediente ' || COALESCE(wi.radicado,'') || ' registra una remisión el ' ||
            to_char(v_remision, 'DD/MM/YYYY') ||
            '. Las actuaciones y estados posteriores corresponden al despacho receptor, no a ' ||
            COALESCE(NULLIF(trim(wi.authority_name),''), 'el despacho de origen') ||
            '. Verifique el nuevo radicado para reanudar el monitoreo.',
          'PENDING', v_fp_rem,
          jsonb_build_object('remision_date', v_remision,
                             'remision_description', j->>'remision_description',
                             'fijaciones_posteriores', j->>'remitido_count',
                             'signal_class', v_class))
        ON CONFLICT (fingerprint) DO UPDATE SET
          status = 'PENDING', resolved_at = NULL,
          message = EXCLUDED.message, payload = EXCLUDED.payload;
        v_remisiones := v_remisiones + 1;
      END IF;
    ELSE
      UPDATE public.alert_instances
         SET status = 'RESOLVED', resolved_at = now()
       WHERE fingerprint = v_fp_rem AND status = 'PENDING';
    END IF;
  END LOOP;

  RETURN jsonb_build_object('evaluated', v_total, 'counts', v_counts,
                            'alerts_created', v_alerts, 'remisiones_detectadas', v_remisiones);
END;
$fn$;