
-- ==========================================================
-- 1. FIX MUTABLE SEARCH_PATH: billing_subscription_state_updated_at
-- ==========================================================
CREATE OR REPLACE FUNCTION public.billing_subscription_state_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

-- ==========================================================
-- 2. MOVE EXTENSIONS FROM PUBLIC TO EXTENSIONS SCHEMA
-- ==========================================================
-- Note: Must drop and recreate in correct schema
ALTER EXTENSION pg_trgm SET SCHEMA extensions;
ALTER EXTENSION unaccent SET SCHEMA extensions;
ALTER EXTENSION citext SET SCHEMA extensions;

-- ==========================================================
-- 3. HARDEN RLS ON actuaciones & work_item_acts
--    Replace owner-only policies with org-scoped policies
--    using is_org_member() for proper multi-tenant isolation
-- ==========================================================

-- actuaciones: drop existing policies
DROP POLICY IF EXISTS "Users can view own actuaciones" ON public.actuaciones;
DROP POLICY IF EXISTS "Users can create own actuaciones" ON public.actuaciones;
DROP POLICY IF EXISTS "Users can delete own actuaciones" ON public.actuaciones;

-- actuaciones: org-scoped policies (authenticated only)
CREATE POLICY "Org members can view actuaciones"
ON public.actuaciones FOR SELECT TO authenticated
USING (
  auth.uid() = owner_id 
  OR public.is_org_member(organization_id)
  OR public.is_platform_admin()
);

CREATE POLICY "Org members can create actuaciones"
ON public.actuaciones FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = owner_id
);

CREATE POLICY "Owners can delete actuaciones"
ON public.actuaciones FOR DELETE TO authenticated
USING (
  auth.uid() = owner_id
);

-- work_item_acts: drop existing policies
DROP POLICY IF EXISTS "Users can view their own work item acts" ON public.work_item_acts;
DROP POLICY IF EXISTS "Users can create their own work item acts" ON public.work_item_acts;
DROP POLICY IF EXISTS "Users can update their own work item acts" ON public.work_item_acts;
DROP POLICY IF EXISTS "Users can delete their own work item acts" ON public.work_item_acts;

-- work_item_acts: org-scoped policies (authenticated only)
CREATE POLICY "Org members can view work item acts"
ON public.work_item_acts FOR SELECT TO authenticated
USING (
  auth.uid() = owner_id 
  OR public.is_org_member(organization_id)
  OR public.is_platform_admin()
);

CREATE POLICY "Org members can create work item acts"
ON public.work_item_acts FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = owner_id
);

CREATE POLICY "Owners can update work item acts"
ON public.work_item_acts FOR UPDATE TO authenticated
USING (
  auth.uid() = owner_id
);

CREATE POLICY "Owners can delete work item acts"
ON public.work_item_acts FOR DELETE TO authenticated
USING (
  auth.uid() = owner_id
);
