UPDATE public.work_items
SET last_error_code = 'UNCLASSIFIED_PROVIDER_SHAPE',
    last_error_meta = COALESCE(last_error_meta, '{}'::jsonb) || jsonb_build_object(
      'legacy_error_code', 'UNKNOWN_ERROR',
      'reclassified_at', now()
    )
WHERE last_error_code = 'UNKNOWN_ERROR';

CREATE OR REPLACE FUNCTION public.enforce_scrape_failure_reason()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.last_error_code = 'UNKNOWN_ERROR' THEN
    NEW.last_error_meta := COALESCE(NEW.last_error_meta, '{}'::jsonb) ||
      jsonb_build_object('rejected_error_code', 'UNKNOWN_ERROR');
    NEW.last_error_code := 'UNCLASSIFIED_PROVIDER_SHAPE';
  END IF;

  IF NEW.scrape_status = 'FAILED' AND NULLIF(btrim(NEW.last_error_code), '') IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'FAILED_READ_REQUIRES_REASON';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_scrape_failure_reason ON public.work_items;
CREATE TRIGGER trg_enforce_scrape_failure_reason
BEFORE INSERT OR UPDATE OF scrape_status, last_error_code ON public.work_items
FOR EACH ROW
EXECUTE FUNCTION public.enforce_scrape_failure_reason();