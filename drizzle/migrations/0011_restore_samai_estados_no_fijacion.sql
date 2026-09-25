CREATE OR REPLACE FUNCTION public.enforce_samai_estados_no_fijacion()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- SAMAI Estados never sends an estado date: any fecha_fijacion is hand-made and refused.
  IF NEW.source = 'samai_estados' OR 'samai_estados' = ANY(COALESCE(NEW.sources, ARRAY[]::text[])) THEN
    NEW.fecha_providencia := COALESCE(NEW.fecha_providencia, NEW.fecha_fijacion);
    NEW.fecha_fijacion := NULL;
    NEW.fecha_desfijacion := NULL;
  END IF;
  RETURN NEW;
END;
$$;