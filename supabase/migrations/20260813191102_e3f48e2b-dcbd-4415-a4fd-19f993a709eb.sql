-- Iteration 54: canonical stamping on first ingestion + INITIAL_LOAD discovery mode

-- 1. INITIAL_LOAD is a sweep-like run mode (history arriving for the first time)
CREATE OR REPLACE FUNCTION public.is_backfill_source(p_source text, p_run_mode text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
  SELECT COALESCE(upper(p_run_mode), 'DAILY') IN ('SWEEP','FULL_SWEEP','HISTORICAL','BACKFILL','IMPORT','INITIAL_LOAD')
      OR upper(COALESCE(p_source, '')) IN ('ICARUS_IMPORT','MIGRATION','EMAIL_IMPORT','MANUAL_IMPORT','SWEEP');
$function$;

CREATE OR REPLACE FUNCTION public.classify_discovery(p_legal_date date, p_detected_at timestamp with time zone, p_run_mode text, p_enrolled_on date)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $function$
DECLARE
  v_mode text := COALESCE(upper(p_run_mode), 'DAILY');
  v_sweep boolean := v_mode IN ('SWEEP', 'FULL_SWEEP', 'HISTORICAL', 'BACKFILL', 'IMPORT', 'INITIAL_LOAD');
  v_initial boolean := v_mode = 'INITIAL_LOAD';
  v_recent boolean;
  v_pre_enrollment boolean;
BEGIN
  -- A work item's first ingestion is history arriving for the first time,
  -- never a court registering an entry late. Never NEWS, never retroactive.
  IF v_initial THEN
    RETURN 'HISTORICO_DETECTADO';
  END IF;

  v_recent := p_legal_date IS NOT NULL AND NOT public.is_historico_by_legal_date(p_legal_date);
  IF v_recent THEN
    RETURN 'NOVEDAD';
  END IF;

  IF p_legal_date IS NULL THEN
    RETURN CASE WHEN v_sweep THEN 'HISTORICO_DETECTADO' ELSE 'NOVEDAD' END;
  END IF;

  v_pre_enrollment := p_enrolled_on IS NOT NULL AND p_legal_date < p_enrolled_on;

  IF v_sweep AND v_pre_enrollment THEN
    RETURN 'HISTORICO_DETECTADO';
  END IF;

  RETURN 'ACTUACION_RETROACTIVA';
END;
$function$;

-- 2. Detect the initial-load window (first ingestion after work item creation)
CREATE OR REPLACE FUNCTION public.is_initial_load_window(p_work_item_created_at timestamptz, p_detected_at timestamptz)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
  SELECT p_work_item_created_at IS NOT NULL
     AND COALESCE(p_detected_at, now()) <= p_work_item_created_at + interval '30 minutes';
$function$;

-- 3. Acts: stamp run mode + discovery
CREATE OR REPLACE FUNCTION public.stamp_act_discovery()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_created timestamptz;
  v_enrolled date;
  v_mode text;
BEGIN
  SELECT created_at, (created_at AT TIME ZONE 'America/Bogota')::date
    INTO v_created, v_enrolled
  FROM work_items WHERE id = NEW.work_item_id;

  IF public.is_initial_load_window(v_created, NEW.detected_at) THEN
    NEW.ingest_run_mode := 'INITIAL_LOAD';
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
BEGIN
  SELECT created_at, (created_at AT TIME ZONE 'America/Bogota')::date
    INTO v_created, v_enrolled
  FROM work_items WHERE id = NEW.work_item_id;

  IF public.is_initial_load_window(v_created, NEW.detected_at) THEN
    NEW.ingest_run_mode := 'INITIAL_LOAD';
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

-- 4. Canonical stamping: every non-archived ingested row is canonical at write time
CREATE OR REPLACE FUNCTION public.stamp_canonical_on_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  IF COALESCE(NEW.is_archived, false) = false AND COALESCE(NEW.is_canonical, false) = false THEN
    NEW.is_canonical := true;
    NEW.canonical_at := COALESCE(NEW.canonical_at, now());
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_stamp_act_canonical ON public.work_item_acts;
CREATE TRIGGER trg_stamp_act_canonical
  BEFORE INSERT ON public.work_item_acts
  FOR EACH ROW EXECUTE FUNCTION public.stamp_canonical_on_insert();

DROP TRIGGER IF EXISTS trg_stamp_pub_canonical ON public.work_item_publicaciones;
CREATE TRIGGER trg_stamp_pub_canonical
  BEFORE INSERT ON public.work_item_publicaciones
  FOR EACH ROW EXECUTE FUNCTION public.stamp_canonical_on_insert();

ALTER TABLE public.work_item_acts ALTER COLUMN is_canonical SET DEFAULT true;
ALTER TABLE public.work_item_publicaciones ALTER COLUMN is_canonical SET DEFAULT true;