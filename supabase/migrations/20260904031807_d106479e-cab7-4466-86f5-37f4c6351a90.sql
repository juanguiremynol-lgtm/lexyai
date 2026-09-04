-- KC3(a): extend the estados-family guard on work_item_acts to UPDATE.
DROP TRIGGER IF EXISTS trg_reject_estados_family_in_work_item_acts ON public.work_item_acts;
CREATE TRIGGER trg_reject_estados_family_in_work_item_acts
BEFORE INSERT OR UPDATE ON public.work_item_acts
FOR EACH ROW EXECUTE FUNCTION public.reject_estados_family_in_work_item_acts();

-- KC3(b): mirror guard — actuaciones-family sources must never land in work_item_publicaciones.
CREATE OR REPLACE FUNCTION public.reject_actuaciones_family_in_work_item_publicaciones()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  norm_source text := lower(coalesce(NEW.source, ''));
BEGIN
  -- Exact matches only: 'samai_estados' is a legitimate estados source and must pass.
  IF norm_source IN ('cpnu', 'samai', 'cpnu_actuaciones', 'samai_actuaciones') THEN
    RAISE EXCEPTION
      'work_item_publicaciones rejects ACTUACIONES-family source (source=%). '
      'CPNU and SAMAI actuaciones must be persisted in work_item_acts, not work_item_publicaciones. '
      'See canonical provider policy.',
      NEW.source
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reject_actuaciones_family_in_work_item_publicaciones ON public.work_item_publicaciones;
CREATE TRIGGER trg_reject_actuaciones_family_in_work_item_publicaciones
BEFORE INSERT OR UPDATE ON public.work_item_publicaciones
FOR EACH ROW EXECUTE FUNCTION public.reject_actuaciones_family_in_work_item_publicaciones();