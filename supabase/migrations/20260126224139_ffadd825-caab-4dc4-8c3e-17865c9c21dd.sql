-- ============================================
-- PART A1: Add work_item_id columns
-- ============================================

-- A1.1: Add work_item_id to actuaciones
ALTER TABLE public.actuaciones
ADD COLUMN IF NOT EXISTS work_item_id UUID REFERENCES public.work_items(id) ON DELETE SET NULL;

-- A1.2: Add work_item_id to process_events
ALTER TABLE public.process_events
ADD COLUMN IF NOT EXISTS work_item_id UUID REFERENCES public.work_items(id) ON DELETE SET NULL;

-- A1.3: Add work_item_id to cgp_milestones
ALTER TABLE public.cgp_milestones
ADD COLUMN IF NOT EXISTS work_item_id UUID REFERENCES public.work_items(id) ON DELETE SET NULL;

-- ============================================
-- A2: Create indexes for efficient queries
-- ============================================

-- Index on actuaciones(work_item_id, act_date DESC)
CREATE INDEX IF NOT EXISTS idx_actuaciones_work_item_date 
ON public.actuaciones(work_item_id, act_date DESC NULLS LAST)
WHERE work_item_id IS NOT NULL;

-- Index on process_events(work_item_id, event_date DESC)
CREATE INDEX IF NOT EXISTS idx_process_events_work_item_date 
ON public.process_events(work_item_id, event_date DESC NULLS LAST)
WHERE work_item_id IS NOT NULL;

-- Index on cgp_milestones(work_item_id, milestone_type, created_at)
CREATE INDEX IF NOT EXISTS idx_cgp_milestones_work_item_type 
ON public.cgp_milestones(work_item_id, milestone_type, created_at DESC)
WHERE work_item_id IS NOT NULL;

-- ============================================
-- A3: Unique constraint for deduplication
-- ============================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_actuaciones_work_item_fingerprint_unique
ON public.actuaciones(work_item_id, hash_fingerprint)
WHERE work_item_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_process_events_work_item_fingerprint_unique
ON public.process_events(work_item_id, hash_fingerprint)
WHERE work_item_id IS NOT NULL;