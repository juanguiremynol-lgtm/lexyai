-- ================================================================
-- DATE INFERENCE SYSTEM: Add date metadata columns
-- Tracks date provenance and confidence for legal accuracy
-- ================================================================

-- Add date metadata columns to work_item_acts
ALTER TABLE public.work_item_acts
  ADD COLUMN IF NOT EXISTS date_source TEXT DEFAULT 'api_explicit',
  ADD COLUMN IF NOT EXISTS date_confidence TEXT DEFAULT 'high',
  ADD COLUMN IF NOT EXISTS api_fetched_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS api_scraped_at TIMESTAMPTZ DEFAULT NULL;

-- Add date metadata columns to work_item_publicaciones
ALTER TABLE public.work_item_publicaciones
  ADD COLUMN IF NOT EXISTS date_source TEXT DEFAULT 'api_explicit',
  ADD COLUMN IF NOT EXISTS date_confidence TEXT DEFAULT 'high',
  ADD COLUMN IF NOT EXISTS api_fetched_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS api_scraped_at TIMESTAMPTZ DEFAULT NULL;

-- Add check constraints for valid values on work_item_acts
-- Using DO block to avoid error if constraint already exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_date_source'
  ) THEN
    ALTER TABLE public.work_item_acts
      ADD CONSTRAINT check_date_source CHECK (date_source IN (
        'api_explicit',      -- Date came directly from API field
        'parsed_filename',   -- Parsed from filename
        'parsed_annotation', -- Parsed from annotation/description text
        'parsed_title',      -- Parsed from title
        'api_metadata',      -- From fetchedAt or similar API metadata
        'inferred_sync',     -- Fallback to sync date (low confidence)
        'manual'             -- Manually set by admin
      ));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_date_confidence'
  ) THEN
    ALTER TABLE public.work_item_acts
      ADD CONSTRAINT check_date_confidence CHECK (date_confidence IN (
        'high',    -- Explicit API date or clear filename pattern
        'medium',  -- Parsed from text with some ambiguity
        'low'      -- Inferred from sync date or unclear source
      ));
  END IF;
END $$;

-- Add check constraints for work_item_publicaciones
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_pub_date_source'
  ) THEN
    ALTER TABLE public.work_item_publicaciones
      ADD CONSTRAINT check_pub_date_source CHECK (date_source IN (
        'api_explicit', 'parsed_filename', 'parsed_annotation', 
        'parsed_title', 'api_metadata', 'inferred_sync', 'manual'
      ));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_pub_date_confidence'
  ) THEN
    ALTER TABLE public.work_item_publicaciones
      ADD CONSTRAINT check_pub_date_confidence CHECK (date_confidence IN (
        'high', 'medium', 'low'
      ));
  END IF;
END $$;

-- Add indexes for querying by confidence (for filtering low-confidence records)
CREATE INDEX IF NOT EXISTS idx_work_item_acts_date_confidence 
  ON public.work_item_acts(date_confidence);

CREATE INDEX IF NOT EXISTS idx_work_item_publicaciones_date_confidence 
  ON public.work_item_publicaciones(date_confidence);

-- Comment on columns for documentation
COMMENT ON COLUMN public.work_item_acts.date_source IS 'How the act_date was determined: api_explicit (from API field), parsed_filename, parsed_annotation, parsed_title, api_metadata (from fetchedAt), inferred_sync (fallback to sync date), or manual';
COMMENT ON COLUMN public.work_item_acts.date_confidence IS 'Confidence level of the date: high (explicit API date), medium (parsed from text), low (inferred from sync)';
COMMENT ON COLUMN public.work_item_acts.api_fetched_at IS 'When the external API fetched this record from Rama Judicial';
COMMENT ON COLUMN public.work_item_acts.api_scraped_at IS 'When the API service scraped this specific data';

COMMENT ON COLUMN public.work_item_publicaciones.date_source IS 'How the fecha_fijacion was determined: api_explicit, parsed_filename, parsed_annotation, api_metadata, inferred_sync, or manual';
COMMENT ON COLUMN public.work_item_publicaciones.date_confidence IS 'Confidence level of the publication date: high, medium, or low';
COMMENT ON COLUMN public.work_item_publicaciones.api_fetched_at IS 'When the external API fetched this publication';
COMMENT ON COLUMN public.work_item_publicaciones.api_scraped_at IS 'When the API service scraped this specific publication';