ALTER TABLE public.pub_deadline_outcomes DROP CONSTRAINT IF EXISTS pub_deadline_outcomes_outcome_check;
ALTER TABLE public.pub_deadline_outcomes ADD CONSTRAINT pub_deadline_outcomes_outcome_check
  CHECK (outcome = ANY (ARRAY['DEADLINE_CREATED','NO_NEW_DEADLINE','COMPUTATION_FAILED',
                              'NO_RULE_APPLIED','DUPLICATE_EXISTING','SKIPPED_SAMAI_ESTADOS']));
COMMENT ON COLUMN public.pub_deadline_outcomes.outcome IS
  'NO_NEW_DEADLINE is legacy (pre-2026-09-26); new rows use NO_RULE_APPLIED / DUPLICATE_EXISTING / SKIPPED_SAMAI_ESTADOS.';

CREATE OR REPLACE FUNCTION public.trg_compute_deadline_on_pub()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_eligible boolean := false; v_outcome text; v_existing uuid;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.fecha_fijacion IS NOT NULL AND COALESCE(NEW.is_archived,false) = false THEN
    v_eligible := true;
  ELSIF TG_OP = 'UPDATE' AND OLD.fecha_fijacion IS NULL AND NEW.fecha_fijacion IS NOT NULL
        AND COALESCE(NEW.is_archived,false) = false THEN
    v_eligible := true;
  END IF;
  IF NOT v_eligible THEN RETURN NEW; END IF;
  BEGIN
    v_id := public.compute_deadline_for_publicacion(NEW.id);
    IF v_id IS NOT NULL THEN
      v_outcome := 'DEADLINE_CREATED';
    ELSIF NEW.source = 'samai_estados' OR 'samai_estados' = ANY(COALESCE(NEW.sources, ARRAY[]::text[])) THEN
      v_outcome := 'SKIPPED_SAMAI_ESTADOS';
    ELSE
      -- Observation only: an estado-anchored deadline already on this matter
      -- for the same fijación date means the insert collided (ON CONFLICT DO NOTHING).
      SELECT d.id INTO v_existing FROM public.work_item_deadlines d
       WHERE d.work_item_id = NEW.work_item_id
         AND d.trigger_event = 'ESTADO_NUEVO'
         AND d.trigger_date = (NEW.fecha_fijacion AT TIME ZONE 'America/Bogota')::date
       ORDER BY d.created_at LIMIT 1;
      v_outcome := CASE WHEN v_existing IS NOT NULL THEN 'DUPLICATE_EXISTING' ELSE 'NO_RULE_APPLIED' END;
      v_id := v_existing;
    END IF;
    INSERT INTO public.pub_deadline_outcomes(publicacion_id, work_item_id, fecha_fijacion, trigger_op, outcome, deadline_id)
    VALUES (NEW.id, NEW.work_item_id, NEW.fecha_fijacion, TG_OP, v_outcome, v_id);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.pub_deadline_outcomes(publicacion_id, work_item_id, fecha_fijacion, trigger_op, outcome, error_message, sqlstate)
    VALUES (NEW.id, NEW.work_item_id, NEW.fecha_fijacion, TG_OP, 'COMPUTATION_FAILED', left(SQLERRM,500), SQLSTATE);
    INSERT INTO public.trigger_error_log(trigger_name, table_name, error_message, sqlstate, work_item_id)
    VALUES ('trg_compute_deadline_on_pub','work_item_publicaciones', left(SQLERRM,500), SQLSTATE, NEW.work_item_id);
  END;
  RETURN NEW;
END; $function$;