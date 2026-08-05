-- ═══════════════════════════════════════════════════════════════════
-- ITERATION 34 — estados signal correction (GCP findings)
-- ═══════════════════════════════════════════════════════════════════

-- 1. despacho_coverage becomes time-bounded ------------------------------
ALTER TABLE public.despacho_coverage
  ADD COLUMN IF NOT EXISTS publishes_from date,
  ADD COLUMN IF NOT EXISTS publishes_until date,
  ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS checked_at timestamptz;

COMMENT ON COLUMN public.despacho_coverage.publishes_from IS
  'First date the source is known to hold publications for this despacho. Fijaciones before it are outside coverage, not anomalies. Seeded ONLY from provider census, never inferred from our own data.';
COMMENT ON COLUMN public.despacho_coverage.publishes_until IS
  'Last date the source is known to hold publications for this despacho. NULL = still publishing.';

-- La Ceja census (GCP, iteration 34): first publication ever 2024-05-15,
-- 101 in 2024, 175 in 2025, 8 Jan-Apr 2026, nothing from May 2026 onward.
INSERT INTO public.despacho_coverage (radicado_prefix, despacho_label, workflow_type, provider_key, publishes, note, publishes_from, publishes_until, evidence, checked_at)
VALUES (
  '053763112001',
  'JUZGADO 001 CIVIL DEL CIRCUITO CON CONOCIMIENTO EN ASUNTOS LABORALES DE LA CEJA',
  NULL, 'publicaciones', true,
  'Censo del proveedor: primera publicacion 2024-05-15; 101 en 2024, 175 en 2025, 8 entre enero y abril de 2026; sin publicaciones desde mayo de 2026.',
  DATE '2024-05-15', DATE '2026-04-30',
  jsonb_build_object('source','GCP_CENSUS_ITER34','first_publication','2024-05-15','last_publication','2026-04-30',
                     'counts', jsonb_build_object('2024',101,'2025',175,'2026_jan_apr',8)),
  now()
)
ON CONFLICT (radicado_prefix, provider_key, workflow_type) DO UPDATE SET
  publishes = EXCLUDED.publishes,
  note = EXCLUDED.note,
  publishes_from = EXCLUDED.publishes_from,
  publishes_until = EXCLUDED.publishes_until,
  evidence = EXCLUDED.evidence,
  checked_at = EXCLUDED.checked_at,
  updated_at = now();

-- 2. Estados fixed by the court with no planilla uploaded ---------------
CREATE TABLE IF NOT EXISTS public.estado_sin_documento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid REFERENCES public.work_items(id) ON DELETE CASCADE,
  organization_id uuid,
  radicado text NOT NULL,
  despacho text,
  provider_key text NOT NULL DEFAULT 'publicaciones',
  fecha_fijacion date NOT NULL,
  estado_numero text,
  article_id text,
  http_status integer,
  body_bytes integer,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  detected_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS estado_sin_documento_unique
  ON public.estado_sin_documento (radicado, provider_key, fecha_fijacion, COALESCE(article_id, ''));

GRANT SELECT ON public.estado_sin_documento TO authenticated;
GRANT ALL ON public.estado_sin_documento TO service_role;
ALTER TABLE public.estado_sin_documento ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members read estado sin documento"
  ON public.estado_sin_documento FOR SELECT TO authenticated
  USING (public.is_platform_admin() OR organization_id = public.get_user_organization_id());

DROP TRIGGER IF EXISTS trg_estado_sin_documento_updated_at ON public.estado_sin_documento;
CREATE TRIGGER trg_estado_sin_documento_updated_at
  BEFORE UPDATE ON public.estado_sin_documento
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.estado_sin_documento IS
  'Iteration 34 — provider signal PROVIDER_NO_DOCUMENT: the court registered the estado (term runs from it) but never uploaded the planilla. Legally distinct from a coverage gap and from a missing estado.';

-- Seed the case ratified by the user: 05001418900420260074500, estado 88,
-- articleId 244724309, fijacion 2026-07-24, HTTP 200 / 78747 bytes / 0 links.
INSERT INTO public.estado_sin_documento (
  work_item_id, organization_id, radicado, despacho, provider_key,
  fecha_fijacion, estado_numero, article_id, http_status, body_bytes, evidence)
SELECT w.id, w.organization_id, w.radicado, w.authority_name, 'publicaciones',
       DATE '2026-07-24', '88', '244724309', 200, 78747,
       jsonb_build_object('source','GCP_ITER34','result_code','PROVIDER_NO_DOCUMENT',
                          'document_links', 0)
  FROM public.work_items w
 WHERE regexp_replace(COALESCE(w.radicado,''),'\D','','g') = '05001418900420260074500'
   AND w.lifecycle_state = 'ACTIVE'
ON CONFLICT DO NOTHING;

-- 3. Provider-published per-despacho orphan counts (PP_COVERAGE) ---------
CREATE TABLE IF NOT EXISTS public.provider_coverage_census (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL DEFAULT 'PP_COVERAGE',
  despacho_code text NOT NULL,
  despacho_label text,
  orphan_count integer NOT NULL DEFAULT 0,
  first_publication date,
  last_publication date,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, despacho_code)
);

GRANT SELECT ON public.provider_coverage_census TO authenticated;
GRANT ALL ON public.provider_coverage_census TO service_role;
ALTER TABLE public.provider_coverage_census ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform admins read provider coverage census"
  ON public.provider_coverage_census FOR SELECT TO authenticated
  USING (public.is_platform_admin());

DROP TRIGGER IF EXISTS trg_provider_coverage_census_updated_at ON public.provider_coverage_census;
CREATE TRIGGER trg_provider_coverage_census_updated_at
  BEFORE UPDATE ON public.provider_coverage_census
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Signal table: new classes + new counters ---------------------------
ALTER TABLE public.work_item_estados_signal
  ADD COLUMN IF NOT EXISTS out_of_window_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sin_documento_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS alertable_unmatched_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.work_item_estados_signal
  DROP CONSTRAINT IF EXISTS work_item_estados_signal_signal_class_check;
ALTER TABLE public.work_item_estados_signal
  ADD CONSTRAINT work_item_estados_signal_signal_class_check
  CHECK (signal_class = ANY (ARRAY[
    'CUBIERTO',
    'ESTADOS_ESPERADOS_AUSENTES',
    'ESTADOS_SIN_FIJACION_CONOCIDA',
    'SIN_COBERTURA_DECLARADA',
    'SIN_COBERTURA_EN_ESA_FECHA',
    'ESTADO_SIN_DOCUMENTO']));

-- 5. Helper — the estados provider a matter must be judged against -------
CREATE OR REPLACE FUNCTION public.estados_provider_for_workflow(p_workflow text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE upper(COALESCE(p_workflow,''))
    WHEN 'CPACA' THEN 'samai_estados'
    WHEN 'CGP' THEN 'publicaciones'
    WHEN 'LABORAL' THEN 'publicaciones'
    WHEN 'PENAL_906' THEN 'publicaciones'
    WHEN 'EJECUTIVO' THEN 'publicaciones'
    WHEN 'TUTELA' THEN 'publicaciones'
    WHEN 'INDETERMINADO' THEN 'publicaciones'
    ELSE NULL END
$$;

COMMENT ON FUNCTION public.estados_provider_for_workflow IS
  'Iteration 34 — a matter may only be judged against ITS OWN estados provider. CPACA takes estados from SAMAI Estados; absence from Publicaciones Procesales is correct by design and must never count as an orphan.';

-- Helper — does the row belong to that provider?
CREATE OR REPLACE FUNCTION public.pub_matches_provider(p_source text, p_provider text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN p_provider = 'samai_estados' THEN lower(COALESCE(p_source,'')) LIKE 'samai%'
    WHEN p_provider = 'publicaciones' THEN lower(COALESCE(p_source,'')) NOT LIKE 'samai%'
    ELSE false END
$$;

-- Helper — is date d inside the despacho's known publication window?
CREATE OR REPLACE FUNCTION public.despacho_window_covers(p_radicado text, p_provider text, p_date date)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT COALESCE(
    (SELECT NOT (
        (c.publishes_from IS NOT NULL AND p_date < c.publishes_from)
        OR (c.publishes_until IS NOT NULL AND p_date > c.publishes_until))
       FROM public.despacho_coverage c
      WHERE c.publishes = true
        AND c.provider_key = p_provider
        AND (c.publishes_from IS NOT NULL OR c.publishes_until IS NOT NULL)
        AND left(regexp_replace(COALESCE(p_radicado,''), '\D', '', 'g'), length(c.radicado_prefix)) = c.radicado_prefix
      ORDER BY length(c.radicado_prefix) DESC
      LIMIT 1),
    true);
$$;

-- 6. Corrected classifier ------------------------------------------------
CREATE OR REPLACE FUNCTION public.classify_work_item_estados_signal(p_work_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  w public.work_items%ROWTYPE;
  v_estados_provider text;
  v_acts int := 0;
  v_pubs int := 0;
  v_fij int := 0;
  v_unmatched jsonb := '[]'::jsonb;
  v_out_window jsonb := '[]'::jsonb;
  v_sin_doc jsonb := '[]'::jsonb;
  v_recent int := 0;
  v_alertable int := 0;
  v_last_fij date;
  v_class text;
  v_declared boolean := false;
  v_hist_sweep_at date;
  v_daily_horizon date := CURRENT_DATE - 120;  -- MONITOREO_MAX_DIAS
  v_alertable_this boolean;
  r record;
BEGIN
  SELECT * INTO w FROM public.work_items WHERE id = p_work_item_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- ITER 34 item 1: judge against the matter's OWN estados provider only.
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

  -- ITER 34 item 5: the daily path cannot reach beyond MONITOREO_MAX_DIAS.
  -- Only a historical sweep can, so anything older is alertable ONLY when a
  -- historical sweep actually ran afterwards and still came back without it.
  SELECT max(COALESCE(r2.finished_at, r2.started_at))::date INTO v_hist_sweep_at
    FROM public.external_sync_runs r2
   WHERE r2.work_item_id = p_work_item_id
     AND upper(COALESCE(r2.run_mode,'')) IN ('HISTORICO','HISTORIC','BACKFILL','FULL');

  FOR r IN
    SELECT a.id, COALESCE(a.act_date, a.event_date) AS d, a.description
      FROM public.work_item_acts a
     WHERE a.work_item_id = p_work_item_id
       AND a.is_archived IS NOT TRUE
       AND public.act_is_fijacion_estado(a.description, a.act_type)
  LOOP
    v_fij := v_fij + 1;
    IF r.d IS NOT NULL AND (v_last_fij IS NULL OR r.d > v_last_fij) THEN v_last_fij := r.d; END IF;

    -- (a) covered by a publication from the matter's own provider
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

    -- (b) the estado exists but the court uploaded no planilla
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

    -- (c) outside the despacho's known publication window
    IF r.d IS NOT NULL AND NOT public.despacho_window_covers(w.radicado, COALESCE(v_estados_provider,'publicaciones'), r.d) THEN
      v_out_window := v_out_window || jsonb_build_object(
        'act_id', r.id, 'act_date', r.d,
        'description', left(COALESCE(r.description,''), 160));
      CONTINUE;
    END IF;

    -- (d) genuine orphan
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
    'recent_unmatched_count', v_recent,
    'alertable_unmatched_count', v_alertable,
    'last_fijacion_date', v_last_fij,
    'historical_sweep_at', v_hist_sweep_at,
    'evidence', jsonb_build_object(
      'unmatched_fijaciones', v_unmatched,
      'fuera_de_ventana', v_out_window,
      'estados_sin_documento', v_sin_doc)
  );
END; $function$;

-- 7. Refresh routine: persist new counters, alert only on reachable gaps --
CREATE OR REPLACE FUNCTION public.refresh_estados_coverage_signals(p_alert boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  wi record;
  j jsonb;
  v_counts jsonb := jsonb_build_object(
    'CUBIERTO',0,'ESTADOS_ESPERADOS_AUSENTES',0,'ESTADOS_SIN_FIJACION_CONOCIDA',0,
    'SIN_COBERTURA_DECLARADA',0,'SIN_COBERTURA_EN_ESA_FECHA',0,'ESTADO_SIN_DOCUMENTO',0);
  v_class text;
  v_total int := 0;
  v_alerts int := 0;
  v_recent int := 0;
  v_alertable int := 0;
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
    v_alertable := COALESCE((j->>'alertable_unmatched_count')::int, 0);
    v_total := v_total + 1;
    v_counts := jsonb_set(v_counts, ARRAY[v_class],
      to_jsonb(COALESCE((v_counts->>v_class)::int,0) + 1));

    INSERT INTO public.work_item_estados_signal AS s (
      work_item_id, organization_id, workflow_type, radicado, despacho, signal_class,
      estados_provider, acts_count, pubs_count, fijacion_count, unmatched_fijacion_count,
      recent_unmatched_count, out_of_window_count, sin_documento_count,
      alertable_unmatched_count, last_fijacion_date, evidence, computed_at)
    VALUES (
      wi.id, wi.organization_id, j->>'workflow_type', j->>'radicado', j->>'despacho', v_class,
      j->>'estados_provider', (j->>'acts_count')::int, (j->>'pubs_count')::int,
      (j->>'fijacion_count')::int, (j->>'unmatched_fijacion_count')::int, v_recent,
      (j->>'out_of_window_count')::int, (j->>'sin_documento_count')::int, v_alertable,
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
      out_of_window_count = EXCLUDED.out_of_window_count,
      sin_documento_count = EXCLUDED.sin_documento_count,
      alertable_unmatched_count = EXCLUDED.alertable_unmatched_count,
      last_fijacion_date = EXCLUDED.last_fijacion_date,
      evidence = EXCLUDED.evidence,
      computed_at = now();

    v_fp := 'estados_ausentes_' || wi.id::text;

    -- ITER 34 item 5: never alert on a gap the daily pipeline cannot resolve.
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
  END LOOP;

  RETURN jsonb_build_object('evaluated', v_total, 'counts', v_counts, 'alerts_created', v_alerts);
END; $function$;

-- 8. Summary + reconciliation -------------------------------------------
CREATE OR REPLACE FUNCTION public.estados_coverage_summary()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT jsonb_build_object(
    'computed_at', (SELECT max(computed_at) FROM public.work_item_estados_signal),
    'total', (SELECT count(*) FROM public.work_item_estados_signal),
    'estados_esperados_ausentes', (SELECT count(*) FROM public.work_item_estados_signal WHERE signal_class='ESTADOS_ESPERADOS_AUSENTES'),
    'estados_ausentes_accionables', (SELECT count(*) FROM public.work_item_estados_signal WHERE signal_class='ESTADOS_ESPERADOS_AUSENTES' AND alertable_unmatched_count > 0),
    'sin_cobertura_en_esa_fecha', (SELECT count(*) FROM public.work_item_estados_signal WHERE signal_class='SIN_COBERTURA_EN_ESA_FECHA'),
    'estado_sin_documento', (SELECT count(*) FROM public.work_item_estados_signal WHERE signal_class='ESTADO_SIN_DOCUMENTO'),
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
  )
$function$;

-- Item 6: reconcile our per-despacho orphan count against the provider's.
CREATE OR REPLACE FUNCTION public.estados_coverage_reconciliation()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH ours AS (
    SELECT left(regexp_replace(COALESCE(radicado,''),'\D','','g'), 12) AS despacho_code,
           max(despacho) AS despacho_label,
           sum(unmatched_fijacion_count)::int AS orphan_count
      FROM public.work_item_estados_signal
     WHERE estados_provider = 'publicaciones'
     GROUP BY 1
  ), theirs AS (
    SELECT despacho_code, despacho_label, orphan_count, fetched_at
      FROM public.provider_coverage_census WHERE source = 'PP_COVERAGE'
  )
  SELECT jsonb_build_object(
    'provider_census_rows', (SELECT count(*) FROM theirs),
    'provider_census_fetched_at', (SELECT max(fetched_at) FROM theirs),
    'filas', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'despacho', COALESCE(o.despacho_code, t.despacho_code),
        'etiqueta', COALESCE(o.despacho_label, t.despacho_label),
        'andromeda', COALESCE(o.orphan_count, 0),
        'proveedor', t.orphan_count,
        'coincide', (t.orphan_count IS NOT NULL AND t.orphan_count = COALESCE(o.orphan_count,0))
      ) ORDER BY COALESCE(o.orphan_count,0) DESC)
      FROM ours o FULL OUTER JOIN theirs t ON t.despacho_code = o.despacho_code
      WHERE COALESCE(o.orphan_count,0) > 0 OR COALESCE(t.orphan_count,0) > 0), '[]'::jsonb)
  )
$function$;