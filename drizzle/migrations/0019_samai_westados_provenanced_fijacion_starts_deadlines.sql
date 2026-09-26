DO $do$
DECLARE v_def text; v_old text; v_new text;
BEGIN
  v_def := pg_get_functiondef('public.compute_deadline_for_publicacion(uuid)'::regprocedure);
  v_old := $o$  IF v_pub.source = 'samai_estados'
     OR 'samai_estados' = ANY(COALESCE(v_pub.sources, ARRAY[]::text[])) THEN
    RETURN NULL;
  END IF;$o$;
  v_new := $n$  -- SAMAI Estados rows are skipped unless their fijación carries GCP's
  -- SAMAI_WESTADOS capture provenance (the six checks run at write time in
  -- enforce_samai_estados_no_fijacion; a row without them has no fijación).
  IF (v_pub.source = 'samai_estados'
      OR 'samai_estados' = ANY(COALESCE(v_pub.sources, ARRAY[]::text[])))
     AND COALESCE(
           (SELECT p2.raw_data -> 'fecha_estado_procedencia' ->> 'fuente'
              FROM public.work_item_publicaciones p2 WHERE p2.id = p_pub_id),
           (SELECT p2.raw_data -> 'raw_data' -> 'fecha_estado_procedencia' ->> 'fuente'
              FROM public.work_item_publicaciones p2 WHERE p2.id = p_pub_id),
           '') <> 'SAMAI_WESTADOS' THEN
    RETURN NULL;
  END IF;$n$;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'samai skip block not found in compute_deadline_for_publicacion';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$do$;

CREATE OR REPLACE FUNCTION public.trg_compute_deadline_on_pub()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_eligible boolean := false; v_outcome text; v_existing uuid; v_is_samai boolean;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.fecha_fijacion IS NOT NULL AND COALESCE(NEW.is_archived,false) = false THEN
    v_eligible := true;
  ELSIF TG_OP = 'UPDATE' AND OLD.fecha_fijacion IS NULL AND NEW.fecha_fijacion IS NOT NULL
        AND COALESCE(NEW.is_archived,false) = false THEN
    v_eligible := true;
  END IF;
  IF NOT v_eligible THEN RETURN NEW; END IF;
  v_is_samai := NEW.source = 'samai_estados' OR 'samai_estados' = ANY(COALESCE(NEW.sources, ARRAY[]::text[]));
  BEGIN
    v_id := public.compute_deadline_for_publicacion(NEW.id);
    IF v_id IS NOT NULL THEN
      v_outcome := 'DEADLINE_CREATED';
    ELSIF v_is_samai AND COALESCE(NEW.raw_data -> 'fecha_estado_procedencia' ->> 'fuente',
                                  NEW.raw_data -> 'raw_data' -> 'fecha_estado_procedencia' ->> 'fuente', '') <> 'SAMAI_WESTADOS' THEN
      v_outcome := 'SKIPPED_SAMAI_ESTADOS';
    ELSE
      -- 1) Folded into an existing term by corroborate_duplicate_deadline
      --    (same type, ≤3 business days, any source): exact match on pub_id.
      SELECT d.id INTO v_existing FROM public.work_item_deadlines d
       WHERE d.work_item_id = NEW.work_item_id
         AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(d.calculation_meta -> 'corroborations','[]'::jsonb)) c
                      WHERE c -> 'meta' ->> 'pub_id' = NEW.id::text)
       ORDER BY d.created_at LIMIT 1;
      -- 2) Collided on (work_item, type, trigger_date) via ON CONFLICT DO NOTHING.
      IF v_existing IS NULL THEN
        SELECT d.id INTO v_existing FROM public.work_item_deadlines d
         WHERE d.work_item_id = NEW.work_item_id
           AND d.trigger_event = 'ESTADO_NUEVO'
           AND d.trigger_date = (NEW.fecha_fijacion AT TIME ZONE 'America/Bogota')::date
         ORDER BY d.created_at LIMIT 1;
      END IF;
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