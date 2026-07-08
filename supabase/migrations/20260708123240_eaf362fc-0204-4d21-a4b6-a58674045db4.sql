
-- Hearings: additive columns for the auto-extraction pipeline
ALTER TABLE public.hearings
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'scheduled',
  ADD COLUMN IF NOT EXISTS source_act_id UUID,
  ADD COLUMN IF NOT EXISTS extraction_method TEXT,
  ADD COLUMN IF NOT EXISTS time_inferred BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS discovery_type TEXT DEFAULT 'NOVEDAD';

-- Bound status values (loose check to stay additive)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'hearings_status_values_chk'
  ) THEN
    ALTER TABLE public.hearings
      ADD CONSTRAINT hearings_status_values_chk
      CHECK (status IN ('scheduled','superseded','suspended','past','cancelled'));
  END IF;
END $$;

-- Idempotency: at most one scheduled hearing per (work_item, moment)
CREATE UNIQUE INDEX IF NOT EXISTS uq_hearings_scheduled_per_wi_moment
  ON public.hearings(work_item_id, scheduled_at)
  WHERE status = 'scheduled' AND work_item_id IS NOT NULL;

-- Fast lookup by source act
CREATE INDEX IF NOT EXISTS idx_hearings_source_act ON public.hearings(source_act_id)
  WHERE source_act_id IS NOT NULL;

-- Recency classification stored on canonical rows
ALTER TABLE public.work_item_acts
  ADD COLUMN IF NOT EXISTS discovery_type TEXT;
ALTER TABLE public.work_item_publicaciones
  ADD COLUMN IF NOT EXISTS discovery_type TEXT;

CREATE INDEX IF NOT EXISTS idx_wi_acts_discovery_type
  ON public.work_item_acts(discovery_type, created_at DESC)
  WHERE discovery_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wi_pubs_discovery_type
  ON public.work_item_publicaciones(discovery_type, created_at DESC)
  WHERE discovery_type IS NOT NULL;
