
-- Add radicado_raw column to preserve original user input
ALTER TABLE public.work_items ADD COLUMN IF NOT EXISTS radicado_raw TEXT;

-- Add CHECK constraint for normalized radicado format (23 digits only)
-- Using a validation trigger instead of CHECK constraint for flexibility
CREATE OR REPLACE FUNCTION public.validate_radicado_format()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Only validate if radicado is set and non-empty
  IF NEW.radicado IS NOT NULL AND NEW.radicado != '' THEN
    -- Must be exactly 23 digits
    IF NEW.radicado !~ '^\d{23}$' THEN
      RAISE EXCEPTION 'radicado must be exactly 23 digits, got: % (length %)', 
        LEFT(NEW.radicado, 30), LENGTH(NEW.radicado);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Create trigger (drop first if exists to avoid duplicates)
DROP TRIGGER IF EXISTS validate_radicado_on_work_items ON public.work_items;
CREATE TRIGGER validate_radicado_on_work_items
  BEFORE INSERT OR UPDATE OF radicado ON public.work_items
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_radicado_format();

-- Backfill radicado_raw from radicado for existing records
UPDATE public.work_items
SET radicado_raw = radicado
WHERE radicado IS NOT NULL AND radicado_raw IS NULL;
