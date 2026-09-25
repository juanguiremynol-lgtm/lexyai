CREATE OR REPLACE FUNCTION public.enforce_samai_estados_no_fijacion()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_capture_enabled constant boolean := true;
  v_row jsonb;
  v_prov jsonb;
  v_link text;
BEGIN
  IF NEW.source = 'samai_estados' OR 'samai_estados' = ANY(COALESCE(NEW.sources, ARRAY[]::text[])) THEN
    v_row := CASE
      WHEN NEW.raw_data ? 'fecha_estado_procedencia' THEN NEW.raw_data
      WHEN (NEW.raw_data -> 'raw_data') ? 'fecha_estado_procedencia' THEN NEW.raw_data -> 'raw_data'
      ELSE NULL END;
    v_prov := CASE WHEN jsonb_typeof(v_row -> 'fecha_estado_procedencia') = 'object'
                   THEN v_row -> 'fecha_estado_procedencia' END;
    v_link := v_prov ->> 'vinculo';
    IF v_capture_enabled
       AND NEW.fecha_fijacion IS NOT NULL
       AND v_prov ->> 'fuente' = 'SAMAI_WESTADOS'
       AND v_link IN ('hash_documento', 'url_descarga')
       AND NULLIF(btrim(v_row ->> v_link), '') IS NOT NULL
       AND (v_row ->> 'fecha_estado_iso') ~ '^\d{4}-\d{2}-\d{2}$'
       AND (NEW.fecha_fijacion AT TIME ZONE 'America/Bogota')::date = (v_row ->> 'fecha_estado_iso')::date
    THEN
      NEW.fecha_desfijacion := NULL;
      RETURN NEW;
    END IF;
    NEW.fecha_providencia := COALESCE(NEW.fecha_providencia, NEW.fecha_fijacion);
    NEW.fecha_fijacion := NULL;
    NEW.fecha_desfijacion := NULL;
  END IF;
  RETURN NEW;
END;
$function$;