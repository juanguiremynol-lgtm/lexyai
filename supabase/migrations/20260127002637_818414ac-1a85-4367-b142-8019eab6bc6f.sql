-- ============================================================
-- PHASE 0: Database Schema Hardening for work_item_id Migration
-- ============================================================

-- 0.1 Add Foreign Keys (if not exist) - Using DO block for safety
DO $$
BEGIN
  -- actuaciones.work_item_id -> work_items.id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'actuaciones_work_item_id_fkey' 
    AND table_name = 'actuaciones'
  ) THEN
    ALTER TABLE public.actuaciones
    ADD CONSTRAINT actuaciones_work_item_id_fkey
    FOREIGN KEY (work_item_id) REFERENCES public.work_items(id) ON DELETE CASCADE;
  END IF;
  
  -- process_events.work_item_id -> work_items.id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'process_events_work_item_id_fkey' 
    AND table_name = 'process_events'
  ) THEN
    ALTER TABLE public.process_events
    ADD CONSTRAINT process_events_work_item_id_fkey
    FOREIGN KEY (work_item_id) REFERENCES public.work_items(id) ON DELETE CASCADE;
  END IF;
  
  -- cgp_milestones.work_item_id -> work_items.id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'cgp_milestones_work_item_id_fkey' 
    AND table_name = 'cgp_milestones'
  ) THEN
    ALTER TABLE public.cgp_milestones
    ADD CONSTRAINT cgp_milestones_work_item_id_fkey
    FOREIGN KEY (work_item_id) REFERENCES public.work_items(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 0.2 Performance Indexes
-- Index for actuaciones timeline queries
CREATE INDEX IF NOT EXISTS idx_actuaciones_work_item_date 
ON public.actuaciones(work_item_id, act_date DESC NULLS LAST) 
WHERE work_item_id IS NOT NULL;

-- Index for process_events timeline queries
CREATE INDEX IF NOT EXISTS idx_process_events_work_item_date 
ON public.process_events(work_item_id, event_date DESC NULLS LAST) 
WHERE work_item_id IS NOT NULL;

-- Index for cgp_milestones queries
CREATE INDEX IF NOT EXISTS idx_cgp_milestones_work_item_type 
ON public.cgp_milestones(work_item_id, milestone_type, created_at DESC) 
WHERE work_item_id IS NOT NULL;

-- 0.3 Dedup Uniqueness Constraints (work_item-scoped)
-- Canonical uniqueness for actuaciones
CREATE UNIQUE INDEX IF NOT EXISTS idx_actuaciones_work_item_fingerprint_unique 
ON public.actuaciones(work_item_id, hash_fingerprint) 
WHERE work_item_id IS NOT NULL;

-- Canonical uniqueness for process_events
CREATE UNIQUE INDEX IF NOT EXISTS idx_process_events_work_item_fingerprint_unique 
ON public.process_events(work_item_id, hash_fingerprint) 
WHERE work_item_id IS NOT NULL;

-- ============================================================
-- PHASE 2.1: Helper Function for Legacy ID Resolution
-- ============================================================
CREATE OR REPLACE FUNCTION public.resolve_work_item_id(
  p_radicado TEXT DEFAULT NULL,
  p_owner_id UUID DEFAULT NULL,
  p_legacy_filing_id UUID DEFAULT NULL,
  p_legacy_process_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_work_item_id UUID;
BEGIN
  -- Priority 1: Try by legacy_filing_id
  IF p_legacy_filing_id IS NOT NULL THEN
    SELECT id INTO v_work_item_id
    FROM public.work_items
    WHERE legacy_filing_id = p_legacy_filing_id
    LIMIT 1;
    
    IF v_work_item_id IS NOT NULL THEN
      RETURN v_work_item_id;
    END IF;
  END IF;
  
  -- Priority 2: Try by legacy_process_id
  IF p_legacy_process_id IS NOT NULL THEN
    SELECT id INTO v_work_item_id
    FROM public.work_items
    WHERE legacy_process_id = p_legacy_process_id
    LIMIT 1;
    
    IF v_work_item_id IS NOT NULL THEN
      RETURN v_work_item_id;
    END IF;
  END IF;
  
  -- Priority 3: Try by radicado + owner_id
  IF p_radicado IS NOT NULL AND p_owner_id IS NOT NULL THEN
    -- Normalize radicado (remove non-digits)
    SELECT id INTO v_work_item_id
    FROM public.work_items
    WHERE regexp_replace(radicado, '[^0-9]', '', 'g') = regexp_replace(p_radicado, '[^0-9]', '', 'g')
      AND owner_id = p_owner_id
    ORDER BY created_at DESC
    LIMIT 1;
    
    IF v_work_item_id IS NOT NULL THEN
      RETURN v_work_item_id;
    END IF;
  END IF;
  
  RETURN NULL;
END;
$$;

-- ============================================================
-- PHASE 2.2: Backfill Function (Idempotent)
-- ============================================================
CREATE OR REPLACE FUNCTION public.backfill_work_item_ids()
RETURNS TABLE(
  table_name TEXT,
  total_rows BIGINT,
  already_mapped BIGINT,
  newly_mapped BIGINT,
  unmapped BIGINT,
  exceptions JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actuaciones_total BIGINT := 0;
  v_actuaciones_already BIGINT := 0;
  v_actuaciones_mapped BIGINT := 0;
  v_actuaciones_unmapped BIGINT := 0;
  v_actuaciones_exceptions JSONB := '[]'::jsonb;
  
  v_process_events_total BIGINT := 0;
  v_process_events_already BIGINT := 0;
  v_process_events_mapped BIGINT := 0;
  v_process_events_unmapped BIGINT := 0;
  v_process_events_exceptions JSONB := '[]'::jsonb;
  
  v_cgp_milestones_total BIGINT := 0;
  v_cgp_milestones_already BIGINT := 0;
  v_cgp_milestones_mapped BIGINT := 0;
  v_cgp_milestones_unmapped BIGINT := 0;
  v_cgp_milestones_exceptions JSONB := '[]'::jsonb;
BEGIN
  -- =====================
  -- BACKFILL actuaciones
  -- =====================
  SELECT COUNT(*) INTO v_actuaciones_total FROM actuaciones;
  SELECT COUNT(*) INTO v_actuaciones_already FROM actuaciones WHERE work_item_id IS NOT NULL;
  
  -- Update using legacy_filing_id
  WITH updated AS (
    UPDATE actuaciones a
    SET work_item_id = w.id
    FROM work_items w
    WHERE a.work_item_id IS NULL
      AND a.filing_id IS NOT NULL
      AND w.legacy_filing_id = a.filing_id
    RETURNING a.id
  )
  SELECT COUNT(*) INTO v_actuaciones_mapped FROM updated;
  
  -- Update using legacy_process_id
  WITH updated AS (
    UPDATE actuaciones a
    SET work_item_id = w.id
    FROM work_items w
    WHERE a.work_item_id IS NULL
      AND a.monitored_process_id IS NOT NULL
      AND w.legacy_process_id = a.monitored_process_id
    RETURNING a.id
  )
  SELECT v_actuaciones_mapped + COUNT(*) INTO v_actuaciones_mapped FROM updated;
  
  SELECT COUNT(*) INTO v_actuaciones_unmapped 
  FROM actuaciones 
  WHERE work_item_id IS NULL;
  
  -- Collect exceptions
  SELECT jsonb_agg(jsonb_build_object(
    'id', id,
    'filing_id', filing_id,
    'monitored_process_id', monitored_process_id,
    'owner_id', owner_id,
    'reason', 'No matching work_item found'
  ))
  INTO v_actuaciones_exceptions
  FROM actuaciones
  WHERE work_item_id IS NULL
  LIMIT 100;
  
  -- =====================
  -- BACKFILL process_events
  -- =====================
  SELECT COUNT(*) INTO v_process_events_total FROM process_events;
  SELECT COUNT(*) INTO v_process_events_already FROM process_events WHERE work_item_id IS NOT NULL;
  
  -- Update using legacy_filing_id
  WITH updated AS (
    UPDATE process_events pe
    SET work_item_id = w.id
    FROM work_items w
    WHERE pe.work_item_id IS NULL
      AND pe.filing_id IS NOT NULL
      AND w.legacy_filing_id = pe.filing_id
    RETURNING pe.id
  )
  SELECT COUNT(*) INTO v_process_events_mapped FROM updated;
  
  -- Update using legacy_process_id
  WITH updated AS (
    UPDATE process_events pe
    SET work_item_id = w.id
    FROM work_items w
    WHERE pe.work_item_id IS NULL
      AND pe.monitored_process_id IS NOT NULL
      AND w.legacy_process_id = pe.monitored_process_id
    RETURNING pe.id
  )
  SELECT v_process_events_mapped + COUNT(*) INTO v_process_events_mapped FROM updated;
  
  SELECT COUNT(*) INTO v_process_events_unmapped 
  FROM process_events 
  WHERE work_item_id IS NULL;
  
  SELECT jsonb_agg(jsonb_build_object(
    'id', id,
    'filing_id', filing_id,
    'monitored_process_id', monitored_process_id,
    'owner_id', owner_id,
    'reason', 'No matching work_item found'
  ))
  INTO v_process_events_exceptions
  FROM process_events
  WHERE work_item_id IS NULL
  LIMIT 100;
  
  -- =====================
  -- BACKFILL cgp_milestones
  -- =====================
  SELECT COUNT(*) INTO v_cgp_milestones_total FROM cgp_milestones;
  SELECT COUNT(*) INTO v_cgp_milestones_already FROM cgp_milestones WHERE work_item_id IS NOT NULL;
  
  -- Update using legacy_filing_id
  WITH updated AS (
    UPDATE cgp_milestones m
    SET work_item_id = w.id
    FROM work_items w
    WHERE m.work_item_id IS NULL
      AND m.filing_id IS NOT NULL
      AND w.legacy_filing_id = m.filing_id
    RETURNING m.id
  )
  SELECT COUNT(*) INTO v_cgp_milestones_mapped FROM updated;
  
  -- Update using legacy_process_id
  WITH updated AS (
    UPDATE cgp_milestones m
    SET work_item_id = w.id
    FROM work_items w
    WHERE m.work_item_id IS NULL
      AND m.process_id IS NOT NULL
      AND w.legacy_process_id = m.process_id
    RETURNING m.id
  )
  SELECT v_cgp_milestones_mapped + COUNT(*) INTO v_cgp_milestones_mapped FROM updated;
  
  SELECT COUNT(*) INTO v_cgp_milestones_unmapped 
  FROM cgp_milestones 
  WHERE work_item_id IS NULL;
  
  SELECT jsonb_agg(jsonb_build_object(
    'id', id,
    'filing_id', filing_id,
    'process_id', process_id,
    'owner_id', owner_id,
    'reason', 'No matching work_item found'
  ))
  INTO v_cgp_milestones_exceptions
  FROM cgp_milestones
  WHERE work_item_id IS NULL
  LIMIT 100;
  
  -- Return results
  RETURN QUERY
  SELECT 'actuaciones'::TEXT, v_actuaciones_total, v_actuaciones_already, 
         v_actuaciones_mapped, v_actuaciones_unmapped, COALESCE(v_actuaciones_exceptions, '[]'::jsonb)
  UNION ALL
  SELECT 'process_events'::TEXT, v_process_events_total, v_process_events_already, 
         v_process_events_mapped, v_process_events_unmapped, COALESCE(v_process_events_exceptions, '[]'::jsonb)
  UNION ALL
  SELECT 'cgp_milestones'::TEXT, v_cgp_milestones_total, v_cgp_milestones_already, 
         v_cgp_milestones_mapped, v_cgp_milestones_unmapped, COALESCE(v_cgp_milestones_exceptions, '[]'::jsonb);
END;
$$;

-- ============================================================
-- PHASE 4.2: Validation Queries (Stored as a View for Dashboards)
-- ============================================================
CREATE OR REPLACE VIEW public.migration_health_check AS
SELECT 
  'actuaciones' AS table_name,
  COUNT(*) AS total_rows,
  COUNT(work_item_id) AS with_work_item_id,
  COUNT(*) - COUNT(work_item_id) AS missing_work_item_id,
  ROUND(COUNT(work_item_id)::numeric / NULLIF(COUNT(*), 0) * 100, 2) AS pct_mapped,
  COUNT(DISTINCT work_item_id) AS unique_work_items,
  COUNT(*) - COUNT(DISTINCT (work_item_id, hash_fingerprint)) AS potential_duplicates
FROM actuaciones
UNION ALL
SELECT 
  'process_events' AS table_name,
  COUNT(*) AS total_rows,
  COUNT(work_item_id) AS with_work_item_id,
  COUNT(*) - COUNT(work_item_id) AS missing_work_item_id,
  ROUND(COUNT(work_item_id)::numeric / NULLIF(COUNT(*), 0) * 100, 2) AS pct_mapped,
  COUNT(DISTINCT work_item_id) AS unique_work_items,
  COUNT(*) - COUNT(DISTINCT (work_item_id, hash_fingerprint)) AS potential_duplicates
FROM process_events
UNION ALL
SELECT 
  'cgp_milestones' AS table_name,
  COUNT(*) AS total_rows,
  COUNT(work_item_id) AS with_work_item_id,
  COUNT(*) - COUNT(work_item_id) AS missing_work_item_id,
  ROUND(COUNT(work_item_id)::numeric / NULLIF(COUNT(*), 0) * 100, 2) AS pct_mapped,
  COUNT(DISTINCT work_item_id) AS unique_work_items,
  0 AS potential_duplicates
FROM cgp_milestones;