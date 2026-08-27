-- ============================================================================
-- YY1 — WIRE THE LEARNED DESPACHO PROFILES INTO GRADING
-- YY2 — THE DESCRIPTIVE SENTENCE
-- YY3 — ONE-TIME RECONCILIATION NOTICES
-- ============================================================================

-- YY1(f): a profile earns grading by earning evidence. No manual list.
CREATE OR REPLACE FUNCTION public.refresh_despacho_profiles()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  INSERT INTO public.despacho_profile_transitions (despacho_code, dimension, from_value, to_value, evidence)
  SELECT d.despacho_code, t.dim, t.old_v, t.new_v,
         jsonb_build_object('matters', d.matters_observed, 'observation_days', d.observation_days,
                            'acts_data_reads', d.acts_data_reads, 'estados_data_reads', d.estados_data_reads)
  FROM public.derive_despacho_profiles() d
  LEFT JOIN public.despacho_profiles p ON p.despacho_code = d.despacho_code
  CROSS JOIN LATERAL (VALUES
    ('feeds_actuaciones', p.feeds_actuaciones, d.feeds_actuaciones),
    ('publishes_estados', p.publishes_estados, d.publishes_estados),
    ('delivers_detail',   p.delivers_detail,   d.delivers_detail)
  ) AS t(dim, old_v, new_v)
  WHERE t.old_v IS DISTINCT FROM t.new_v;

  INSERT INTO public.despacho_profiles AS p (
    despacho_code, matters_observed, observation_days, first_observed_at, last_observed_at,
    acts_attempts, acts_data_reads, acts_empty_reads, acts_pending_reads, acts_failed_reads, acts_last_data_at,
    estados_attempts, estados_data_reads, estados_empty_reads, estados_pending_reads, estados_failed_reads, estados_last_data_at,
    feeds_actuaciones, publishes_estados, delivers_detail, evidence_sufficient, evidence_note,
    enabled_for_grading, computed_at)
  SELECT d.despacho_code, d.matters_observed, d.observation_days, d.first_observed_at, d.last_observed_at,
    d.acts_attempts, d.acts_data_reads, d.acts_empty_reads, d.acts_pending_reads, d.acts_failed_reads, d.acts_last_data_at,
    d.estados_attempts, d.estados_data_reads, d.estados_empty_reads, d.estados_pending_reads, d.estados_failed_reads, d.estados_last_data_at,
    d.feeds_actuaciones, d.publishes_estados, d.delivers_detail, d.evidence_sufficient, d.evidence_note,
    d.evidence_sufficient, now()
  FROM public.derive_despacho_profiles() d
  ON CONFLICT (despacho_code) DO UPDATE SET
    matters_observed = EXCLUDED.matters_observed,
    observation_days = EXCLUDED.observation_days,
    first_observed_at = EXCLUDED.first_observed_at,
    last_observed_at = EXCLUDED.last_observed_at,
    acts_attempts = EXCLUDED.acts_attempts,
    acts_data_reads = EXCLUDED.acts_data_reads,
    acts_empty_reads = EXCLUDED.acts_empty_reads,
    acts_pending_reads = EXCLUDED.acts_pending_reads,
    acts_failed_reads = EXCLUDED.acts_failed_reads,
    acts_last_data_at = EXCLUDED.acts_last_data_at,
    estados_attempts = EXCLUDED.estados_attempts,
    estados_data_reads = EXCLUDED.estados_data_reads,
    estados_empty_reads = EXCLUDED.estados_empty_reads,
    estados_pending_reads = EXCLUDED.estados_pending_reads,
    estados_failed_reads = EXCLUDED.estados_failed_reads,
    estados_last_data_at = EXCLUDED.estados_last_data_at,
    feeds_actuaciones = EXCLUDED.feeds_actuaciones,
    publishes_estados = EXCLUDED.publishes_estados,
    delivers_detail = EXCLUDED.delivers_detail,
    evidence_sufficient = EXCLUDED.evidence_sufficient,
    evidence_note = EXCLUDED.evidence_note,
    -- Evidence, not curation, is what switches grading on and off.
    enabled_for_grading = EXCLUDED.evidence_sufficient,
    computed_at = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_despacho_profiles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_despacho_profiles() TO service_role;

SELECT public.refresh_despacho_profiles();

-- ---------------------------------------------------------------------------
-- YY1(b) — the ONLY place that decides whether a court's behaviour explains an
-- absence. Safeguards, all enforced here:
--   S1  the profile must be enabled AND have sufficient evidence;
--   S3  it may not explain an absence POSTERIOR to the last datum that very
--       channel delivered (a court that once published cannot "not publish");
--   S4  the caller must still exclude matters whose read is PENDING_UPSTREAM —
--       a non-answer is never absorbed by a court profile.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.despacho_profile_explains_absence(
  p_radicado text,
  p_channel  text,
  p_absence_at timestamptz DEFAULT now()
) RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT COALESCE(bool_or(
      p.enabled_for_grading
      AND p.evidence_sufficient
      AND (CASE WHEN upper(COALESCE(p_channel,'')) = 'ACTS'
                THEN p.feeds_actuaciones ELSE p.publishes_estados END) = 'NO_USA'
      AND (
        (CASE WHEN upper(COALESCE(p_channel,'')) = 'ACTS'
              THEN p.acts_last_data_at ELSE p.estados_last_data_at END) IS NULL
        OR p_absence_at <= (CASE WHEN upper(COALESCE(p_channel,'')) = 'ACTS'
              THEN p.acts_last_data_at ELSE p.estados_last_data_at END)
      )
  ), false)
  FROM public.despacho_profiles p
  WHERE p.despacho_code = LEFT(regexp_replace(COALESCE(p_radicado,''), '\D', '', 'g'), 12)
$$;

GRANT EXECUTE ON FUNCTION public.despacho_profile_explains_absence(text, text, timestamptz)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- YY2 — the sentence. The court is named from what the providers themselves
-- reported (most frequent authority_name at that code); never hand-written.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.despacho_name_observed(p_code text)
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT w.authority_name
    FROM public.work_items w
   WHERE w.deleted_at IS NULL
     AND w.authority_name IS NOT NULL
     AND LEFT(regexp_replace(COALESCE(w.radicado,''), '\D', '', 'g'), 12) = p_code
   GROUP BY w.authority_name
   ORDER BY count(*) DESC, w.authority_name
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.despacho_behavior_statement(p_radicado text)
RETURNS text LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE p public.despacho_profiles%ROWTYPE; v_name text; v_body text; v_detail text := '';
BEGIN
  SELECT * INTO p FROM public.despacho_profiles
   WHERE despacho_code = LEFT(regexp_replace(COALESCE(p_radicado,''), '\D', '', 'g'), 12);
  IF NOT FOUND OR NOT p.evidence_sufficient THEN RETURN NULL; END IF;

  v_name := COALESCE(public.despacho_name_observed(p.despacho_code), 'El despacho ' || p.despacho_code);

  IF p.feeds_actuaciones = 'NO_USA' AND p.publishes_estados = 'USA' THEN
    v_body := 'no alimenta el expediente digital; sus novedades llegan únicamente por estados';
  ELSIF p.feeds_actuaciones = 'USA' AND p.publishes_estados = 'NO_USA' THEN
    v_body := 'no publica estados; sus novedades llegan únicamente por actuaciones del expediente digital';
  ELSIF p.feeds_actuaciones = 'NO_USA' AND p.publishes_estados = 'NO_USA' THEN
    v_body := 'no ha entregado información por ninguno de los dos canales durante el periodo observado';
  ELSIF p.feeds_actuaciones = 'USA' AND p.publishes_estados = 'USA' THEN
    v_body := 'publica por ambos canales: expediente digital y estados';
  ELSE
    RETURN NULL;
  END IF;

  IF p.delivers_detail = 'NO_ENTREGA_DETALLE' THEN
    v_detail := '; publica el estado sin entregar el detalle de la providencia';
  END IF;

  RETURN v_name || ' ' || v_body || v_detail ||
         ' (observado en ' || p.matters_observed || ' asunto(s) durante ' ||
         p.observation_days || ' días de lectura).';
END; $$;

GRANT EXECUTE ON FUNCTION public.despacho_name_observed(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.despacho_behavior_statement(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- YY1(c) — grading consumes the profiles. Two new columns make the effect
-- auditable: what the denominator would have been, and how much the profiles
-- removed from it.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.source_collection_quality(text, timestamptz, timestamptz);

CREATE FUNCTION public.source_collection_quality(
  _source text,
  _from timestamptz DEFAULT (now() - interval '24 hours'),
  _to   timestamptz DEFAULT now()
) RETURNS TABLE(
  source text, expected_count integer, attempted_count integer, usable_confirmed_count integer,
  success_count integer, success_empty_count integer, not_found_count integer, restricted_count integer,
  pending_upstream_count integer, error_count integer, coverage_ratio numeric,
  last_attempt_at timestamptz, source_quality_state text,
  expected_before_profile integer, excluded_by_profile integer
)
LANGUAGE plpgsql STABLE
SET search_path = public
AS $function$
DECLARE src text := lower(_source); wf text[]; chan text;
BEGIN
  wf := CASE src
    WHEN 'cpnu' THEN ARRAY['CGP','LABORAL','PENAL_906','EJECUTIVO','TUTELA','INDETERMINADO']
    WHEN 'publicaciones' THEN ARRAY['CGP','LABORAL','PENAL_906','EJECUTIVO','TUTELA','INDETERMINADO']
    WHEN 'samai' THEN ARRAY['CPACA','TUTELA','INDETERMINADO']
    WHEN 'samai_estados' THEN ARRAY['CPACA','TUTELA','INDETERMINADO']
    ELSE ARRAY[]::text[] END;
  chan := CASE WHEN src IN ('publicaciones','samai_estados') THEN 'ESTADOS' ELSE 'ACTS' END;

  RETURN QUERY
  WITH elig AS (
    SELECT w.id, w.radicado FROM public.work_items w
     WHERE w.deleted_at IS NULL
       AND coalesce(w.lifecycle_state::text,'ACTIVE')='ACTIVE'
       AND coalesce(w.monitoring_enabled,true)
       AND w.workflow_type::text = ANY(wf)
       AND NOT (src IN ('publicaciones','samai_estados') AND (
             upper(coalesce(w.stage,'')) ~ 'ARCHIV|FINALIZ|PRECLUID'
          OR upper(coalesce(w.ubicacion_expediente,'')) ~ 'AL[[:space:]]+DESPACHO.*SENTENCIA|PARA[[:space:]]+SENTENCIA'
          OR (w.fecha_para_sentencia IS NOT NULL AND upper(coalesce(w.ubicacion_expediente,'')) ~ 'DESPACHO')))
  ), att AS (
    SELECT r.work_item_id, r.started_at,
           lower(coalesce(a.value->>'status','')) att_status,
           upper(coalesce(a.value->>'outcome', a.value->>'error_code', r.error_code,'')) outcome
      FROM public.external_sync_runs r
      CROSS JOIN LATERAL jsonb_array_elements(coalesce(r.provider_attempts,'[]'::jsonb)) a(value)
     WHERE lower(coalesce(a.value->>'provider','')) = src
       AND r.started_at BETWEEN _from AND _to
  ), graded AS (
    SELECT *, CASE
      WHEN outcome='RUN_SUCCESS_WITH_DATA' THEN 1
      WHEN outcome='RUN_SUCCESS_EMPTY' THEN 2
      WHEN outcome IN ('RUN_SUCCESS_NOT_FOUND','NOT_FOUND','PROVIDER_NOT_FOUND','RADICADO_NOT_FOUND') THEN 3
      WHEN outcome='PROCESO_PRIVADO' THEN 4
      WHEN outcome IN ('PENDING_UPSTREAM','SCRAPING_INITIATED','SOURCE_STALE') THEN 5
      WHEN outcome='RUN_FAILED' THEN 6
      WHEN att_status='success' THEN 1
      WHEN att_status='empty' THEN 2
      WHEN att_status='not_found' THEN 3
      ELSE 6 END grade
    FROM att
  ), excl AS (
    -- S4: a matter left waiting on the provider is NEVER absorbed by a profile.
    SELECT e.id FROM elig e
     WHERE public.despacho_profile_explains_absence(e.radicado, chan, _to)
       AND NOT EXISTS (SELECT 1 FROM graded g WHERE g.work_item_id = e.id AND g.grade = 5)
  ), best AS (
    SELECT DISTINCT ON (work_item_id) work_item_id, grade
      FROM graded
     WHERE work_item_id NOT IN (SELECT id FROM excl)
     ORDER BY work_item_id, grade
  ), cov AS (
    SELECT count(*)::int attempted,
           count(*) FILTER (WHERE grade=1)::int ok,
           count(*) FILTER (WHERE grade=2)::int empty,
           count(*) FILTER (WHERE grade=3)::int nf,
           count(*) FILTER (WHERE grade=4)::int restricted,
           count(*) FILTER (WHERE grade=5)::int pending,
           count(*) FILTER (WHERE grade=6)::int errs,
           (SELECT max(started_at) FROM graded) last_at
      FROM best
  ), tot AS (
    SELECT (SELECT count(*) FROM elig)::int all_n, (SELECT count(*) FROM excl)::int excl_n
  )
  SELECT src,
         (tot.all_n - tot.excl_n)::int,
         cov.attempted, (cov.ok+cov.empty+cov.nf)::int,
         cov.ok, cov.empty, cov.nf, cov.restricted, cov.pending, cov.errs,
         CASE WHEN (tot.all_n - tot.excl_n) > 0
              THEN round(least((cov.ok+cov.empty+cov.nf)::numeric/(tot.all_n - tot.excl_n),1),4) END,
         cov.last_at,
         public.classify_source_run_quality(
           (tot.all_n - tot.excl_n), cov.attempted, (cov.ok+cov.empty+cov.nf),
           cov.pending, cov.nf, cov.errs, cov.attempted>0, false),
         tot.all_n, tot.excl_n
    FROM tot, cov;
END; $function$;

GRANT EXECUTE ON FUNCTION public.source_collection_quality(text, timestamptz, timestamptz)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- YY1(c) — the alert stops firing where the court's own behaviour explains it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.detect_stale_monitoring(p_threshold_days integer DEFAULT 45)
RETURNS TABLE(work_item_id uuid, radicado text, reason text, days_since_ingest integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_day text := to_char(now() AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD');
  v_reason text; v_title text; v_explained boolean; v_profiled boolean;
BEGIN
  FOR r IN
    SELECT mc.* FROM public.monitoring_coverage_v mc
      JOIN public.v_monitored_work_items m ON m.id = mc.work_item_id
     WHERE mc.monitoring_enabled
       AND public.is_provider_monitored_workflow(mc.workflow_type)
       AND mc.coverage_status IN ('SIN_ENROLAMIENTO','ENROLAMIENTO_PARCIAL','SIN_RADICADO_VALIDO','NUNCA_INGERIDO')
  LOOP
    SELECT bool_and(public.despacho_silence_note(r.radicado, r.workflow_type, p) IS NOT NULL)
      INTO v_explained
      FROM unnest(public.provider_chain_for_workflow(r.workflow_type)) p
     WHERE public.provider_scope(p) = 'ACTS';
    IF COALESCE(v_explained, false) THEN CONTINUE; END IF;

    -- YY1(c): the learned profile explains it when EVERY provider in the chain
    -- sits on a channel this court is evidenced not to use.
    SELECT bool_and(public.despacho_profile_explains_absence(
             r.radicado, CASE WHEN public.provider_scope(p)='ACTS' THEN 'ACTS' ELSE 'ESTADOS' END, now()))
      INTO v_profiled
      FROM unnest(public.provider_chain_for_workflow(r.workflow_type)) p;
    IF COALESCE(v_profiled, false) THEN CONTINUE; END IF;

    IF r.coverage_status = 'NUNCA_INGERIDO' THEN
      v_reason := 'NUNCA_INGERIDO'; v_title := 'Monitoreo sin datos desde la inscripción';
    ELSIF r.coverage_status = 'ENROLAMIENTO_PARCIAL' THEN
      v_reason := 'ENROLAMIENTO_PARCIAL'; v_title := 'Cobertura incompleta de proveedores';
    ELSE
      v_reason := r.coverage_status; v_title := 'Proceso monitoreado sin proveedor activo';
    END IF;

    BEGIN
      INSERT INTO public.alert_instances (
        owner_id, organization_id, entity_id, entity_type,
        severity, alert_type, alert_source, title, message, status, fingerprint, payload
      ) VALUES (
        r.owner_id, r.organization_id, r.work_item_id, 'WORK_ITEM',
        'WARN'::public.alert_severity,
        CASE WHEN v_reason = 'NUNCA_INGERIDO' THEN 'MONITOREO_SIN_INGESTA' ELSE 'MONITOREO_SIN_PROVEEDOR' END,
        'SISTEMA', v_title,
        'El proceso ' || COALESCE(r.radicado, '(sin radicado)') || ' está monitoreado pero ' ||
        CASE WHEN v_reason = 'NUNCA_INGERIDO'
             THEN 'nunca ha recibido una actuación ni un estado, aunque ya tuvo lecturas exitosas de sus proveedores.'
             ELSE 'no está inscrito con los proveedores esperados (' || array_to_string(r.missing_providers, ', ') || ').' END,
        'PENDING',
        public.build_dedupe_key('monitoreo_' || lower(v_reason), r.work_item_id::text, v_day),
        jsonb_build_object('radicado', r.radicado, 'reason', v_reason,
          'act_count', r.act_count, 'publication_count', r.publication_count,
          'last_ingest', r.last_ingest, 'last_ok_run', r.last_ok_run,
          'expected_providers', r.expected_providers,
          'enrolled_providers', r.enrolled_providers,
          'missing_providers', r.missing_providers)
      ) ON CONFLICT (fingerprint) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[detect_stale_monitoring] alert insert failed: %', SQLERRM;
    END;

    work_item_id := r.work_item_id; radicado := r.radicado; reason := v_reason;
    days_since_ingest := COALESCE(r.days_since_ingest, 9999);
    RETURN NEXT;
  END LOOP;
END $function$;

-- ---------------------------------------------------------------------------
-- YY3 — one-time reconciliation notices. Delivered once, never counted as
-- novedades, never re-sent.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.digest_reconciliation_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  organization_id uuid,
  work_item_id uuid REFERENCES public.work_items(id) ON DELETE CASCADE,
  notice_key text NOT NULL,
  headline text NOT NULL,
  detail text NOT NULL,
  rows_count integer NOT NULL DEFAULT 0,
  from_date date,
  to_date date,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, notice_key)
);

GRANT SELECT ON public.digest_reconciliation_notices TO authenticated;
GRANT ALL ON public.digest_reconciliation_notices TO service_role;
ALTER TABLE public.digest_reconciliation_notices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners read their reconciliation notices"
  ON public.digest_reconciliation_notices FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

CREATE TRIGGER trg_digest_reconciliation_notices_updated_at
  BEFORE UPDATE ON public.digest_reconciliation_notices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();