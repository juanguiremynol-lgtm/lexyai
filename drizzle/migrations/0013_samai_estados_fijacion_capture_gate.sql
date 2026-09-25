CREATE OR REPLACE FUNCTION public.enforce_samai_estados_no_fijacion()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  -- AUD6(d): stays false until GCP's first capture lands. Enabling is a separate migration.
  v_capture_enabled constant boolean := false;
  v_prov jsonb;
BEGIN
  IF NEW.source = 'samai_estados' OR 'samai_estados' = ANY(COALESCE(NEW.sources, ARRAY[]::text[])) THEN
    v_prov := NEW.raw_data -> 'fecha_estado_provenance';
    IF v_capture_enabled
       AND NEW.fecha_fijacion IS NOT NULL
       AND v_prov ->> 'source' = 'samai_estado_list'
       AND NULLIF(btrim(NEW.raw_data ->> 'hash_documento'), '') IS NOT NULL
       AND btrim(v_prov ->> 'document_hash') = btrim(NEW.raw_data ->> 'hash_documento')
       AND (NEW.raw_data ->> 'fecha_estado') ~ '^\d{4}-\d{2}-\d{2}$'
       AND (NEW.fecha_fijacion AT TIME ZONE 'America/Bogota')::date = (NEW.raw_data ->> 'fecha_estado')::date
    THEN
      NEW.fecha_desfijacion := NULL;
      RETURN NEW;
    END IF;
    -- Everything else is refused, as before.
    NEW.fecha_providencia := COALESCE(NEW.fecha_providencia, NEW.fecha_fijacion);
    NEW.fecha_fijacion := NULL;
    NEW.fecha_desfijacion := NULL;
  END IF;
  RETURN NEW;
END;
$function$;