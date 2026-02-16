-- =====================================================
-- FIX 1: actuaciones SELECT — align with work_items/clients
-- Replace is_org_member (too permissive) with is_business_org_admin
-- =====================================================
DROP POLICY IF EXISTS "Org members can view actuaciones" ON public.actuaciones;

CREATE POLICY "Users can view actuaciones"
ON public.actuaciones
FOR SELECT
TO authenticated
USING (
  auth.uid() = owner_id
  OR (organization_id IS NOT NULL AND is_business_org_admin(organization_id))
);

-- =====================================================
-- FIX 2: work_items SELECT — remove is_platform_admin()
-- Super Admin must NOT have blanket access to customer data.
-- Access goes through support_access_grants (existing system).
-- =====================================================
DROP POLICY IF EXISTS "Users can view work items" ON public.work_items;

CREATE POLICY "Users can view work items"
ON public.work_items
FOR SELECT
TO authenticated
USING (
  auth.uid() = owner_id
  OR is_business_org_admin(organization_id)
);