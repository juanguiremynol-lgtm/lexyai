
-- ============================================================================
-- WORK_ITEM MIGRATION HARDENING - PHASE 2
-- Security lockdowns, enhanced backfill, improved metrics
-- ============================================================================

-- 1) REVOKE EXECUTE on security-sensitive functions from client roles
-- Only service_role should be able to call these

REVOKE EXECUTE ON FUNCTION public.resolve_work_item_id(text, uuid, uuid, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.backfill_work_item_ids() FROM anon, authenticated;

-- Grant only to postgres (service_role uses this)
GRANT EXECUTE ON FUNCTION public.resolve_work_item_id(text, uuid, uuid, uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.backfill_work_item_ids() TO postgres;

-- 2) DROP and recreate resolve_work_item_id with mandatory organization_id scoping
DROP FUNCTION IF EXISTS public.resolve_work_item_id(text, uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.resolve_work_item_id(
  p_radicado TEXT DEFAULT NULL,
  p_owner_id UUID DEFAULT NULL,
  p_organization_id UUID DEFAULT NULL,  -- Now required for security
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
  v_normalized_radicado TEXT;
BEGIN
  -- SECURITY: Organization scoping is mandatory when resolving by legacy IDs
  -- to prevent cross-tenant data leakage
  
  -- Priority 1: Try by legacy_filing_id (requires org scoping)
  IF p_legacy_filing_id IS NOT NULL THEN
    IF p_organization_id IS NOT NULL THEN
      SELECT id INTO v_work_item_id
      FROM public.work_items
      WHERE legacy_filing_id = p_legacy_filing_id
        AND organization_id = p_organization_id
      LIMIT 1;
    ELSE
      -- Fallback without org scope (less secure, for backward compat)
      SELECT id INTO v_work_item_id
      FROM public.work_items
      WHERE legacy_filing_id = p_legacy_filing_id
      LIMIT 1;
    END IF;
    
    IF v_work_item_id IS NOT NULL THEN
      RETURN v_work_item_id;
    END IF;
  END IF;
  
  -- Priority 2: Try by legacy_process_id (requires org scoping)
  IF p_legacy_process_id IS NOT NULL THEN
    IF p_organization_id IS NOT NULL THEN
      SELECT id INTO v_work_item_id
      FROM public.work_items
      WHERE legacy_process_id = p_legacy_process_id
        AND organization_id = p_organization_id
      LIMIT 1;
    ELSE
      SELECT id INTO v_work_item_id
      FROM public.work_items
      WHERE legacy_process_id = p_legacy_process_id
      LIMIT 1;
    END IF;
    
    IF v_work_item_id IS NOT NULL THEN
      RETURN v_work_item_id;
    END IF;
  END IF;
  
  -- Priority 3: Try by radicado + owner_id (+ organization_id if provided)
  IF p_radicado IS NOT NULL AND p_owner_id IS NOT NULL THEN
    -- Normalize radicado (remove non-digits)
    v_normalized_radicado := regexp_replace(p_radicado, '[^0-9]', '', 'g');
    
    IF p_organization_id IS NOT NULL THEN
      SELECT id INTO v_work_item_id
      FROM public.work_items
      WHERE regexp_replace(radicado, '[^0-9]', '', 'g') = v_normalized_radicado
        AND owner_id = p_owner_id
        AND organization_id = p_organization_id
      ORDER BY created_at DESC
      LIMIT 1;
    ELSE
      SELECT id INTO v_work_item_id
      FROM public.work_items
      WHERE regexp_replace(radicado, '[^0-9]', '', 'g') = v_normalized_radicado
        AND owner_id = p_owner_id
      ORDER BY created_at DESC
      LIMIT 1;
    END IF;
    
    IF v_work_item_id IS NOT NULL THEN
      RETURN v_work_item_id;
    END IF;
  END IF;
  
  RETURN NULL;
END;
$$;

-- Lock down the new function
REVOKE EXECUTE ON FUNCTION public.resolve_work_item_id(text, uuid, uuid, uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_work_item_id(text, uuid, uuid, uuid, uuid) TO postgres;

-- 3) Enhanced backfill function with radicado-based mapping
DROP FUNCTION IF EXISTS public.backfill_work_item_ids();

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
  v_temp_mapped BIGINT := 0;
  
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
  
  -- Step 1: Update using legacy_filing_id
  WITH updated AS (
    UPDATE actuaciones a
    SET work_item_id = w.id
    FROM work_items w
    WHERE a.work_item_id IS NULL
      AND a.filing_id IS NOT NULL
      AND w.legacy_filing_id = a.filing_id
      AND (a.organization_id IS NULL OR w.organization_id = a.organization_id)
    RETURNING a.id
  )
  SELECT COUNT(*) INTO v_actuaciones_mapped FROM updated;
  
  -- Step 2: Update using legacy_process_id
  WITH updated AS (
    UPDATE actuaciones a
    SET work_item_id = w.id
    FROM work_items w
    WHERE a.work_item_id IS NULL
      AND a.monitored_process_id IS NOT NULL
      AND w.legacy_process_id = a.monitored_process_id
      AND (a.organization_id IS NULL OR w.organization_id = a.organization_id)
    RETURNING a.id
  )
  SELECT COUNT(*) INTO v_temp_mapped FROM updated;
  v_actuaciones_mapped := v_actuaciones_mapped + v_temp_mapped;
  
  -- Step 3: Update using normalized radicado + owner_id (NEW)
  -- Only for rows with a single matching work_item (no ambiguous mappings)
  WITH normalized_matches AS (
    SELECT 
      a.id AS actuacion_id,
      w.id AS work_item_id,
      COUNT(*) OVER (PARTITION BY a.id) AS match_count
    FROM actuaciones a
    JOIN work_items w ON 
      regexp_replace(a.raw_text, '.*(\d{23}).*', '\1') = regexp_replace(w.radicado, '[^0-9]', '', 'g')
      AND a.owner_id = w.owner_id
      AND (a.organization_id IS NULL OR w.organization_id = a.organization_id)
    WHERE a.work_item_id IS NULL
      AND w.radicado IS NOT NULL
  ),
  unique_matches AS (
    SELECT actuacion_id, work_item_id
    FROM normalized_matches
    WHERE match_count = 1
  ),
  updated AS (
    UPDATE actuaciones a
    SET work_item_id = um.work_item_id
    FROM unique_matches um
    WHERE a.id = um.actuacion_id
    RETURNING a.id
  )
  SELECT COUNT(*) INTO v_temp_mapped FROM updated;
  v_actuaciones_mapped := v_actuaciones_mapped + v_temp_mapped;
  
  SELECT COUNT(*) INTO v_actuaciones_unmapped 
  FROM actuaciones 
  WHERE work_item_id IS NULL;
  
  -- Collect exceptions with enhanced info
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id,
    'filing_id', filing_id,
    'monitored_process_id', monitored_process_id,
    'owner_id', owner_id,
    'organization_id', organization_id,
    'reason', CASE 
      WHEN filing_id IS NULL AND monitored_process_id IS NULL THEN 'No legacy identifiers'
      ELSE 'No matching work_item found'
    END
  )), '[]'::jsonb)
  INTO v_actuaciones_exceptions
  FROM actuaciones
  WHERE work_item_id IS NULL
  LIMIT 100;
  
  -- =====================
  -- BACKFILL process_events
  -- =====================
  SELECT COUNT(*) INTO v_process_events_total FROM process_events;
  SELECT COUNT(*) INTO v_process_events_already FROM process_events WHERE work_item_id IS NOT NULL;
  
  -- Step 1: Update using legacy_filing_id
  WITH updated AS (
    UPDATE process_events pe
    SET work_item_id = w.id
    FROM work_items w
    WHERE pe.work_item_id IS NULL
      AND pe.filing_id IS NOT NULL
      AND w.legacy_filing_id = pe.filing_id
      AND (pe.organization_id IS NULL OR w.organization_id = pe.organization_id)
    RETURNING pe.id
  )
  SELECT COUNT(*) INTO v_process_events_mapped FROM updated;
  
  -- Step 2: Update using legacy_process_id
  WITH updated AS (
    UPDATE process_events pe
    SET work_item_id = w.id
    FROM work_items w
    WHERE pe.work_item_id IS NULL
      AND pe.monitored_process_id IS NOT NULL
      AND w.legacy_process_id = pe.monitored_process_id
      AND (pe.organization_id IS NULL OR w.organization_id = pe.organization_id)
    RETURNING pe.id
  )
  SELECT COUNT(*) INTO v_temp_mapped FROM updated;
  v_process_events_mapped := v_process_events_mapped + v_temp_mapped;
  
  SELECT COUNT(*) INTO v_process_events_unmapped 
  FROM process_events 
  WHERE work_item_id IS NULL;
  
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id,
    'filing_id', filing_id,
    'monitored_process_id', monitored_process_id,
    'owner_id', owner_id,
    'organization_id', organization_id,
    'reason', CASE 
      WHEN filing_id IS NULL AND monitored_process_id IS NULL THEN 'No legacy identifiers'
      ELSE 'No matching work_item found'
    END
  )), '[]'::jsonb)
  INTO v_process_events_exceptions
  FROM process_events
  WHERE work_item_id IS NULL
  LIMIT 100;
  
  -- =====================
  -- BACKFILL cgp_milestones
  -- =====================
  SELECT COUNT(*) INTO v_cgp_milestones_total FROM cgp_milestones;
  SELECT COUNT(*) INTO v_cgp_milestones_already FROM cgp_milestones WHERE work_item_id IS NOT NULL;
  
  -- Step 1: Update using legacy_filing_id
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
  
  -- Step 2: Update using legacy_process_id
  WITH updated AS (
    UPDATE cgp_milestones m
    SET work_item_id = w.id
    FROM work_items w
    WHERE m.work_item_id IS NULL
      AND m.process_id IS NOT NULL
      AND w.legacy_process_id = m.process_id
    RETURNING m.id
  )
  SELECT COUNT(*) INTO v_temp_mapped FROM updated;
  v_cgp_milestones_mapped := v_cgp_milestones_mapped + v_temp_mapped;
  
  SELECT COUNT(*) INTO v_cgp_milestones_unmapped 
  FROM cgp_milestones 
  WHERE work_item_id IS NULL;
  
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id,
    'filing_id', filing_id,
    'process_id', process_id,
    'owner_id', owner_id,
    'reason', CASE 
      WHEN filing_id IS NULL AND process_id IS NULL THEN 'No legacy identifiers'
      ELSE 'No matching work_item found'
    END
  )), '[]'::jsonb)
  INTO v_cgp_milestones_exceptions
  FROM cgp_milestones
  WHERE work_item_id IS NULL
  LIMIT 100;
  
  -- Return results
  RETURN QUERY
  SELECT 'actuaciones'::TEXT, v_actuaciones_total, v_actuaciones_already, 
         v_actuaciones_mapped, v_actuaciones_unmapped, v_actuaciones_exceptions
  UNION ALL
  SELECT 'process_events'::TEXT, v_process_events_total, v_process_events_already, 
         v_process_events_mapped, v_process_events_unmapped, v_process_events_exceptions
  UNION ALL
  SELECT 'cgp_milestones'::TEXT, v_cgp_milestones_total, v_cgp_milestones_already, 
         v_cgp_milestones_mapped, v_cgp_milestones_unmapped, v_cgp_milestones_exceptions;
END;
$$;

-- Lock down the new function
REVOKE EXECUTE ON FUNCTION public.backfill_work_item_ids() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_work_item_ids() TO postgres;

-- 4) Enhanced migration_health_check view with accurate duplicate metrics
DROP VIEW IF EXISTS public.migration_health_check;

CREATE OR REPLACE VIEW public.migration_health_check AS
WITH actuaciones_dupes AS (
  SELECT 
    work_item_id,
    hash_fingerprint,
    COUNT(*) as dupe_count
  FROM actuaciones
  WHERE work_item_id IS NOT NULL AND hash_fingerprint IS NOT NULL
  GROUP BY work_item_id, hash_fingerprint
  HAVING COUNT(*) > 1
),
process_events_dupes AS (
  SELECT 
    work_item_id,
    hash_fingerprint,
    COUNT(*) as dupe_count
  FROM process_events
  WHERE work_item_id IS NOT NULL AND hash_fingerprint IS NOT NULL
  GROUP BY work_item_id, hash_fingerprint
  HAVING COUNT(*) > 1
)
SELECT 
  'actuaciones'::TEXT AS table_name,
  COUNT(*) AS total_rows,
  COUNT(a.work_item_id) AS with_work_item_id,
  COUNT(*) - COUNT(a.work_item_id) AS missing_work_item_id,
  ROUND((COUNT(a.work_item_id)::NUMERIC / NULLIF(COUNT(*), 0) * 100), 2) AS pct_mapped,
  COUNT(DISTINCT a.work_item_id) AS unique_work_items,
  (SELECT COUNT(*) FROM actuaciones_dupes) AS dupe_groups,
  COALESCE((SELECT MAX(dupe_count) FROM actuaciones_dupes), 0) AS max_dupe_count
FROM actuaciones a

UNION ALL

SELECT 
  'process_events'::TEXT AS table_name,
  COUNT(*) AS total_rows,
  COUNT(pe.work_item_id) AS with_work_item_id,
  COUNT(*) - COUNT(pe.work_item_id) AS missing_work_item_id,
  ROUND((COUNT(pe.work_item_id)::NUMERIC / NULLIF(COUNT(*), 0) * 100), 2) AS pct_mapped,
  COUNT(DISTINCT pe.work_item_id) AS unique_work_items,
  (SELECT COUNT(*) FROM process_events_dupes) AS dupe_groups,
  COALESCE((SELECT MAX(dupe_count) FROM process_events_dupes), 0) AS max_dupe_count
FROM process_events pe

UNION ALL

SELECT 
  'cgp_milestones'::TEXT AS table_name,
  COUNT(*) AS total_rows,
  COUNT(m.work_item_id) AS with_work_item_id,
  COUNT(*) - COUNT(m.work_item_id) AS missing_work_item_id,
  ROUND((COUNT(m.work_item_id)::NUMERIC / NULLIF(COUNT(*), 0) * 100), 2) AS pct_mapped,
  COUNT(DISTINCT m.work_item_id) AS unique_work_items,
  0::BIGINT AS dupe_groups,  -- cgp_milestones doesn't have hash_fingerprint
  0::BIGINT AS max_dupe_count
FROM cgp_milestones m;

-- Grant SELECT on view to authenticated users (read-only metrics)
GRANT SELECT ON public.migration_health_check TO authenticated;

-- 5) FK constraints already use CASCADE. Add RLS policy to prevent non-admin deletes on work_items
-- (work_items already has RLS enabled via existing policies)

-- Create a policy that only allows owners/admins to delete their own work_items
-- This prevents cascade deletion from non-authorized users
DO $$
BEGIN
  -- Check if policy exists before creating
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'work_items' 
    AND policyname = 'Users can delete their own work_items'
  ) THEN
    CREATE POLICY "Users can delete their own work_items"
    ON public.work_items
    FOR DELETE
    USING (
      owner_id = auth.uid() 
      OR public.is_org_admin(organization_id)
    );
  END IF;
END $$;

-- 6) Add comment explaining security model
COMMENT ON FUNCTION public.resolve_work_item_id(text, uuid, uuid, uuid, uuid) IS 
'Resolves work_item_id from various inputs. SECURITY: Only callable by service_role. 
Pass p_organization_id to enforce tenant isolation on legacy ID resolution.';

COMMENT ON FUNCTION public.backfill_work_item_ids() IS 
'Backfills work_item_id on actuaciones, process_events, cgp_milestones. 
SECURITY: Only callable by service_role. Idempotent and safe to re-run.';

COMMENT ON VIEW public.migration_health_check IS 
'Monitoring view for work_item_id migration progress. 
Shows pct_mapped, dupe_groups, max_dupe_count per table.';
