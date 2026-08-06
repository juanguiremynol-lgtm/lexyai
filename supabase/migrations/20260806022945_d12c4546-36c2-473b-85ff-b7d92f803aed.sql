-- ============================================================
-- ITERATION 35 — coverage edges, census re-seed, remisión, SAMAI blindness
-- ============================================================

-- ---------- 1. despacho_coverage: edge confidence + portal alias + monthly presence
ALTER TABLE public.despacho_coverage
  ADD COLUMN IF NOT EXISTS from_confidence text NOT NULL DEFAULT 'OPEN',
  ADD COLUMN IF NOT EXISTS until_confidence text NOT NULL DEFAULT 'OPEN',
  ADD COLUMN IF NOT EXISTS portal_alias text,
  ADD COLUMN IF NOT EXISTS monthly_presence jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS census_source text;

DO $$ BEGIN
  ALTER TABLE public.despacho_coverage
    ADD CONSTRAINT despacho_coverage_from_confidence_check
    CHECK (from_confidence IN ('GENUINE','CENSORED','NEVER_PUBLISHED','OPEN'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.despacho_coverage
    ADD CONSTRAINT despacho_coverage_until_confidence_check
    CHECK (until_confidence IN ('GENUINE','CENSORED','NEVER_PUBLISHED','OPEN'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.despacho_coverage.from_confidence IS
  'CENSORED = the left edge is an artifact of the source''s 120-day retention, not a real start. Only GENUINE/NEVER_PUBLISHED edges may silence a missing estado.';
COMMENT ON COLUMN public.despacho_coverage.until_confidence IS
  'CENSORED = the right edge is where our sampling stopped, not where the source stopped publishing.';
COMMENT ON COLUMN public.despacho_coverage.monthly_presence IS
  'Optional {"YYYY-MM": n} map of publications observed per month. An interior month with zero presence is source silence, not a missing estado.';

-- ---------- 2. Retract the wrongly-seeded La Ceja window
UPDATE public.despacho_coverage
   SET publishes_from = NULL,
       publishes_until = NULL,
       from_confidence = 'CENSORED',
       until_confidence = 'CENSORED',
       census_source = 'PP_COVERAGE',
       evidence = COALESCE(evidence,'{}'::jsonb) || jsonb_build_object(
         'iter35_retraction',
         'Seeded window 2024-05-15..2026-04-30 was an artifact of a 120-day sample, not a real coverage window. Retracted; the provider census is authoritative.'),
       checked_at = now()
 WHERE radicado_prefix = '053763112001'
   AND provider_key = 'publicaciones';

-- ---------- 3. Re-seed the 9 despachos published by the provider census
WITH census(code, alias, label) AS (
  VALUES
    ('050014003011', NULL,           'Juzgado 011 Civil Municipal de Medellín'),
    ('050014003015', NULL,           'Juzgado 015 Civil Municipal de Medellín'),
    ('050014003020', NULL,           'Juzgado 020 Civil Municipal de Medellín'),
    ('050014003023', NULL,           'Juzgado 023 Civil Municipal de Medellín'),
    ('050014189004', NULL,           'Juzgado 004 de Pequeñas Causas de Medellín'),
    ('050303189001', NULL,           'Juzgado 001 de Pequeñas Causas de Amagá'),
    ('050884003005', NULL,           'Juzgado 005 Civil Municipal de Bello'),
    ('053763112001', NULL,           'Juzgado 001 Civil del Circuito de La Ceja'),
    ('057613189001', NULL,           'Juzgado 001 de Pequeñas Causas de Sopetrán'),
    -- Known portal alias: the derived code differs from the code the portal publishes under.
    ('080013153006', '080013103006', 'Juzgado 006 Civil Municipal de Barranquilla')
)
INSERT INTO public.despacho_coverage
  (radicado_prefix, provider_key, workflow_type, despacho_label, publishes,
   portal_alias, from_confidence, until_confidence, census_source, checked_at, evidence, note)
SELECT c.code, 'publicaciones', NULL, c.label, true,
       c.alias, 'CENSORED', 'OPEN', 'PP_COVERAGE', now(),
       jsonb_build_object('iter35_seed', 'From provider census /salud/radicados?source=PP_COVERAGE'),
       'Iteración 35: sembrado desde el censo del proveedor (PP_COVERAGE). Bordes de ventana sin confirmar.'
  FROM census c
ON CONFLICT (radicado_prefix, provider_key, workflow_type) DO UPDATE SET
  despacho_label   = COALESCE(public.despacho_coverage.despacho_label, EXCLUDED.despacho_label),
  publishes        = true,
  portal_alias     = COALESCE(EXCLUDED.portal_alias, public.despacho_coverage.portal_alias),
  census_source    = 'PP_COVERAGE',
  checked_at       = now();

-- ---------- 4. Window logic honours edge confidence + monthly presence
CREATE OR REPLACE FUNCTION public.despacho_window_covers(
  p_radicado text, p_provider text, p_date date)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
  SELECT COALESCE(
    (SELECT CASE
       -- A despacho that has never published anything: silence is expected.
       WHEN c.from_confidence = 'NEVER_PUBLISHED' OR c.until_confidence = 'NEVER_PUBLISHED'
         THEN false
       -- Only a GENUINE edge is evidence. A CENSORED/OPEN edge is an artifact
       -- of our sampling window and must never silence a missing estado.
       WHEN c.publishes_from IS NOT NULL AND p_date < c.publishes_from
            AND c.from_confidence = 'GENUINE'
         THEN false
       WHEN c.publishes_until IS NOT NULL AND p_date > c.publishes_until
            AND c.until_confidence = 'GENUINE'
         THEN false
       -- Interior silence: the source published nothing at all that month.
       WHEN c.monthly_presence <> '{}'::jsonb
            AND COALESCE((c.monthly_presence ->> to_char(p_date,'YYYY-MM'))::int, 0) = 0
         THEN false
       ELSE true
     END
       FROM public.despacho_coverage c
      WHERE c.publishes = true
        AND c.provider_key = p_provider
        AND left(regexp_replace(COALESCE(p_radicado,''), '\D', '', 'g'), length(c.radicado_prefix)) = c.radicado_prefix
      ORDER BY length(c.radicado_prefix) DESC
      LIMIT 1),
    true);
$fn$;

-- ---------- 5. Remisión detector
CREATE OR REPLACE FUNCTION public.act_is_remision_expediente(
  p_description text, p_act_type text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT (
    t LIKE '%envio a superior%'
    OR t LIKE '%salida finalizando instancia%'
    OR (t LIKE '%remi%' AND (
          t LIKE '%superior%' OR t LIKE '%competencia%' OR t LIKE '%incompeten%'
          OR t LIKE '%otro despacho%' OR t LIKE '%otro juzgado%'))
  )
  FROM (SELECT public.estados_signal_norm(
          COALESCE(p_description,'') || ' ' || COALESCE(p_act_type,'')) AS t) s;
$fn$;

-- ---------- 6. Classifier: REMITIDO_A_SUPERIOR
CREATE OR REPLACE FUNCTION public.classify_work_item_estados_signal(p_work_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $fn$
DECLARE
  w public.work_items%ROWTYPE;
  v_estados_provider text;
  v_acts int := 0;
  v_pubs int := 0;
  v_fij int := 0;
  v_unmatched jsonb := '[]'::jsonb;
  v_out_window jsonb := '[]'::jsonb;
  v_sin_doc jsonb := '[]'::jsonb;
  v_remitido jsonb := '[]'::jsonb;
  v_recent int := 0;
  v_alertable int := 0;
  v_last_fij date;
  v_class text;
  v_declared boolean := false;
  v_hist_sweep_at date;
  v_daily_horizon date := CURRENT_DATE - 120;
  v_alertable_this boolean;
  v_remision_date date;
  v_remision_desc text;
  r record;
BEGIN
  SELECT * INTO w FROM public.work_items WHERE id = p_work_item_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_estados_provider := public.estados_provider_for_workflow(w.workflow_type::text);

  SELECT count(*) INTO v_acts FROM public.work_item_acts a
   WHERE a.work_item_id = p_work_item_id AND a.is_archived IS NOT TRUE;

  SELECT count(*) INTO v_pubs FROM public.work_item_publicaciones p
   WHERE p.work_item_id = p_work_item_id AND p.is_archived IS NOT TRUE
     AND public.pub_matches_provider(p.source, v_estados_provider);

  SELECT EXISTS (
    SELECT 1 FROM public.despacho_coverage c
     WHERE c.publishes = false
       AND c.provider_key = COALESCE(v_estados_provider, '')
       AND (c.workflow_type IS NULL OR c.workflow_type = w.workflow_type::text)
       AND left(regexp_replace(COALESCE(w.radicado,''), '\D', '', 'g'), length(c.radicado_prefix)) = c.radicado_prefix
  ) INTO v_declared;

  SELECT max(COALESCE(r2.finished_at, r2.started_at))::date INTO v_hist_sweep_at
    FROM public.external_sync_runs r2
   WHERE r2.work_item_id = p_work_item_id
     AND upper(COALESCE(r2.run_mode,'')) IN ('HISTORICO','HISTORIC','BACKFILL','FULL');

  -- ITER 35 item 4: once the file leaves the despacho, the old despacho stops
  -- publishing for it. That is a jurisdictional fact, not a provider failure.
  SELECT COALESCE(a.act_date, a.event_date), left(COALESCE(a.description,''), 200)
    INTO v_remision_date, v_remision_desc
    FROM public.work_item_acts a
   WHERE a.work_item_id = p_work_item_id
     AND a.is_archived IS NOT TRUE
     AND public.act_is_remision_expediente(a.description, a.act_type)
     AND COALESCE(a.act_date, a.event_date) IS NOT NULL
   ORDER BY COALESCE(a.act_date, a.event_date) DESC
   LIMIT 1;

  FOR r IN
    SELECT a.id, COALESCE(a.act_date, a.event_date) AS d, a.description
      FROM public.work_item_acts a
     WHERE a.work_item_id = p_work_item_id
       AND a.is_archived IS NOT TRUE
       AND public.act_is_fijacion_estado(a.description, a.act_type)
  LOOP
    v_fij := v_fij + 1;
    IF r.d IS NOT NULL AND (v_last_fij IS NULL OR r.d > v_last_fij) THEN v_last_fij := r.d; END IF;

    IF EXISTS (
      SELECT 1 FROM public.work_item_publicaciones p
       WHERE p.work_item_id = p_work_item_id
         AND p.is_archived IS NOT TRUE
         AND public.pub_matches_provider(p.source, v_estados_provider)
         AND r.d IS NOT NULL
         AND COALESCE(p.fecha_fijacion::date, p.published_at::date, p.fecha_desfijacion::date)
             BETWEEN public.sub_business_days_sql(r.d, 2) AND public.add_business_days_sql(r.d, 2)
    ) THEN
      CONTINUE;
    END IF;

    IF r.d IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.estado_sin_documento e
       WHERE (e.work_item_id = p_work_item_id
              OR regexp_replace(COALESCE(e.radicado,''),'\D','','g') = regexp_replace(COALESCE(w.radicado,''),'\D','','g'))
         AND e.provider_key = COALESCE(v_estados_provider,'publicaciones')
         AND e.fecha_fijacion BETWEEN public.sub_business_days_sql(r.d, 2) AND public.add_business_days_sql(r.d, 2)
    ) THEN
      v_sin_doc := v_sin_doc || jsonb_build_object(
        'act_id', r.id, 'act_date', r.d,
        'description', left(COALESCE(r.description,''), 160));
      CONTINUE;
    END IF;

    IF r.d IS NOT NULL AND NOT public.despacho_window_covers(w.radicado, COALESCE(v_estados_provider,'publicaciones'), r.d) THEN
      v_out_window := v_out_window || jsonb_build_object(
        'act_id', r.id, 'act_date', r.d,
        'description', left(COALESCE(r.description,''), 160));
      CONTINUE;
    END IF;

    -- Remitted: a fijación at or after the remisión belongs to the receiving despacho.
    IF r.d IS NOT NULL AND v_remision_date IS NOT NULL AND r.d >= (v_remision_date - 15) THEN
      v_remitido := v_remitido || jsonb_build_object(
        'act_id', r.id, 'act_date', r.d,
        'description', left(COALESCE(r.description,''), 160),
        'remision_date', v_remision_date);
      CONTINUE;
    END IF;

    v_alertable_this := r.d IS NOT NULL
      AND (r.d >= v_daily_horizon OR (v_hist_sweep_at IS NOT NULL AND v_hist_sweep_at >= r.d));
    v_unmatched := v_unmatched || jsonb_build_object(
      'act_id', r.id, 'act_date', r.d,
      'description', left(COALESCE(r.description,''), 160),
      'reciente', (r.d IS NOT NULL AND r.d >= (CURRENT_DATE - 90)),
      'alcanzable_por_diario', COALESCE(v_alertable_this, false));
    IF r.d IS NOT NULL AND r.d >= (CURRENT_DATE - 90) THEN v_recent := v_recent + 1; END IF;
    IF v_alertable_this THEN v_alertable := v_alertable + 1; END IF;
  END LOOP;

  IF v_estados_provider IS NULL THEN
    v_class := 'SIN_COBERTURA_DECLARADA';
  ELSIF v_declared THEN
    v_class := 'SIN_COBERTURA_DECLARADA';
  ELSIF jsonb_array_length(v_unmatched) > 0 THEN
    v_class := 'ESTADOS_ESPERADOS_AUSENTES';
  ELSIF jsonb_array_length(v_remitido) > 0 THEN
    v_class := 'REMITIDO_A_SUPERIOR';
  ELSIF jsonb_array_length(v_out_window) > 0 THEN
    v_class := 'SIN_COBERTURA_EN_ESA_FECHA';
  ELSIF jsonb_array_length(v_sin_doc) > 0 THEN
    v_class := 'ESTADO_SIN_DOCUMENTO';
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
    'out_of_window_count', jsonb_array_length(v_out_window),
    'sin_documento_count', jsonb_array_length(v_sin_doc),
    'remitido_count', jsonb_array_length(v_remitido),
    'remision_date', v_remision_date,
    'remision_description', v_remision_desc,
    'recent_unmatched_count', v_recent,
    'alertable_unmatched_count', v_alertable,
    'last_fijacion_date', v_last_fij,
    'historical_sweep_at', v_hist_sweep_at,
    'evidence', jsonb_build_object(
      'unmatched_fijaciones', v_unmatched,
      'fuera_de_ventana', v_out_window,
      'estados_sin_documento', v_sin_doc,
      'remitidas', v_remitido)
  );
END;
$fn$;

-- ---------- 7. Signal table: carry remisión columns
ALTER TABLE public.work_item_estados_signal
  ADD COLUMN IF NOT EXISTS remitido_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remision_date date;

DO $$ BEGIN
  ALTER TABLE public.work_item_estados_signal DROP CONSTRAINT IF EXISTS work_item_estados_signal_signal_class_check;
EXCEPTION WHEN undefined_object THEN NULL; END $$;

ALTER TABLE public.work_item_estados_signal
  ADD CONSTRAINT work_item_estados_signal_signal_class_check
  CHECK (signal_class IN ('CUBIERTO','ESTADOS_ESPERADOS_AUSENTES','ESTADOS_SIN_FIJACION_CONOCIDA',
                          'SIN_COBERTURA_DECLARADA','SIN_COBERTURA_EN_ESA_FECHA','ESTADO_SIN_DOCUMENTO',
                          'REMITIDO_A_SUPERIOR'));

-- ---------- 8. New alert type for remisión
ALTER TABLE public.alert_instances DROP CONSTRAINT IF EXISTS alert_instances_alert_type_check;
ALTER TABLE public.alert_instances
  ADD CONSTRAINT alert_instances_alert_type_check CHECK (alert_type = ANY (ARRAY[
    'TERMINO_CRITICO','TERMINO_POR_VENCER','TERMINO_VENCIDO','ACTUACION_RETROACTIVA','ACTUACION_CRITICA',
    'HEARING_TODAY','HEARING_UPCOMING','MONITOREO_SIN_INGESTA','MONITOREO_SIN_PROVEEDOR','MONITOREO_DESACTIVADO',
    'SUGERENCIA_PENDIENTE','LEXY_DAILY','INGESTA_MASIVA','BRECHA_COBERTURA_ESTADOS','REMISION_EXPEDIENTE',
    'SYNC_AUTH_FAILURE','SYNC_FAILURE','WATCHDOG_ESCALATION','WATCHDOG_INVARIANT',
    'PROVIDER_SECRET_DECRYPT_FAILED','MISSING_PROVIDER_SECRET','DAILY_WELCOME','PROROGATION_DEADLINE',
    'PETICION_DEADLINE','PETICION_OVERDUE','PETICION_REMINDER','HEARING_CREATED','HEARING_REMINDER',
    'HEARING_SUSPENDED','ACTUACION_NUEVA','ACTUACION_MODIFIED','ESTADO_NUEVO','ESTADO_MODIFIED',
    'PUBLICACIONES_NUEVAS','SYSTEM_UNTYPED']));

-- ---------- 9. Refresh: persist remisión, raise the sentinel
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
      COALESCE((j->>'remitido_count')::int, 0), NULLIF(j->>'remision_date','')::date,
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
                             'estados_provider', j->>'estados_provider'));
        v_alerts := v_alerts + 1;
      END IF;
    ELSE
      UPDATE public.alert_instances
         SET status = 'RESOLVED', resolved_at = now()
       WHERE fingerprint = v_fp AND status = 'PENDING';
    END IF;

    -- The remisión sentinel: the lawyer must know the file changed hands.
    IF p_alert AND v_class = 'REMITIDO_A_SUPERIOR'
       AND NULLIF(j->>'remision_date','')::date >= (CURRENT_DATE - 120) THEN
      IF NOT EXISTS (SELECT 1 FROM public.alert_instances ai WHERE ai.fingerprint = v_fp_rem AND ai.status = 'PENDING') THEN
        INSERT INTO public.alert_instances (
          owner_id, organization_id, entity_id, entity_type, severity, alert_type,
          title, message, status, fingerprint, payload)
        VALUES (
          wi.owner_id, wi.organization_id, wi.id, 'WORK_ITEM', 'INFO',
          'REMISION_EXPEDIENTE',
          'Expediente remitido a otro despacho',
          'El expediente ' || COALESCE(wi.radicado,'') || ' fue remitido el ' ||
            COALESCE(j->>'remision_date','fecha sin registrar') ||
            '. Las fijaciones posteriores corresponden al despacho receptor, no a ' ||
            COALESCE(NULLIF(trim(wi.authority_name),''), 'el despacho de origen') ||
            '. Verifique el nuevo radicado para reanudar el monitoreo.',
          'PENDING', v_fp_rem,
          jsonb_build_object('remision_date', j->>'remision_date',
                             'remision_description', j->>'remision_description',
                             'fijaciones_posteriores', j->>'remitido_count'));
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

-- ---------- 10. Summary + reconciliation aware of the new class and aliases
CREATE OR REPLACE FUNCTION public.estados_coverage_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT jsonb_build_object(
    'computed_at', (SELECT max(computed_at) FROM public.work_item_estados_signal),
    'total', (SELECT count(*) FROM public.work_item_estados_signal),
    'estados_esperados_ausentes', (SELECT count(*) FROM public.work_item_estados_signal WHERE signal_class='ESTADOS_ESPERADOS_AUSENTES'),
    'estados_ausentes_accionables', (SELECT count(*) FROM public.work_item_estados_signal WHERE signal_class='ESTADOS_ESPERADOS_AUSENTES' AND alertable_unmatched_count > 0),
    'sin_cobertura_en_esa_fecha', (SELECT count(*) FROM public.work_item_estados_signal WHERE signal_class='SIN_COBERTURA_EN_ESA_FECHA'),
    'estado_sin_documento', (SELECT count(*) FROM public.work_item_estados_signal WHERE signal_class='ESTADO_SIN_DOCUMENTO'),
    'remitido_a_superior', (SELECT count(*) FROM public.work_item_estados_signal WHERE signal_class='REMITIDO_A_SUPERIOR'),
    'sin_fijacion_conocida', (SELECT count(*) FROM public.work_item_estados_signal WHERE signal_class='ESTADOS_SIN_FIJACION_CONOCIDA'),
    'sin_cobertura_declarada', (SELECT count(*) FROM public.work_item_estados_signal WHERE signal_class='SIN_COBERTURA_DECLARADA'),
    'cubierto', (SELECT count(*) FROM public.work_item_estados_signal WHERE signal_class='CUBIERTO'),
    'huerfanos_totales', (SELECT COALESCE(sum(unmatched_fijacion_count),0) FROM public.work_item_estados_signal),
    'anomalias', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'radicado', radicado, 'despacho', despacho, 'workflow', workflow_type,
        'proveedor', estados_provider,
        'fijaciones_sin_estado', unmatched_fijacion_count, 'accionables', alertable_unmatched_count,
        'ultima_fijacion', last_fijacion_date)), '[]'::jsonb)
      FROM public.work_item_estados_signal WHERE signal_class='ESTADOS_ESPERADOS_AUSENTES' AND alertable_unmatched_count > 0)
  );
$fn$;

CREATE OR REPLACE FUNCTION public.estados_coverage_reconciliation()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH alias AS (
    SELECT radicado_prefix AS code, portal_alias
      FROM public.despacho_coverage
     WHERE provider_key = 'publicaciones' AND portal_alias IS NOT NULL
  ), ours AS (
    SELECT left(regexp_replace(COALESCE(s.radicado,''),'\D','','g'), 12) AS despacho_code,
           max(s.despacho) AS despacho_label,
           sum(s.unmatched_fijacion_count)::int AS orphan_count
      FROM public.work_item_estados_signal s
     WHERE s.estados_provider = 'publicaciones'
     GROUP BY 1
  ), ours_keyed AS (
    -- Key on the portal's own code when it differs from the derived one.
    SELECT COALESCE(a.portal_alias, o.despacho_code) AS despacho_code,
           o.despacho_code AS derived_code,
           o.despacho_label, o.orphan_count
      FROM ours o LEFT JOIN alias a ON a.code = o.despacho_code
  ), theirs AS (
    SELECT despacho_code, despacho_label, orphan_count, fetched_at
      FROM public.provider_coverage_census WHERE source = 'PP_COVERAGE'
  )
  SELECT jsonb_build_object(
    'provider_census_rows', (SELECT count(*) FROM theirs),
    'provider_census_fetched_at', (SELECT max(fetched_at) FROM theirs),
    'filas', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'despacho', COALESCE(o.despacho_code, t.despacho_code),
        'derivado', o.derived_code,
        'etiqueta', COALESCE(o.despacho_label, t.despacho_label),
        'andromeda', COALESCE(o.orphan_count, 0),
        'proveedor', t.orphan_count,
        'coincide', (t.orphan_count IS NOT NULL AND t.orphan_count = COALESCE(o.orphan_count,0))
      ) ORDER BY COALESCE(o.orphan_count,0) DESC)
      FROM ours_keyed o FULL OUTER JOIN theirs t ON t.despacho_code = o.despacho_code
      WHERE COALESCE(o.orphan_count,0) > 0 OR COALESCE(t.orphan_count,0) > 0), '[]'::jsonb)
  );
$fn$;

-- ---------- 11. SAMAI blindness monitor: CPACA matters the source returns empty
CREATE OR REPLACE FUNCTION public.samai_zero_actuaciones_report()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH candidates AS (
    SELECT w.id, w.radicado, w.authority_name, w.organization_id, w.last_synced_at,
           (SELECT count(*) FROM public.work_item_acts a
             WHERE a.work_item_id = w.id AND a.is_archived IS NOT TRUE) AS acts,
           (SELECT count(*) FROM public.work_item_publicaciones p
             WHERE p.work_item_id = w.id AND p.is_archived IS NOT TRUE) AS pubs,
           (SELECT count(*) FROM public.external_sync_runs r
             WHERE r.work_item_id = w.id
               AND r.started_at > now() - interval '30 days') AS runs_30d
      FROM public.work_items w
     WHERE w.workflow_type = 'CPACA'
       AND w.lifecycle_state = 'ACTIVE'
       AND w.monitoring_enabled IS TRUE
       AND COALESCE(w.radicado,'') <> ''
  )
  SELECT jsonb_build_object(
    'computed_at', now(),
    'cpaca_monitoreados', (SELECT count(*) FROM candidates),
    'ciegos', (SELECT count(*) FROM candidates WHERE acts = 0 AND pubs = 0),
    'detalle', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'work_item_id', id, 'radicado', radicado, 'despacho', authority_name,
        'actuaciones', acts, 'estados', pubs,
        'corridas_30d', runs_30d, 'ultima_sync', last_synced_at))
      FROM candidates WHERE acts = 0 AND pubs = 0), '[]'::jsonb)
  );
$fn$;

GRANT EXECUTE ON FUNCTION public.samai_zero_actuaciones_report() TO authenticated;
GRANT EXECUTE ON FUNCTION public.act_is_remision_expediente(text, text) TO authenticated;