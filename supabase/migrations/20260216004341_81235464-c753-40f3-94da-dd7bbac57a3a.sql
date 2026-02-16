
-- =============================================================
-- FIX RLS LEAKS: Remove is_platform_admin() from customer data,
-- Replace is_org_member() with is_business_org_admin() or parent-join
-- =============================================================

-- =====================
-- 1. cgp_items (owner_id only, no org_id)
-- Remove is_platform_admin(), keep owner_id only
-- =====================
DROP POLICY IF EXISTS "Org members can view cgp_items" ON public.cgp_items;
CREATE POLICY "Users can view own cgp_items"
  ON public.cgp_items FOR SELECT
  USING (auth.uid() = owner_id);

-- =====================
-- 2. peticiones (owner_id + organization_id)
-- Remove is_platform_admin() + is_org_member(), use is_business_org_admin()
-- =====================
DROP POLICY IF EXISTS "Org members can view peticiones" ON public.peticiones;
CREATE POLICY "Users can view peticiones"
  ON public.peticiones FOR SELECT
  USING (
    auth.uid() = owner_id
    OR (organization_id IS NOT NULL AND is_business_org_admin(organization_id))
  );

-- =====================
-- 3. cpaca_processes (owner_id + organization_id)
-- Remove is_platform_admin() + is_org_member(), use is_business_org_admin()
-- =====================
DROP POLICY IF EXISTS "Org members can view cpaca_processes" ON public.cpaca_processes;
CREATE POLICY "Users can view cpaca_processes"
  ON public.cpaca_processes FOR SELECT
  USING (
    auth.uid() = owner_id
    OR (organization_id IS NOT NULL AND is_business_org_admin(organization_id))
  );

-- =====================
-- 4. work_item_acts (owner_id + organization_id)
-- Remove is_platform_admin() + is_org_member(), use is_business_org_admin()
-- =====================
DROP POLICY IF EXISTS "Org members can view work item acts" ON public.work_item_acts;
CREATE POLICY "Users can view work item acts"
  ON public.work_item_acts FOR SELECT
  USING (
    auth.uid() = owner_id
    OR (organization_id IS NOT NULL AND is_business_org_admin(organization_id))
  );

-- =====================
-- 5. sync_traces (owner_id + organization_id)
-- Remove is_platform_admin() + is_org_member(), use is_business_org_admin()
-- =====================
DROP POLICY IF EXISTS "Org members can view sync traces" ON public.sync_traces;
CREATE POLICY "Users can view sync traces"
  ON public.sync_traces FOR SELECT
  USING (
    auth.uid() = owner_id
    OR (organization_id IS NOT NULL AND is_business_org_admin(organization_id))
  );

-- =====================
-- 6. work_item_publicaciones (organization_id + work_item_id, NO owner_id)
-- Replace is_org_member() with parent-join through work_items
-- =====================
DROP POLICY IF EXISTS "Org members can view publications" ON public.work_item_publicaciones;
CREATE POLICY "Users can view publications"
  ON public.work_item_publicaciones FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM work_items wi
      WHERE wi.id = work_item_publicaciones.work_item_id
        AND (
          wi.owner_id = auth.uid()
          OR is_business_org_admin(wi.organization_id)
        )
    )
  );

-- =====================
-- 7. work_item_soft_deletes (organization_id + work_item_id, NO owner_id)
-- Replace is_org_member() with parent-join through work_items
-- =====================
DROP POLICY IF EXISTS "Org members can view soft deletes" ON public.work_item_soft_deletes;
CREATE POLICY "Users can view soft deletes"
  ON public.work_item_soft_deletes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM work_items wi
      WHERE wi.id = work_item_soft_deletes.work_item_id
        AND (
          wi.owner_id = auth.uid()
          OR is_business_org_admin(wi.organization_id)
        )
    )
  );

-- =====================
-- 8. work_item_stage_audit (organization_id + work_item_id, NO owner_id)
-- Replace is_org_member() with parent-join through work_items
-- =====================
DROP POLICY IF EXISTS "Org members can read stage audit" ON public.work_item_stage_audit;
CREATE POLICY "Users can view stage audit"
  ON public.work_item_stage_audit FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM work_items wi
      WHERE wi.id = work_item_stage_audit.work_item_id
        AND (
          wi.owner_id = auth.uid()
          OR is_business_org_admin(wi.organization_id)
        )
    )
  );

-- =====================
-- 9. work_item_stage_suggestions (owner_id + organization_id + work_item_id)
-- Replace is_org_member() with owner_id + is_business_org_admin()
-- =====================
DROP POLICY IF EXISTS "Org members can view stage suggestions" ON public.work_item_stage_suggestions;
CREATE POLICY "Users can view stage suggestions"
  ON public.work_item_stage_suggestions FOR SELECT
  USING (
    auth.uid() = owner_id
    OR (organization_id IS NOT NULL AND is_business_org_admin(organization_id))
  );

-- Also fix the UPDATE/DELETE policies that use is_platform_admin()
DROP POLICY IF EXISTS "Org admins can update stage suggestions" ON public.work_item_stage_suggestions;
CREATE POLICY "Org admins can update stage suggestions"
  ON public.work_item_stage_suggestions FOR UPDATE
  USING (
    auth.uid() = owner_id
    OR (organization_id IS NOT NULL AND is_business_org_admin(organization_id))
  );

DROP POLICY IF EXISTS "Org admins can delete stage suggestions" ON public.work_item_stage_suggestions;
CREATE POLICY "Org admins can delete stage suggestions"
  ON public.work_item_stage_suggestions FOR DELETE
  USING (
    auth.uid() = owner_id
    OR (organization_id IS NOT NULL AND is_business_org_admin(organization_id))
  );

-- =====================
-- 10. work_item_coverage_gaps (work_item_id + org_id, NO owner_id)
-- Replace is_org_member(org_id) with parent-join through work_items
-- =====================
DROP POLICY IF EXISTS "Org members can view coverage gaps" ON public.work_item_coverage_gaps;
CREATE POLICY "Users can view coverage gaps"
  ON public.work_item_coverage_gaps FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM work_items wi
      WHERE wi.id = work_item_coverage_gaps.work_item_id
        AND (
          wi.owner_id = auth.uid()
          OR is_business_org_admin(wi.organization_id)
        )
    )
  );

-- =====================
-- 11. provider_raw_snapshots (organization_id + work_item_id, NO owner_id)
-- Replace is_org_member() with parent-join through work_items
-- =====================
DROP POLICY IF EXISTS "Org members can read their snapshots" ON public.provider_raw_snapshots;
CREATE POLICY "Users can view raw snapshots"
  ON public.provider_raw_snapshots FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM work_items wi
      WHERE wi.id = provider_raw_snapshots.work_item_id
        AND (
          wi.owner_id = auth.uid()
          OR is_business_org_admin(wi.organization_id)
        )
    )
  );

-- =====================
-- 12. work_item_act_extras (work_item_act_id only, NO owner_id/org_id/work_item_id)
-- Replace is_org_member() join with parent-join through work_item_acts → work_items
-- =====================
DROP POLICY IF EXISTS "Org members can read act extras" ON public.work_item_act_extras;
CREATE POLICY "Users can view act extras"
  ON public.work_item_act_extras FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM work_item_acts a
      JOIN work_items wi ON wi.id = a.work_item_id
      WHERE a.id = work_item_act_extras.work_item_act_id
        AND (
          wi.owner_id = auth.uid()
          OR is_business_org_admin(wi.organization_id)
        )
    )
  );

-- =====================
-- 13. work_item_pub_extras (work_item_pub_id only, NO owner_id/org_id/work_item_id)
-- Replace is_org_member() join with parent-join through work_item_publicaciones → work_items
-- =====================
DROP POLICY IF EXISTS "Org members can read pub extras" ON public.work_item_pub_extras;
CREATE POLICY "Users can view pub extras"
  ON public.work_item_pub_extras FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM work_item_publicaciones p
      JOIN work_items wi ON wi.id = p.work_item_id
      WHERE p.id = work_item_pub_extras.work_item_pub_id
        AND (
          wi.owner_id = auth.uid()
          OR is_business_org_admin(wi.organization_id)
        )
    )
  );

-- =====================
-- INDEXES for policy join performance
-- =====================
CREATE INDEX IF NOT EXISTS idx_work_items_owner_id ON public.work_items (owner_id);
CREATE INDEX IF NOT EXISTS idx_work_items_organization_id ON public.work_items (organization_id);
CREATE INDEX IF NOT EXISTS idx_work_item_acts_work_item_id ON public.work_item_acts (work_item_id);
CREATE INDEX IF NOT EXISTS idx_work_item_publicaciones_work_item_id ON public.work_item_publicaciones (work_item_id);
CREATE INDEX IF NOT EXISTS idx_work_item_act_extras_act_id ON public.work_item_act_extras (work_item_act_id);
CREATE INDEX IF NOT EXISTS idx_work_item_pub_extras_pub_id ON public.work_item_pub_extras (work_item_pub_id);
CREATE INDEX IF NOT EXISTS idx_work_item_soft_deletes_work_item_id ON public.work_item_soft_deletes (work_item_id);
CREATE INDEX IF NOT EXISTS idx_work_item_stage_audit_work_item_id ON public.work_item_stage_audit (work_item_id);
CREATE INDEX IF NOT EXISTS idx_work_item_coverage_gaps_work_item_id ON public.work_item_coverage_gaps (work_item_id);
CREATE INDEX IF NOT EXISTS idx_provider_raw_snapshots_work_item_id ON public.provider_raw_snapshots (work_item_id);
