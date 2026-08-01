
CREATE OR REPLACE FUNCTION public.is_backfill_source(p_source text, p_run_mode text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(upper(p_run_mode), 'DAILY') IN ('SWEEP','FULL_SWEEP','HISTORICAL','BACKFILL','IMPORT')
      OR upper(COALESCE(p_source, '')) IN ('ICARUS_IMPORT','MIGRATION','EMAIL_IMPORT','MANUAL_IMPORT','SWEEP');
$$;

CREATE OR REPLACE FUNCTION public.stamp_act_discovery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_mode text := CASE WHEN public.is_backfill_source(NEW.source, NEW.ingest_run_mode)
                      THEN 'SWEEP' ELSE COALESCE(NEW.ingest_run_mode, 'DAILY') END;
BEGIN
  IF NEW.discovery_type IS NULL THEN
    NEW.discovery_type := public.classify_discovery(NEW.act_date, COALESCE(NEW.detected_at, now()), v_mode);
  END IF;
  NEW.is_retroactive := (NEW.discovery_type = 'ACTUACION_RETROACTIVA');
  IF NEW.act_date IS NOT NULL THEN
    NEW.retro_gap_days := GREATEST(0, (COALESCE(NEW.detected_at, now()) AT TIME ZONE 'America/Bogota')::date - NEW.act_date);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.stamp_pub_discovery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_legal date := COALESCE(NEW.fecha_fijacion::date, NEW.fecha_desfijacion::date, NEW.published_at::date);
  v_mode text := CASE WHEN public.is_backfill_source(NEW.source, NEW.ingest_run_mode)
                      THEN 'SWEEP' ELSE COALESCE(NEW.ingest_run_mode, 'DAILY') END;
BEGIN
  IF NEW.discovery_type IS NULL THEN
    NEW.discovery_type := public.classify_discovery(v_legal, COALESCE(NEW.detected_at, now()), v_mode);
  END IF;
  NEW.is_retroactive := (NEW.discovery_type = 'ACTUACION_RETROACTIVA');
  IF v_legal IS NOT NULL THEN
    NEW.retro_gap_days := GREATEST(0, (COALESCE(NEW.detected_at, now()) AT TIME ZONE 'America/Bogota')::date - v_legal);
  END IF;
  RETURN NEW;
END;
$$;

-- Reclassify already-imported historical rows misflagged as retroactive.
UPDATE public.work_item_acts
SET discovery_type = 'HISTORICO_DETECTADO', is_retroactive = false
WHERE discovery_type = 'ACTUACION_RETROACTIVA'
  AND public.is_backfill_source(source, ingest_run_mode);
