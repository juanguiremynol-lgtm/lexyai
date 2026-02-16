
-- =============================================================================
-- UNIFY LIMITS SOURCE OF TRUTH
-- Make enforce_membership_cap delegate to get_effective_limits (plan_limits)
-- and align billing_plans.max_members to match plan_limits values
-- =============================================================================

-- 1. Align billing_plans.max_members with plan_limits
UPDATE public.billing_plans SET max_members = 5 WHERE code = 'BASIC';
UPDATE public.billing_plans SET max_members = 20 WHERE code = 'PRO';
UPDATE public.billing_plans SET max_members = 100 WHERE code = 'ENTERPRISE';

-- 2. Rewrite enforce_membership_cap to use get_effective_limits as single source
CREATE OR REPLACE FUNCTION public.enforce_membership_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_member_count integer;
  v_max_members integer;
  v_limits jsonb;
  v_is_platform_admin boolean;
BEGIN
  -- Platform admins bypass
  BEGIN
    v_is_platform_admin := public.is_platform_admin();
  EXCEPTION WHEN OTHERS THEN
    v_is_platform_admin := false;
  END;
  
  IF v_is_platform_admin THEN
    RETURN NEW;
  END IF;

  -- Single source of truth: get_effective_limits reads from plan_limits
  v_limits := public.get_effective_limits(NEW.organization_id);
  v_max_members := COALESCE((v_limits->>'max_members')::integer, 2);

  SELECT COUNT(*) INTO v_member_count
  FROM organization_memberships
  WHERE organization_id = NEW.organization_id;

  IF v_member_count >= v_max_members THEN
    RAISE EXCEPTION 'Membership cap reached: your plan allows maximum % member(s). Upgrade to add more.', v_max_members
      USING ERRCODE = 'P0429';
  END IF;

  RETURN NEW;
END;
$$;
