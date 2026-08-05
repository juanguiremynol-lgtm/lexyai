ALTER TABLE public.work_item_estados_signal
  ADD COLUMN IF NOT EXISTS recent_unmatched_count integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.classify_work_item_estados_signal(p_work_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  w public.work_items%ROWTYPE;
  v_chain text[];
  v_estados_provider text;
  v_acts int := 0;
  v_pubs int := 0;
  v_fij int := 0;
  v_unmatched jsonb := '[]'::jsonb;
  v_recent int := 0;
  v_last_fij date;
  v_class text;
  v_declared boolean := false;
  r record;
BEGIN
  SELECT * INTO w FROM public.work_items WHERE id = p_work_item_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_chain := public.provider_chain_for_workflow(w.workflow_type::text);
  v_estados_provider := CASE
    WHEN 'samai_estados' = ANY(v_chain) AND w.workflow_type::text = 'CPACA' THEN 'samai_estados'
    WHEN 'publicaciones' = ANY(v_chain) THEN 'publicaciones'
    WHEN 'samai_estados' = ANY(v_chain) THEN 'samai_estados'
    ELSE NULL END;

  SELECT count(*) INTO v_acts FROM public.work_item_acts a
   WHERE a.work_item_id = p_work_item_id AND a.is_archived IS NOT TRUE;
  SELECT count(*) INTO v_pubs FROM public.work_item_publicaciones p
   WHERE p.work_item_id = p_work_item_id AND p.is_archived IS NOT TRUE;

  SELECT EXISTS (
    SELECT 1 FROM public.despacho_coverage c
     WHERE c.publishes = false
       AND c.provider_key IN ('publicaciones','samai_estados')
       AND (c.workflow_type IS NULL OR c.workflow_type = w.workflow_type::text)
       AND left(regexp_replace(COALESCE(w.radicado,''), '\D', '', 'g'), length(c.radicado_prefix)) = c.radicado_prefix
  ) INTO v_declared;

  FOR r IN
    SELECT a.id, COALESCE(a.act_date, a.event_date) AS d, a.description
      FROM public.work_item_acts a
     WHERE a.work_item_id = p_work_item_id
       AND a.is_archived IS NOT TRUE
       AND public.act_is_fijacion_estado(a.description, a.act_type)
  LOOP
    v_fij := v_fij + 1;
    IF r.d IS NOT NULL AND (v_last_fij IS NULL OR r.d > v_last_fij) THEN v_last_fij := r.d; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.work_item_publicaciones p
       WHERE p.work_item_id = p_work_item_id
         AND p.is_archived IS NOT TRUE
         AND r.d IS NOT NULL
         AND COALESCE(p.fecha_fijacion::date, p.published_at::date, p.fecha_desfijacion::date)
             BETWEEN public.sub_business_days_sql(r.d, 2) AND public.add_business_days_sql(r.d, 2)
    ) THEN
      v_unmatched := v_unmatched || jsonb_build_object(
        'act_id', r.id, 'act_date', r.d, 'description', left(COALESCE(r.description,''), 160),
        'reciente', (r.d IS NOT NULL AND r.d >= (CURRENT_DATE - 90)));
      IF r.d IS NOT NULL AND r.d >= (CURRENT_DATE - 90) THEN v_recent := v_recent + 1; END IF;
    END IF;
  END LOOP;

  IF v_declared THEN
    v_class := 'SIN_COBERTURA_DECLARADA';
  ELSIF jsonb_array_length(v_unmatched) > 0 THEN
    v_class := 'ESTADOS_ESPERADOS_AUSENTES';
  ELSIF v_acts > 0 AND v_pubs = 0 AND v_fij = 0 THEN
    v_class := 'ESTADOS_SIN_FIJACION_CONOCIDA';
  ELSE
    v_class := 'CUBIERTO';
  END IF;

  RETURN jsonb_build_object(
    'work_item_id', p_work_item_id,
    'organization_id', w.organization_id,
    'workflow_type', w.workflow_type::text,
    'radicado', w.radicado,
    'despacho', w.authority_name,
    'estados_provider', v_estados_provider,
    'signal_class', v_class,
    'acts_count', v_acts,
    'pubs_count', v_pubs,
    'fijacion_count', v_fij,
    'unmatched_fijacion_count', jsonb_array_length(v_unmatched),
    'recent_unmatched_count', v_recent,
    'last_fijacion_date', v_last_fij,
    'evidence', jsonb_build_object('unmatched_fijaciones', v_unmatched)
  );
END; $$;

CREATE OR REPLACE FUNCTION public.refresh_estados_coverage_signals(p_alert boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  wi record;
  j jsonb;
  v_counts jsonb := jsonb_build_object(
    'CUBIERTO',0,'ESTADOS_ESPERADOS_AUSENTES',0,'ESTADOS_SIN_FIJACION_CONOCIDA',0,'SIN_COBERTURA_DECLARADA',0);
  v_class text;
  v_total int := 0;
  v_alerts int := 0;
  v_recent int := 0;
  v_fp text;
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
    v_total := v_total + 1;
    v_counts := jsonb_set(v_counts, ARRAY[v_class],
      to_jsonb(COALESCE((v_counts->>v_class)::int,0) + 1));

    INSERT INTO public.work_item_estados_signal AS s (
      work_item_id, organization_id, workflow_type, radicado, despacho, signal_class,
      estados_provider, acts_count, pubs_count, fijacion_count, unmatched_fijacion_count,
      recent_unmatched_count, last_fijacion_date, evidence, computed_at)
    VALUES (
      wi.id, wi.organization_id, j->>'workflow_type', j->>'radicado', j->>'despacho', v_class,
      j->>'estados_provider', (j->>'acts_count')::int, (j->>'pubs_count')::int,
      (j->>'fijacion_count')::int, (j->>'unmatched_fijacion_count')::int, v_recent,
      NULLIF(j->>'last_fijacion_date','')::date, j->'evidence', now())
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
      last_fijacion_date = EXCLUDED.last_fijacion_date,
      evidence = EXCLUDED.evidence,
      computed_at = now();

    v_fp := 'estados_ausentes_' || wi.id::text;

    IF p_alert AND v_class = 'ESTADOS_ESPERADOS_AUSENTES' AND v_recent > 0 THEN
      IF NOT EXISTS (SELECT 1 FROM public.alert_instances ai WHERE ai.fingerprint = v_fp AND ai.status = 'PENDING') THEN
        INSERT INTO public.alert_instances (
          owner_id, organization_id, entity_id, entity_type, severity, alert_type,
          title, message, status, fingerprint, payload)
        VALUES (
          wi.owner_id, wi.organization_id, wi.id, 'WORK_ITEM', 'WARNING',
          'BRECHA_COBERTURA_ESTADOS',
          'Estados esperados y ausentes: ' || COALESCE(NULLIF(trim(wi.authority_name),''), 'despacho sin identificar'),
          'El expediente ' || COALESCE(wi.radicado,'') || ' registra ' || v_recent ||
            ' fijación(es) en estado en las actuaciones sin la publicación correspondiente. Despacho: ' ||
            COALESCE(NULLIF(trim(wi.authority_name),''), 'sin identificar') || '.',
          'PENDING', v_fp,
          jsonb_build_object('signal_class', v_class, 'evidence', j->'evidence',
                             'recent_unmatched_count', v_recent,
                             'estados_provider', j->>'estados_provider', 'radicado', wi.radicado))
        ON CONFLICT (fingerprint) DO NOTHING;
        v_alerts := v_alerts + 1;
      END IF;
    ELSE
      UPDATE public.alert_instances
         SET status = 'RESOLVED', resolved_at = now()
       WHERE fingerprint = v_fp AND status = 'PENDING';
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'evaluated', v_total, 'counts', v_counts, 'alerts_created', v_alerts, 'computed_at', now());
END; $$;

CREATE OR REPLACE FUNCTION public.estados_coverage_summary()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'computed_at', (SELECT max(computed_at) FROM public.work_item_estados_signal),
    'total', (SELECT count(*) FROM public.work_item_estados_signal),
    'estados_esperados_ausentes', (SELECT count(*) FROM public.work_item_estados_signal WHERE signal_class='ESTADOS_ESPERADOS_AUSENTES'),
    'estados_ausentes_recientes', (SELECT count(*) FROM public.work_item_estados_signal WHERE signal_class='ESTADOS_ESPERADOS_AUSENTES' AND recent_unmatched_count > 0),
    'sin_fijacion_conocida', (SELECT count(*) FROM public.work_item_estados_signal WHERE signal_class='ESTADOS_SIN_FIJACION_CONOCIDA'),
    'sin_cobertura_declarada', (SELECT count(*) FROM public.work_item_estados_signal WHERE signal_class='SIN_COBERTURA_DECLARADA'),
    'cubierto', (SELECT count(*) FROM public.work_item_estados_signal WHERE signal_class='CUBIERTO'),
    'anomalias', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'radicado', radicado, 'despacho', despacho, 'workflow', workflow_type,
        'fijaciones_sin_estado', unmatched_fijacion_count, 'recientes', recent_unmatched_count,
        'ultima_fijacion', last_fijacion_date)), '[]'::jsonb)
      FROM public.work_item_estados_signal WHERE signal_class='ESTADOS_ESPERADOS_AUSENTES' AND recent_unmatched_count > 0)
  )
$$;