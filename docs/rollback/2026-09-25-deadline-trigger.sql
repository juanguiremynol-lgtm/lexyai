-- Rollback for deadline trigger hardening (2026-09-25)
DROP TABLE IF EXISTS public.pub_deadline_outcomes;
CREATE OR REPLACE FUNCTION public.trg_compute_deadline_on_pub()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.fecha_fijacion IS NOT NULL AND COALESCE(NEW.is_archived, false) = false THEN
    PERFORM public.compute_deadline_for_publicacion(NEW.id);
  ELSIF TG_OP = 'UPDATE'
    AND OLD.fecha_fijacion IS NULL AND NEW.fecha_fijacion IS NOT NULL
    AND COALESCE(NEW.is_archived, false) = false THEN
    PERFORM public.compute_deadline_for_publicacion(NEW.id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[TRIGGER_SAFE] trg_compute_deadline_on_pub failed: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
  RETURN NEW;
END; $function$

;
CREATE TRIGGER trg_pub_compute_deadline AFTER INSERT OR UPDATE OF fecha_fijacion ON public.work_item_publicaciones FOR EACH ROW EXECUTE FUNCTION trg_compute_deadline_on_pub();
-- estados_probe_deferred_ids unchanged in DB; restore estadosMonitor.ts MA2 block from git to re-enable weekly cadence.
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
$function$

