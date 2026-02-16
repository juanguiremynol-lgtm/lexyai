
-- Fix sync_traces: owner_id is never populated, use parent-join through work_items
-- This ensures members can see traces for their own work items,
-- and BUSINESS org admins can see all org traces
DROP POLICY IF EXISTS "Users can view sync traces" ON public.sync_traces;
CREATE POLICY "Users can view sync traces"
  ON public.sync_traces FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM work_items wi
      WHERE wi.id = sync_traces.work_item_id
        AND (
          wi.owner_id = auth.uid()
          OR is_business_org_admin(wi.organization_id)
        )
    )
    -- Allow org-level traces (no work_item_id) for business org admins
    OR (work_item_id IS NULL AND organization_id IS NOT NULL AND is_business_org_admin(organization_id))
  );

-- Index for join performance
CREATE INDEX IF NOT EXISTS idx_sync_traces_work_item_id ON public.sync_traces (work_item_id);
