
-- ══════ ITERATION 55 ══════

-- A. Provider run provenance is authoritative; our window is only a fallback.

CREATE OR REPLACE FUNCTION public.provenance_migration_at()
RETURNS timestamptz LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT timestamptz '2026-08-13 00:00:00+00';
$$;

-- Maps the provider's run_type. NULL in → NULL out (UNKNOWN), never a guess.
CREATE OR REPLACE FUNCTION public.provider_run_mode_from_raw(p_raw jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE lower(nullif(btrim(coalesce(p_raw->>'run_type','')),''))
           WHEN 'initial_load' THEN 'INITIAL_LOAD'
           WHEN 'first_scan'   THEN 'INITIAL_LOAD'
           WHEN 'daily'        THEN 'DAILY'
           WHEN 'incremental'  THEN 'DAILY'
           WHEN 'full_sweep'   THEN 'FULL_SWEEP'
           WHEN 'historical'   THEN 'FULL_SWEEP'
           ELSE NULL
         END;
$$;

ALTER TABLE public.work_item_acts          ADD COLUMN IF NOT EXISTS ingest_run_mode_source text;
ALTER TABLE public.work_item_publicaciones ADD COLUMN IF NOT EXISTS ingest_run_mode_source text;

COMMENT ON COLUMN public.work_item_acts.ingest_run_mode_source IS
  'PROVIDER = the provider''s run_type decided; WINDOW_FALLBACK = our 30-minute post-creation window decided; UNKNOWN = neither could speak (run_type NULL is UNKNOWN, never initial load).';

-- The fallback window now applies ONLY when the provider said nothing AND the
-- row was detected after the provenance migration.
CREATE OR REPLACE FUNCTION public.is_initial_load_window(p_work_item_created_at timestamptz, p_detected_at timestamptz)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT p_work_item_created_at IS NOT NULL
     AND COALESCE(p_detected_at, now()) >= public.provenance_migration_at()
     AND COALESCE(p_detected_at, now()) <= p_work_item_created_at + interval '30 minutes';
$$;

CREATE OR REPLACE FUNCTION public.stamp_act_discovery()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_created timestamptz;
  v_enrolled date;
  v_mode text;
  v_provider text;
BEGIN
  SELECT created_at, (created_at AT TIME ZONE 'America/Bogota')::date
    INTO v_created, v_enrolled
  FROM work_items WHERE id = NEW.work_item_id;

  v_provider := public.provider_run_mode_from_raw(NEW.raw_data);
  IF v_provider IS NOT NULL THEN
    NEW.ingest_run_mode := v_provider;
    NEW.ingest_run_mode_source := 'PROVIDER';
  ELSIF public.is_initial_load_window(v_created, NEW.detected_at) THEN
    NEW.ingest_run_mode := 'INITIAL_LOAD';
    NEW.ingest_run_mode_source := 'WINDOW_FALLBACK';
  ELSE
    NEW.ingest_run_mode_source := COALESCE(NEW.ingest_run_mode_source, 'UNKNOWN');
  END IF;

  v_mode := CASE WHEN public.is_backfill_source(NEW.source, NEW.ingest_run_mode)
                 THEN COALESCE(NULLIF(upper(NEW.ingest_run_mode), 'DAILY'), 'SWEEP')
                 ELSE COALESCE(NEW.ingest_run_mode, 'DAILY') END;

  IF NEW.discovery_type IS NULL OR NEW.ingest_run_mode = 'INITIAL_LOAD' THEN
    NEW.discovery_type := public.classify_discovery(
      NEW.act_date, COALESCE(NEW.detected_at, now()), v_mode, v_enrolled);
  END IF;
  NEW.is_retroactive := (NEW.discovery_type = 'ACTUACION_RETROACTIVA');
  IF NEW.act_date IS NOT NULL THEN
    NEW.retro_gap_days := GREATEST(0, (COALESCE(NEW.detected_at, now()) AT TIME ZONE 'America/Bogota')::date - NEW.act_date);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.stamp_pub_discovery()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_legal date := COALESCE(NEW.fecha_fijacion::date, NEW.fecha_desfijacion::date, NEW.published_at::date);
  v_created timestamptz;
  v_enrolled date;
  v_mode text;
  v_provider text;
BEGIN
  SELECT created_at, (created_at AT TIME ZONE 'America/Bogota')::date
    INTO v_created, v_enrolled
  FROM work_items WHERE id = NEW.work_item_id;

  v_provider := public.provider_run_mode_from_raw(NEW.raw_data);
  IF v_provider IS NOT NULL THEN
    NEW.ingest_run_mode := v_provider;
    NEW.ingest_run_mode_source := 'PROVIDER';
  ELSIF public.is_initial_load_window(v_created, NEW.detected_at) THEN
    NEW.ingest_run_mode := 'INITIAL_LOAD';
    NEW.ingest_run_mode_source := 'WINDOW_FALLBACK';
  ELSE
    NEW.ingest_run_mode_source := COALESCE(NEW.ingest_run_mode_source, 'UNKNOWN');
  END IF;

  v_mode := CASE WHEN public.is_backfill_source(NEW.source, NEW.ingest_run_mode)
                 THEN COALESCE(NULLIF(upper(NEW.ingest_run_mode), 'DAILY'), 'SWEEP')
                 ELSE COALESCE(NEW.ingest_run_mode, 'DAILY') END;

  IF NEW.discovery_type IS NULL OR NEW.ingest_run_mode = 'INITIAL_LOAD' THEN
    NEW.discovery_type := public.classify_discovery(
      v_legal, COALESCE(NEW.detected_at, now()), v_mode, v_enrolled);
  END IF;
  NEW.is_retroactive := (NEW.discovery_type = 'ACTUACION_RETROACTIVA');
  IF v_legal IS NOT NULL THEN
    NEW.retro_gap_days := GREATEST(0, (COALESCE(NEW.detected_at, now()) AT TIME ZONE 'America/Bogota')::date - v_legal);
  END IF;
  RETURN NEW;
END;
$function$;

-- Which classifier decides, in practice.
CREATE OR REPLACE FUNCTION public.run_mode_authority_report(p_since interval DEFAULT interval '7 days')
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'since', (now() - p_since),
    'acts', (SELECT jsonb_object_agg(k, n) FROM (
        SELECT COALESCE(ingest_run_mode_source,'UNKNOWN') k, count(*) n
        FROM work_item_acts WHERE detected_at >= now() - p_since GROUP BY 1) s),
    'publicaciones', (SELECT jsonb_object_agg(k, n) FROM (
        SELECT COALESCE(ingest_run_mode_source,'UNKNOWN') k, count(*) n
        FROM work_item_publicaciones WHERE detected_at >= now() - p_since GROUP BY 1) s)
  );
$$;
GRANT EXECUTE ON FUNCTION public.run_mode_authority_report(interval) TO authenticated, service_role;

-- C. Census: measurement status + zero-report control discipline.

ALTER TABLE public.despacho_coverage
  ADD COLUMN IF NOT EXISTS measurement_status text NOT NULL DEFAULT 'NO_MEDIDO',
  ADD COLUMN IF NOT EXISTS control_despacho_code text,
  ADD COLUMN IF NOT EXISTS control_result jsonb;

COMMENT ON COLUMN public.despacho_coverage.measurement_status IS
  'MEDIDO | INDETERMINADO (the census window failed — not measured) | NO_MEDIDO';

CREATE OR REPLACE FUNCTION public.guard_zero_census_needs_control()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  v_total numeric := 0;
BEGIN
  IF NEW.measurement_status <> 'MEDIDO' THEN RETURN NEW; END IF;
  SELECT COALESCE(sum((value)::numeric), 0) INTO v_total
    FROM jsonb_each_text(COALESCE(NEW.annual_volumes, '{}'::jsonb));
  IF v_total = 0 AND NEW.control_despacho_code IS NULL THEN
    RAISE EXCEPTION 'Un censo en cero no puede registrarse como hecho sin un despacho de control (control_despacho_code)';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_zero_census ON public.despacho_coverage;
CREATE TRIGGER trg_guard_zero_census
  BEFORE INSERT OR UPDATE ON public.despacho_coverage
  FOR EACH ROW EXECUTE FUNCTION public.guard_zero_census_needs_control();

-- C1. Seed despacho 036 with GCP's measured values.
INSERT INTO public.despacho_coverage (
  radicado_prefix, despacho_label, note, provider_key, publishes, publishes_from, publishes_until,
  from_confidence, until_confidence, annual_volumes, monthly_presence,
  census_source, measurement_status, control_despacho_code, control_result, checked_at
) VALUES (
  '050014003036', 'Juzgado 036 Civil Municipal de Medellin',
  'Censo medido: 50 publicaciones en 2026, primera el 2026-05-27; cero en 2021-2025. Borde inicial GENUINE (749 dias despues del horizonte del portal). Control: despacho 016 del mismo circuito reproduce el horizonte del portal, luego los ceros son del despacho y no del instrumento.',
  'publicaciones', true, DATE '2026-05-27', DATE '2026-08-13',
  'GENUINE', 'OPEN',
  '{"2021":0,"2022":0,"2023":0,"2024":0,"2025":0,"2026":50}'::jsonb,
  '{}'::jsonb,
  'CENSO_DESPACHO', 'MEDIDO', '050014003016',
  jsonb_build_object(
    'despacho', '050014003016',
    'annual_volumes', jsonb_build_object('2024',137,'2025',204,'2026',116),
    'first_publication','2024-05-14',
    'from_confidence','CENSORED',
    'portal_horizon','2024-05-08',
    'reading','El control reproduce el horizonte del portal (6 dias), luego los ceros de 036 son del despacho y no del instrumento.'
  ),
  now()
)
ON CONFLICT (radicado_prefix, provider_key) DO UPDATE SET
  despacho_label = EXCLUDED.despacho_label,
  note = EXCLUDED.note,
  publishes = EXCLUDED.publishes,
  publishes_from = EXCLUDED.publishes_from,
  publishes_until = EXCLUDED.publishes_until,
  from_confidence = EXCLUDED.from_confidence,
  until_confidence = EXCLUDED.until_confidence,
  annual_volumes = EXCLUDED.annual_volumes,
  census_source = EXCLUDED.census_source,
  measurement_status = EXCLUDED.measurement_status,
  control_despacho_code = EXCLUDED.control_despacho_code,
  control_result = EXCLUDED.control_result,
  checked_at = now();

-- C3. Automatic census requests for despachos we have never measured.
CREATE TABLE IF NOT EXISTS public.despacho_census_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  despacho_code text NOT NULL,
  work_item_id uuid REFERENCES public.work_items(id) ON DELETE SET NULL,
  radicado text,
  status text NOT NULL DEFAULT 'PENDING',
  attempts int NOT NULL DEFAULT 0,
  result jsonb,
  error text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS despacho_census_requests_pending_uniq
  ON public.despacho_census_requests (despacho_code) WHERE status = 'PENDING';

GRANT SELECT ON public.despacho_census_requests TO authenticated;
GRANT ALL ON public.despacho_census_requests TO service_role;
ALTER TABLE public.despacho_census_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins read census requests"
  ON public.despacho_census_requests FOR SELECT TO authenticated
  USING (public.is_platform_admin());

CREATE TRIGGER trg_despacho_census_requests_updated_at
  BEFORE UPDATE ON public.despacho_census_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.enqueue_despacho_census_for_work_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_code text;
BEGIN
  v_code := left(regexp_replace(COALESCE(NEW.radicado,''), '\D', '', 'g'), 12);
  IF length(v_code) <> 12 THEN RETURN NEW; END IF;

  IF EXISTS (
    SELECT 1 FROM public.despacho_coverage
     WHERE radicado_prefix = v_code AND provider_key = 'publicaciones'
       AND measurement_status = 'MEDIDO'
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.despacho_census_requests (despacho_code, work_item_id, radicado)
  VALUES (v_code, NEW.id, NEW.radicado)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_despacho_census ON public.work_items;
CREATE TRIGGER trg_enqueue_despacho_census
  AFTER INSERT ON public.work_items
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_despacho_census_for_work_item();
