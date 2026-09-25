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
