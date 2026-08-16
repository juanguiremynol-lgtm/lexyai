-- 1. Sync run status vocabulary: "the provider had not finished" is neither
--    success nor failure. Recording it as SUCCESS manufactured false absences.
ALTER TABLE public.external_sync_runs DROP CONSTRAINT IF EXISTS external_sync_runs_status_check;
ALTER TABLE public.external_sync_runs ADD CONSTRAINT external_sync_runs_status_check
  CHECK (status = ANY (ARRAY['RUNNING','SUCCESS','PARTIAL','FAILED','TIMEOUT','PENDING_UPSTREAM']));

ALTER TABLE public.external_sync_run_attempts DROP CONSTRAINT IF EXISTS external_sync_run_attempts_status_check;
ALTER TABLE public.external_sync_run_attempts ADD CONSTRAINT external_sync_run_attempts_status_check
  CHECK (status = ANY (ARRAY['success','not_found','empty','error','timeout','skipped','pending_upstream']));

-- 2. A work item's very first act ingestion is history arriving, never news —
--    even when the provider reports a plain daily run for its own cadence.
CREATE OR REPLACE FUNCTION public.stamp_act_discovery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_created timestamptz;
  v_enrolled date;
  v_mode text;
  v_provider text;
  v_has_prior boolean;
BEGIN
  SELECT created_at, (created_at AT TIME ZONE 'America/Bogota')::date
    INTO v_created, v_enrolled
  FROM work_items WHERE id = NEW.work_item_id;

  SELECT EXISTS (
    SELECT 1 FROM work_item_acts a
     WHERE a.work_item_id = NEW.work_item_id
       AND a.id IS DISTINCT FROM NEW.id
  ) INTO v_has_prior;

  v_provider := public.provider_run_mode_from_raw(NEW.raw_data);
  IF v_provider IS NOT NULL AND upper(v_provider) = 'INITIAL_LOAD' THEN
    NEW.ingest_run_mode := v_provider;
    NEW.ingest_run_mode_source := 'PROVIDER';
  ELSIF NOT v_has_prior THEN
    -- Local first ingest: the matter held zero acts before this row.
    NEW.ingest_run_mode := 'INITIAL_LOAD';
    NEW.ingest_run_mode_source := 'LOCAL_FIRST_INGEST';
  ELSIF v_provider IS NOT NULL THEN
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