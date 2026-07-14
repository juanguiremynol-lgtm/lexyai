-- Structural guard: reject inserts into work_item_acts whose source or source_platform
-- belongs to the ESTADOS provider family. ACTUACIONES = CPNU/SAMAI/Tutelas only;
-- ESTADOS providers (PP, Publicaciones) must never populate work_item_acts.
-- NOTE: samai_estados is intentionally NOT in the reject list yet — the 12 existing
-- rows are under review; we will extend the guard once their classification is confirmed.
CREATE OR REPLACE FUNCTION public.reject_estados_family_in_work_item_acts()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  norm_source     text := lower(coalesce(NEW.source, ''));
  norm_platform   text := lower(coalesce(NEW.source_platform, ''));
BEGIN
  IF norm_source     IN ('pp', 'publicaciones')
     OR norm_platform IN ('pp', 'publicaciones')
  THEN
    RAISE EXCEPTION
      'work_item_acts rejects ESTADOS-family source (source=%, source_platform=%). '
      'PP and Publicaciones must be persisted in work_item_publicaciones, not work_item_acts. '
      'See canonical provider policy.',
      NEW.source, NEW.source_platform
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reject_estados_family_in_work_item_acts ON public.work_item_acts;
CREATE TRIGGER trg_reject_estados_family_in_work_item_acts
BEFORE INSERT ON public.work_item_acts
FOR EACH ROW
EXECUTE FUNCTION public.reject_estados_family_in_work_item_acts();

COMMENT ON FUNCTION public.reject_estados_family_in_work_item_acts() IS
  'Structural guard enforcing canonical provider policy: ACTUACIONES = CPNU/SAMAI/Tutelas exclusively. '
  'ESTADOS-family providers (pp, publicaciones) are rejected at insert time. Added 2026-07-14 '
  'after cleaning up 7 PP-misrouted rows in work_item_acts.';