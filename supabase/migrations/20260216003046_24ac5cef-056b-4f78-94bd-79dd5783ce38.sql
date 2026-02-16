-- ============================================================
-- TIER-GATED AUTHORIZATION MODEL
-- Org admin access requires BOTH role (OWNER/ADMIN) AND business-tier subscription
-- ============================================================

-- 1. Add "business" plan to subscription_plans (features as jsonb)
INSERT INTO public.subscription_plans (name, display_name, price_cop, max_clients, max_filings, trial_days, features, active)
VALUES ('business', 'Empresarial', 299000, NULL, NULL, 0,
  '["Clientes ilimitados", "Procesos ilimitados", "Hasta 5 miembros", "Búsqueda organizacional", "Gestión de equipo"]'::jsonb,
  true)
ON CONFLICT DO NOTHING;

-- 2. Function: check if org has a business-tier subscription
CREATE OR REPLACE FUNCTION public.has_business_tier(_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions s
    JOIN public.subscription_plans sp ON s.plan_id = sp.id
    WHERE s.organization_id = _org_id
      AND s.status IN ('active', 'trialing')
      AND sp.name IN ('business', 'unlimited')
  )
  OR EXISTS (
    SELECT 1 FROM public.billing_subscription_state bss
    WHERE bss.organization_id = _org_id
      AND bss.status IN ('ACTIVE', 'TRIAL')
      AND bss.plan_code IN ('BUSINESS', 'ENTERPRISE', 'UNLIMITED')
  )
$$;

-- 3. Function: org admin WITH business tier (defense-in-depth)
CREATE OR REPLACE FUNCTION public.is_business_org_admin(_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_org_admin(_org_id) AND public.has_business_tier(_org_id)
$$;

-- 4. Fix work_items SELECT policy
DROP POLICY IF EXISTS "Org members and admins can view work items" ON public.work_items;

CREATE POLICY "Users can view work items"
ON public.work_items
FOR SELECT
USING (
  auth.uid() = owner_id
  OR public.is_business_org_admin(organization_id)
  OR public.is_platform_admin()
);

-- 5. Fix clients SELECT policy
DROP POLICY IF EXISTS "Users can view clients" ON public.clients;

CREATE POLICY "Users can view clients"
ON public.clients
FOR SELECT
USING (
  auth.uid() = owner_id
  OR (organization_id IS NOT NULL AND public.is_business_org_admin(organization_id))
);

-- 6. Membership cap trigger (max 5 members)
CREATE OR REPLACE FUNCTION public.enforce_membership_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_count integer;
  v_max_members integer := 5;
BEGIN
  SELECT COUNT(*) INTO v_member_count
  FROM public.organization_memberships
  WHERE organization_id = NEW.organization_id;
  
  IF public.is_platform_admin() THEN
    RETURN NEW;
  END IF;
  
  IF v_member_count >= v_max_members THEN
    RAISE EXCEPTION 'Membership cap reached: maximum % members per organization', v_max_members;
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_membership_cap_trigger ON public.organization_memberships;
CREATE TRIGGER enforce_membership_cap_trigger
  BEFORE INSERT ON public.organization_memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_membership_cap();