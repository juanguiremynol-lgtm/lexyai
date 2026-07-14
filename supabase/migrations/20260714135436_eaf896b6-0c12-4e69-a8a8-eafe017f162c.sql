-- Extend the estados-family guard to include samai_estados. Same enforcement,
-- broader scope. Existing rows are unaffected (BEFORE INSERT only).
CREATE OR REPLACE FUNCTION public.reject_estados_family_in_work_item_acts()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  norm_source   text := lower(coalesce(NEW.source, ''));
  norm_platform text := lower(coalesce(NEW.source_platform, ''));
BEGIN
  IF norm_source   IN ('pp', 'publicaciones', 'samai_estados')
     OR norm_platform IN ('pp', 'publicaciones', 'samai_estados')
  THEN
    RAISE EXCEPTION
      'work_item_acts rejects ESTADOS-family source (source=%, source_platform=%). '
      'PP, Publicaciones and SAMAI_ESTADOS must be persisted in work_item_publicaciones, '
      'not work_item_acts. See canonical provider policy.',
      NEW.source, NEW.source_platform
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.reject_estados_family_in_work_item_acts() IS
  'Structural guard enforcing canonical provider policy: ACTUACIONES = CPNU/SAMAI/Tutelas exclusively. '
  'ESTADOS-family providers (pp, publicaciones, samai_estados) are rejected at insert time. '
  'Extended on 2026-07-14 to include samai_estados after cleaning up 12 legacy misrouted rows.';