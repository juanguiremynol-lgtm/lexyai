ALTER TABLE public.despacho_coverage
  ADD COLUMN IF NOT EXISTS annual_volumes jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS alias_status text NOT NULL DEFAULT 'UNANSWERED';

DO $$ BEGIN
  ALTER TABLE public.despacho_coverage
    ADD CONSTRAINT despacho_coverage_alias_status_check
    CHECK (alias_status IN ('CONFIRMED','UNANSWERED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.despacho_coverage.annual_volumes IS
  'Authoritative provider census totals by calendar year; never derived from portfolio data.';
COMMENT ON COLUMN public.despacho_coverage.alias_status IS
  'CONFIRMED when the census supplied an alias; UNANSWERED means no alias answer was supplied, not that none exists.';
COMMENT ON COLUMN public.despacho_coverage.monthly_presence IS
  'Sparse authoritative map of YYYY-MM to measured publication count. Missing key means unknown; only an explicit zero is silencing evidence.';

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY radicado_prefix, provider_key
           ORDER BY (census_source = 'PP_COVERAGE') DESC,
                    checked_at DESC NULLS LAST,
                    updated_at DESC,
                    id
         ) AS rn
  FROM public.despacho_coverage
)
DELETE FROM public.despacho_coverage d
USING ranked r
WHERE d.id = r.id AND r.rn > 1;

ALTER TABLE public.despacho_coverage
  DROP CONSTRAINT IF EXISTS despacho_coverage_radicado_prefix_provider_key_workflow_type_key;
DROP INDEX IF EXISTS public.despacho_coverage_radicado_prefix_provider_key_workflow_type_key;
CREATE UNIQUE INDEX IF NOT EXISTS despacho_coverage_prefix_provider_uidx
  ON public.despacho_coverage (radicado_prefix, provider_key);

WITH census(code, alias, label, date_from, date_until, conf_from, conf_until, y2024, y2025, y2026, total, monthly) AS (
  VALUES
    ('050014003011', NULL::text, 'Juzgado 011 Civil Municipal de Medellín', DATE '2024-05-24', DATE '2026-08-05', 'CENSORED', 'OPEN', 30, 1, 119, 150, '{"2025-01":0,"2025-02":0,"2025-03":0,"2025-04":0,"2025-05":0,"2025-06":0,"2025-07":0,"2025-08":0,"2025-09":0,"2025-10":0,"2025-11":0}'::jsonb),
    ('110013110013', NULL, 'Juzgado 013 de Familia de Bogotá', DATE '2024-05-08', DATE '2026-08-04', 'CENSORED', 'OPEN', 67, 96, 50, 213, '{}'::jsonb),
    ('050014003023', NULL, 'Juzgado 023 Civil Municipal de Medellín', DATE '2024-05-15', DATE '2026-08-05', 'CENSORED', 'OPEN', 98, 157, 88, 343, '{}'::jsonb),
    ('050303189001', NULL, 'Juzgado 001 de Pequeñas Causas de Amagá', DATE '2025-04-11', DATE '2026-07-23', 'GENUINE', 'OPEN', 0, 41, 16, 57, '{"2026-01":0,"2026-03":0,"2026-04":0}'::jsonb),
    ('050884003005', NULL, 'Juzgado 005 Civil Municipal de Bello', DATE '2024-05-16', DATE '2026-08-05', 'CENSORED', 'OPEN', 91, 108, 72, 271, '{"2025-11":0,"2025-12":0,"2026-01":0}'::jsonb),
    ('080013153006', '080013103006', 'Juzgado 006 Civil Municipal de Barranquilla', DATE '2024-05-17', DATE '2026-08-05', 'CENSORED', 'OPEN', 116, 156, 82, 354, '{}'::jsonb),
    ('057613189001', NULL, 'Juzgado 001 de Pequeñas Causas de Sopetrán', NULL::date, NULL::date, 'NEVER_PUBLISHED', 'NEVER_PUBLISHED', 0, 0, 0, 0, '{}'::jsonb),
    ('050014003015', NULL, 'Juzgado 015 Civil Municipal de Medellín', DATE '2024-05-15', DATE '2026-08-04', 'CENSORED', 'OPEN', 135, 107, 58, 300, '{}'::jsonb),
    ('050014003020', NULL, 'Juzgado 020 Civil Municipal de Medellín', DATE '2024-05-17', DATE '2026-08-05', 'CENSORED', 'OPEN', 130, 195, 108, 433, '{}'::jsonb),
    ('053763112001', NULL, 'Juzgado 001 Civil del Circuito de La Ceja', DATE '2024-05-21', DATE '2026-03-04', 'CENSORED', 'GENUINE', 97, 171, 8, 276, '{}'::jsonb)
)
INSERT INTO public.despacho_coverage AS d
  (radicado_prefix, provider_key, workflow_type, despacho_label, publishes,
   publishes_from, publishes_until, from_confidence, until_confidence,
   portal_alias, alias_status, annual_volumes, monthly_presence,
   census_source, checked_at, evidence, note)
SELECT code, 'publicaciones', NULL, label, conf_from <> 'NEVER_PUBLISHED',
       date_from, date_until, conf_from, conf_until,
       alias, CASE WHEN alias IS NULL THEN 'UNANSWERED' ELSE 'CONFIRMED' END,
       jsonb_build_object('2024',y2024,'2025',y2025,'2026',y2026,'total',total), monthly,
       'PP_COVERAGE', now(),
       jsonb_build_object('authority','GCP measured PP_COVERAGE census','seed_iteration',36,
                          'monthly_detail','Only explicitly supplied zero months are recorded; absent keys remain unknown.'),
       'Iteración 36: medición autoritativa de GCP; no derivada de datos del portafolio.'
FROM census
ON CONFLICT (radicado_prefix, provider_key) DO UPDATE SET
  despacho_label = EXCLUDED.despacho_label,
  workflow_type = NULL,
  publishes = EXCLUDED.publishes,
  publishes_from = EXCLUDED.publishes_from,
  publishes_until = EXCLUDED.publishes_until,
  from_confidence = EXCLUDED.from_confidence,
  until_confidence = EXCLUDED.until_confidence,
  portal_alias = EXCLUDED.portal_alias,
  alias_status = EXCLUDED.alias_status,
  annual_volumes = EXCLUDED.annual_volumes,
  monthly_presence = EXCLUDED.monthly_presence,
  census_source = EXCLUDED.census_source,
  checked_at = EXCLUDED.checked_at,
  evidence = EXCLUDED.evidence,
  note = EXCLUDED.note,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.despacho_window_covers(
  p_radicado text, p_provider text, p_date date)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
  SELECT COALESCE(
    (SELECT CASE
       WHEN c.from_confidence = 'NEVER_PUBLISHED' OR c.until_confidence = 'NEVER_PUBLISHED' THEN false
       WHEN c.publishes_from IS NOT NULL AND p_date < c.publishes_from AND c.from_confidence = 'GENUINE' THEN false
       WHEN c.publishes_until IS NOT NULL AND p_date > c.publishes_until AND c.until_confidence = 'GENUINE' THEN false
       WHEN c.monthly_presence ? to_char(p_date,'YYYY-MM')
            AND (c.monthly_presence ->> to_char(p_date,'YYYY-MM'))::int = 0 THEN false
       ELSE true
     END
       FROM public.despacho_coverage c
      WHERE c.provider_key = p_provider
        AND left(regexp_replace(COALESCE(p_radicado,''), '\D', '', 'g'), length(c.radicado_prefix)) = c.radicado_prefix
      ORDER BY length(c.radicado_prefix) DESC
      LIMIT 1),
    true);
$fn$;

CREATE OR REPLACE FUNCTION public.act_is_remision_expediente(
  p_description text, p_act_type text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT (
    t LIKE '%envio a superior%'
    OR t LIKE '%envio a otro despacho%'
    OR t LIKE '%envio a otros despachos%'
    OR t LIKE '%salida finalizando instancia%'
    OR t LIKE '%remision expediente%'
    OR (t LIKE '%remi%' AND (
          t LIKE '%superior%' OR t LIKE '%competencia%' OR t LIKE '%incompeten%'
          OR t LIKE '%otro despacho%' OR t LIKE '%otros despachos%' OR t LIKE '%otro juzgado%'))
  )
  FROM (SELECT public.estados_signal_norm(
          COALESCE(p_description,'') || ' ' || COALESCE(p_act_type,'')) AS t) s;
$fn$;

CREATE OR REPLACE FUNCTION public.classify_work_item_estados_signal(p_work_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $fn$
DECLARE
  w public.work_items%ROWTYPE;
  v_estados_provider text;
  v_acts int := 0; v_pubs int := 0; v_fij int := 0;
  v_unmatched jsonb := '[]'::jsonb; v_out_window jsonb := '[]'::jsonb;
  v_sin_doc jsonb := '[]'::jsonb; v_remitido jsonb := '[]'::jsonb;
  v_recent int := 0; v_alertable int := 0; v_last_fij date; v_class text;
  v_declared boolean := false; v_hist_sweep_at date;
  v_daily_horizon date := CURRENT_DATE - 120; v_alertable_this boolean;
  v_remision_date date; v_remision_desc text; r record;
BEGIN
  SELECT * INTO w FROM public.work_items WHERE id = p_work_item_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_estados_provider := public.estados_provider_for_workflow(w.workflow_type::text);
  SELECT count(*) INTO v_acts FROM public.work_item_acts a WHERE a.work_item_id=p_work_item_id AND a.is_archived IS NOT TRUE;
  SELECT count(*) INTO v_pubs FROM public.work_item_publicaciones p WHERE p.work_item_id=p_work_item_id AND p.is_archived IS NOT TRUE AND public.pub_matches_provider(p.source,v_estados_provider);
  SELECT EXISTS (SELECT 1 FROM public.despacho_coverage c WHERE c.publishes=false AND c.provider_key=COALESCE(v_estados_provider,'') AND left(regexp_replace(COALESCE(w.radicado,''),'\D','','g'),length(c.radicado_prefix))=c.radicado_prefix) INTO v_declared;
  SELECT max(COALESCE(r2.finished_at,r2.started_at))::date INTO v_hist_sweep_at FROM public.external_sync_runs r2 WHERE r2.work_item_id=p_work_item_id AND upper(COALESCE(r2.run_mode,'')) IN ('HISTORICO','HISTORIC','BACKFILL','FULL');
  SELECT COALESCE(a.act_date,a.event_date),left(COALESCE(a.description,''),200) INTO v_remision_date,v_remision_desc FROM public.work_item_acts a WHERE a.work_item_id=p_work_item_id AND a.is_archived IS NOT TRUE AND public.act_is_remision_expediente(a.description,a.act_type) AND COALESCE(a.act_date,a.event_date) IS NOT NULL ORDER BY COALESCE(a.act_date,a.event_date) DESC LIMIT 1;
  FOR r IN SELECT a.id,COALESCE(a.act_date,a.event_date) AS d,a.description FROM public.work_item_acts a WHERE a.work_item_id=p_work_item_id AND a.is_archived IS NOT TRUE AND public.act_is_fijacion_estado(a.description,a.act_type) LOOP
    v_fij:=v_fij+1;
    IF r.d IS NOT NULL AND (v_last_fij IS NULL OR r.d>v_last_fij) THEN v_last_fij:=r.d; END IF;
    IF EXISTS (SELECT 1 FROM public.work_item_publicaciones p WHERE p.work_item_id=p_work_item_id AND p.is_archived IS NOT TRUE AND public.pub_matches_provider(p.source,v_estados_provider) AND r.d IS NOT NULL AND COALESCE(p.fecha_fijacion::date,p.published_at::date,p.fecha_desfijacion::date) BETWEEN public.sub_business_days_sql(r.d,2) AND public.add_business_days_sql(r.d,2)) THEN CONTINUE; END IF;
    IF r.d IS NOT NULL AND EXISTS (SELECT 1 FROM public.estado_sin_documento e WHERE (e.work_item_id=p_work_item_id OR regexp_replace(COALESCE(e.radicado,''),'\D','','g')=regexp_replace(COALESCE(w.radicado,''),'\D','','g')) AND e.provider_key=COALESCE(v_estados_provider,'publicaciones') AND e.fecha_fijacion BETWEEN public.sub_business_days_sql(r.d,2) AND public.add_business_days_sql(r.d,2)) THEN v_sin_doc:=v_sin_doc||jsonb_build_object('act_id',r.id,'act_date',r.d,'description',left(COALESCE(r.description,''),160)); CONTINUE; END IF;
    IF r.d IS NOT NULL AND v_remision_date IS NOT NULL AND r.d BETWEEN (v_remision_date-15) AND v_remision_date THEN v_remitido:=v_remitido||jsonb_build_object('act_id',r.id,'act_date',r.d,'description',left(COALESCE(r.description,''),160),'remision_date',v_remision_date); CONTINUE; END IF;
    IF r.d IS NOT NULL AND NOT public.despacho_window_covers(w.radicado,COALESCE(v_estados_provider,'publicaciones'),r.d) THEN v_out_window:=v_out_window||jsonb_build_object('act_id',r.id,'act_date',r.d,'description',left(COALESCE(r.description,''),160)); CONTINUE; END IF;
    v_alertable_this:=r.d IS NOT NULL AND (r.d>=v_daily_horizon OR (v_hist_sweep_at IS NOT NULL AND v_hist_sweep_at>=r.d));
    v_unmatched:=v_unmatched||jsonb_build_object('act_id',r.id,'act_date',r.d,'description',left(COALESCE(r.description,''),160),'reciente',(r.d IS NOT NULL AND r.d>=CURRENT_DATE-90),'alcanzable_por_diario',COALESCE(v_alertable_this,false));
    IF r.d IS NOT NULL AND r.d>=CURRENT_DATE-90 THEN v_recent:=v_recent+1; END IF;
    IF v_alertable_this THEN v_alertable:=v_alertable+1; END IF;
  END LOOP;
  IF v_estados_provider IS NULL OR v_declared THEN v_class:='SIN_COBERTURA_DECLARADA';
  ELSIF jsonb_array_length(v_remitido)>0 THEN v_class:='REMITIDO_A_SUPERIOR';
  ELSIF jsonb_array_length(v_unmatched)>0 THEN v_class:='ESTADOS_ESPERADOS_AUSENTES';
  ELSIF jsonb_array_length(v_out_window)>0 THEN v_class:='SIN_COBERTURA_EN_ESA_FECHA';
  ELSIF jsonb_array_length(v_sin_doc)>0 THEN v_class:='ESTADO_SIN_DOCUMENTO';
  ELSIF v_acts>0 AND v_pubs=0 AND v_fij=0 THEN v_class:='ESTADOS_SIN_FIJACION_CONOCIDA'; ELSE v_class:='CUBIERTO'; END IF;
  RETURN jsonb_build_object('work_item_id',p_work_item_id,'organization_id',w.organization_id,'workflow_type',w.workflow_type::text,'radicado',w.radicado,'despacho',w.authority_name,'estados_provider',v_estados_provider,'signal_class',v_class,'acts_count',v_acts,'pubs_count',v_pubs,'fijacion_count',v_fij,'unmatched_fijacion_count',jsonb_array_length(v_unmatched),'out_of_window_count',jsonb_array_length(v_out_window),'sin_documento_count',jsonb_array_length(v_sin_doc),'remitido_count',jsonb_array_length(v_remitido),'remision_date',v_remision_date,'remision_description',v_remision_desc,'recent_unmatched_count',v_recent,'alertable_unmatched_count',v_alertable,'last_fijacion_date',v_last_fij,'historical_sweep_at',v_hist_sweep_at,'evidence',jsonb_build_object('unmatched_fijaciones',v_unmatched,'fuera_de_ventana',v_out_window,'estados_sin_documento',v_sin_doc,'remitidas',v_remitido));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.estados_coverage_summary()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $fn$
  SELECT jsonb_build_object(
    'computed_at',(SELECT max(computed_at) FROM public.work_item_estados_signal),
    'scope_portfolio','active monitored work_items only',
    'scope_provider_census','despacho-wide PP_COVERAGE census',
    'portfolio_items',(SELECT count(*) FROM public.work_item_estados_signal),
    'provider_census_orphans',(SELECT COALESCE(sum(orphan_count),0) FROM public.provider_coverage_census WHERE source='PP_COVERAGE'),
    'censored_edge_orphans',(SELECT COALESCE(sum(jsonb_array_length(COALESCE(evidence->'unmatched_fijaciones','[]'::jsonb))),0) FROM public.work_item_estados_signal s WHERE s.estados_provider='publicaciones' AND EXISTS (SELECT 1 FROM public.despacho_coverage c WHERE c.provider_key='publicaciones' AND left(regexp_replace(COALESCE(s.radicado,''),'\D','','g'),length(c.radicado_prefix))=c.radicado_prefix AND (c.from_confidence='CENSORED' OR c.until_confidence IN ('CENSORED','OPEN')))),
    'genuine_window_orphans',(SELECT COALESCE(sum(out_of_window_count),0) FROM public.work_item_estados_signal),
    'remision_orphans',(SELECT COALESCE(sum(remitido_count),0) FROM public.work_item_estados_signal),
    'unexplained_orphans',(SELECT COALESCE(sum(unmatched_fijacion_count),0) FROM public.work_item_estados_signal WHERE signal_class='ESTADOS_ESPERADOS_AUSENTES'),
    'alertable_unexplained_orphans',(SELECT COALESCE(sum(alertable_unmatched_count),0) FROM public.work_item_estados_signal WHERE signal_class='ESTADOS_ESPERADOS_AUSENTES'),
    'estados_esperados_ausentes',(SELECT count(*) FROM public.work_item_estados_signal WHERE signal_class='ESTADOS_ESPERADOS_AUSENTES'),
    'estados_ausentes_accionables',(SELECT count(*) FROM public.work_item_estados_signal WHERE signal_class='ESTADOS_ESPERADOS_AUSENTES' AND alertable_unmatched_count>0),
    'sin_cobertura_en_esa_fecha',(SELECT count(*) FROM public.work_item_estados_signal WHERE signal_class='SIN_COBERTURA_EN_ESA_FECHA'),
    'estado_sin_documento',(SELECT count(*) FROM public.work_item_estados_signal WHERE signal_class='ESTADO_SIN_DOCUMENTO'),
    'remitido_a_superior',(SELECT count(*) FROM public.work_item_estados_signal WHERE signal_class='REMITIDO_A_SUPERIOR'),
    'sin_fijacion_conocida',(SELECT count(*) FROM public.work_item_estados_signal WHERE signal_class='ESTADOS_SIN_FIJACION_CONOCIDA'),
    'sin_cobertura_declarada',(SELECT count(*) FROM public.work_item_estados_signal WHERE signal_class='SIN_COBERTURA_DECLARADA'),
    'cubierto',(SELECT count(*) FROM public.work_item_estados_signal WHERE signal_class='CUBIERTO'),
    'huerfanos_totales',(SELECT COALESCE(sum(unmatched_fijacion_count+out_of_window_count+remitido_count),0) FROM public.work_item_estados_signal),
    'anomalias',(SELECT COALESCE(jsonb_agg(jsonb_build_object('radicado',radicado,'despacho',despacho,'workflow',workflow_type,'proveedor',estados_provider,'fijaciones_sin_estado',unmatched_fijacion_count,'accionables',alertable_unmatched_count,'ultima_fijacion',last_fijacion_date)),'[]'::jsonb) FROM public.work_item_estados_signal WHERE signal_class='ESTADOS_ESPERADOS_AUSENTES' AND alertable_unmatched_count>0));
$fn$;

SELECT public.refresh_estados_coverage_signals(false);