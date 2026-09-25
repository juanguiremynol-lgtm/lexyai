CREATE OR REPLACE FUNCTION public.is_strict_iso_date(_v text)
 RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public'
AS $f$
BEGIN
  IF _v IS NULL OR _v !~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN false; END IF;
  RETURN to_char(_v::date, 'YYYY-MM-DD') = _v;
EXCEPTION WHEN OTHERS THEN RETURN false;
END; $f$;

CREATE OR REPLACE FUNCTION public.enforce_samai_estados_no_fijacion()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE
  v_capture_enabled constant boolean := true;
  v_row jsonb; v_prov jsonb; v_link text; v_valid boolean := false;
BEGIN
  IF NOT (NEW.source = 'samai_estados' OR 'samai_estados' = ANY(COALESCE(NEW.sources, ARRAY[]::text[]))) THEN
    RETURN NEW;
  END IF;
  v_row := CASE
    WHEN NEW.raw_data ? 'fecha_estado_procedencia' THEN NEW.raw_data
    WHEN (NEW.raw_data -> 'raw_data') ? 'fecha_estado_procedencia' THEN NEW.raw_data -> 'raw_data'
    ELSE NULL END;
  v_prov := CASE WHEN jsonb_typeof(v_row -> 'fecha_estado_procedencia') = 'object' THEN v_row -> 'fecha_estado_procedencia' END;
  v_link := v_prov ->> 'vinculo';
  IF v_capture_enabled
     AND NEW.fecha_fijacion IS NOT NULL
     AND v_prov ->> 'fuente' = 'SAMAI_WESTADOS'
     AND v_link IN ('hash_documento','url_descarga')
     AND NULLIF(btrim(v_row ->> v_link), '') IS NOT NULL
     AND public.is_strict_iso_date(v_row ->> 'fecha_estado_iso')
     AND (NEW.fecha_fijacion AT TIME ZONE 'America/Bogota')::date = (v_row ->> 'fecha_estado_iso')::date
  THEN v_valid := true; END IF;

  -- A previously verified fijación is never erased or silently replaced.
  IF TG_OP = 'UPDATE' AND OLD.fecha_fijacion IS NOT NULL THEN
    IF v_valid AND NEW.fecha_fijacion IS DISTINCT FROM OLD.fecha_fijacion THEN
      INSERT INTO public.trigger_error_log(trigger_name, table_name, error_message, sqlstate, work_item_id)
      VALUES ('enforce_samai_estados_no_fijacion','work_item_publicaciones',
              format('FIJACION_CONFLICT pub=%s stored=%s incoming=%s', NEW.id, OLD.fecha_fijacion, NEW.fecha_fijacion),
              'FIJC', NEW.work_item_id);
    END IF;
    NEW.fecha_fijacion := OLD.fecha_fijacion;
    NEW.fecha_desfijacion := NULL;
    IF NOT v_valid THEN NEW.raw_data := COALESCE(OLD.raw_data, NEW.raw_data); END IF;
    RETURN NEW;
  END IF;

  IF NOT v_valid THEN
    -- Refused: the fijación is dropped. It is never repurposed as a providencia.
    NEW.fecha_fijacion := NULL;
  END IF;
  NEW.fecha_desfijacion := NULL;
  RETURN NEW;
END;
$function$;