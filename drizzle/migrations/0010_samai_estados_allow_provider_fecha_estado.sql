CREATE OR REPLACE FUNCTION public.enforce_samai_estados_no_fijacion()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  _fe_raw text;
  _fe date;
BEGIN
  IF NEW.source = 'samai_estados' OR 'samai_estados' = ANY(COALESCE(NEW.sources, ARRAY[]::text[])) THEN
    -- AUD1: SAMAI's own "Fecha Estado" IS the estado date. fecha_fijacion is
    -- kept ONLY when it equals the date the provider stated in the stored raw.
    -- Anything else (e.g. a providencia date) is still stripped: never inferred.
    _fe_raw := COALESCE(
      NULLIF(NEW.raw_data->>'Fecha Estado',''),
      NULLIF(NEW.raw_data->>'fecha_estado_raw',''),
      NULLIF(NEW.raw_data->>'fecha_estado_normalizada',''),
      NULLIF(NEW.raw_data->'raw_data'->>'Fecha Estado',''),
      NULLIF(NEW.raw_data->'raw_data'->>'fecha_estado_normalizada','')
    );
    BEGIN
      IF _fe_raw ~ '^\d{4}-\d{2}-\d{2}' THEN
        _fe := substr(_fe_raw, 1, 10)::date;
      ELSIF _fe_raw ~ '^\d{2}/\d{2}/\d{4}$' THEN
        _fe := to_date(_fe_raw, 'DD/MM/YYYY');
      ELSE
        _fe := NULL;
      END IF;
    EXCEPTION WHEN others THEN
      _fe := NULL;
    END;

    IF _fe IS NOT NULL AND NEW.fecha_fijacion IS NOT NULL
       AND (NEW.fecha_fijacion AT TIME ZONE 'UTC')::date = _fe THEN
      NULL; -- provider-stated estado date: keep it
    ELSE
      NEW.fecha_providencia := COALESCE(NEW.fecha_providencia, NEW.fecha_fijacion);
      NEW.fecha_fijacion := NULL;
    END IF;
    NEW.fecha_desfijacion := NULL;
  END IF;
  RETURN NEW;
END;
$function$;