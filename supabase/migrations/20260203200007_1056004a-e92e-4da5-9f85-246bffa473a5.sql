-- Add sources array column for multi-source tracking in Tutela parallel sync
-- work_item_acts: track which providers confirmed each actuación
ALTER TABLE public.work_item_acts
  ADD COLUMN IF NOT EXISTS sources TEXT[] DEFAULT '{}';

-- Migrate existing data: copy source to sources array
UPDATE public.work_item_acts
SET sources = ARRAY[source]
WHERE (sources = '{}' OR sources IS NULL)
  AND source IS NOT NULL;

-- work_item_publicaciones: for future multi-source support
ALTER TABLE public.work_item_publicaciones
  ADD COLUMN IF NOT EXISTS sources TEXT[] DEFAULT '{}';

UPDATE public.work_item_publicaciones
SET sources = ARRAY[source]
WHERE (sources = '{}' OR sources IS NULL)
  AND source IS NOT NULL;

-- Index for queries filtering by sources (GIN for array containment)
CREATE INDEX IF NOT EXISTS idx_work_item_acts_sources 
  ON public.work_item_acts USING GIN (sources);

CREATE INDEX IF NOT EXISTS idx_work_item_publicaciones_sources 
  ON public.work_item_publicaciones USING GIN (sources);

-- Add comment for documentation
COMMENT ON COLUMN public.work_item_acts.sources IS 'Array of provider names that confirmed this actuación. Multiple sources = higher confidence.';
COMMENT ON COLUMN public.work_item_publicaciones.sources IS 'Array of provider names that confirmed this publicación.';