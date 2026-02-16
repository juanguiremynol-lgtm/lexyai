
-- ============================================================================
-- P2: SERVER-SIDE ENTITLEMENT ENFORCEMENT
-- Creates DB-level guards that cannot be bypassed by any client path.
-- ============================================================================

-- 1. Canonical effective-plan resolver
-- Returns the effective limits for an organization based on billing state + subscription_plans
CREATE OR REPLACE FUNCTION public.get_effective_limits(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_plan_code text;
  v_max_work_items integer;
  v_max_monitored_items integer;
  v_max_clients integer;
  v_max_members integer;
  v_limits record;
  v_sub record;
BEGIN
  -- First try billing_subscription_state (new system)
  SELECT plan_code INTO v_plan_code
  FROM billing_subscription_state
  WHERE organization_id = p_org_id;

  -- Map plan_code to plan_limits tier
  IF v_plan_code IS NOT NULL THEN
    -- Map billing plan codes to plan_limits tiers
    SELECT * INTO v_limits FROM plan_limits
    WHERE tier = CASE v_plan_code
      WHEN 'BASIC' THEN 'BASIC'
      WHEN 'PRO' THEN 'PRO'
      WHEN 'BUSINESS' THEN 'PRO'
      WHEN 'ENTERPRISE' THEN 'ENTERPRISE'
      ELSE 'FREE_TRIAL'
    END;
  END IF;

  -- Fallback to subscription_plans (legacy system)
  IF v_limits IS NULL THEN
    SELECT sp.max_clients, sp.max_filings INTO v_max_clients, v_max_work_items
    FROM subscriptions s
    JOIN subscription_plans sp ON s.plan_id = sp.id
    WHERE s.organization_id = p_org_id
    LIMIT 1;

    -- Use subscription_plans values with FREE_TRIAL defaults for missing fields
    SELECT * INTO v_limits FROM plan_limits WHERE tier = 'FREE_TRIAL';
    IF v_max_clients IS NOT NULL THEN
      v_limits.max_clients := v_max_clients;
    END IF;
    IF v_max_work_items IS NOT NULL THEN
      v_limits.max_work_items := v_max_work_items;
    END IF;
  END IF;

  -- Ultimate fallback: FREE_TRIAL
  IF v_limits IS NULL THEN
    SELECT * INTO v_limits FROM plan_limits WHERE tier = 'FREE_TRIAL';
  END IF;

  RETURN jsonb_build_object(
    'max_work_items', COALESCE(v_limits.max_work_items, 50),
    'max_clients', COALESCE(v_limits.max_clients, 25),
    'max_members', COALESCE(v_limits.max_members, 2),
    'max_monitored_items', COALESCE(v_limits.max_work_items, 50), -- monitored ≤ total work items
    'sync_requests_per_hour', COALESCE(v_limits.sync_requests_per_hour, 3),
    'sync_requests_per_day', COALESCE(v_limits.sync_requests_per_day, 10)
  );
END;
$$;

-- 2. Enforce work item creation limits (trigger on INSERT)
CREATE OR REPLACE FUNCTION public.enforce_work_item_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org_id uuid;
  v_limits jsonb;
  v_current_count integer;
  v_max integer;
BEGIN
  -- Get org from profile
  SELECT organization_id INTO v_org_id
  FROM profiles WHERE id = NEW.owner_id;

  IF v_org_id IS NULL THEN
    -- No org = no limits enforced (shouldn't happen in practice)
    RETURN NEW;
  END IF;

  -- Set organization_id if not provided
  IF NEW.organization_id IS NULL THEN
    NEW.organization_id := v_org_id;
  END IF;

  v_limits := get_effective_limits(v_org_id);
  v_max := (v_limits->>'max_work_items')::integer;

  -- Count current non-deleted work items for this org
  SELECT COUNT(*) INTO v_current_count
  FROM work_items
  WHERE organization_id = v_org_id
    AND deleted_at IS NULL;

  IF v_current_count >= v_max THEN
    RAISE EXCEPTION 'Work item limit reached: maximum % items for your plan. Upgrade to add more.', v_max
      USING ERRCODE = 'P0429';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_work_item_limit_trigger ON public.work_items;
CREATE TRIGGER enforce_work_item_limit_trigger
  BEFORE INSERT ON public.work_items
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_work_item_limit();

-- 3. Enforce monitoring limit (trigger on UPDATE when monitoring_enabled flips to true)
CREATE OR REPLACE FUNCTION public.enforce_monitoring_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_limits jsonb;
  v_current_monitored integer;
  v_max integer;
BEGIN
  -- Only check when monitoring is being enabled (false→true)
  IF NEW.monitoring_enabled = true AND (OLD.monitoring_enabled IS DISTINCT FROM true) THEN
    IF NEW.organization_id IS NULL THEN
      RETURN NEW;
    END IF;

    v_limits := get_effective_limits(NEW.organization_id);
    v_max := (v_limits->>'max_monitored_items')::integer;

    SELECT COUNT(*) INTO v_current_monitored
    FROM work_items
    WHERE organization_id = NEW.organization_id
      AND monitoring_enabled = true
      AND deleted_at IS NULL
      AND id != NEW.id; -- exclude current item

    IF v_current_monitored >= v_max THEN
      RAISE EXCEPTION 'Monitoring limit reached: maximum % monitored items for your plan.', v_max
        USING ERRCODE = 'P0429';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_monitoring_limit_trigger ON public.work_items;
CREATE TRIGGER enforce_monitoring_limit_trigger
  BEFORE UPDATE ON public.work_items
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_monitoring_limit();

-- 4. Enforce client creation limit (trigger on INSERT)
CREATE OR REPLACE FUNCTION public.enforce_client_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org_id uuid;
  v_limits jsonb;
  v_current_count integer;
  v_max integer;
BEGIN
  -- Get org from profile
  SELECT organization_id INTO v_org_id
  FROM profiles WHERE id = NEW.owner_id;

  IF v_org_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_limits := get_effective_limits(v_org_id);
  v_max := (v_limits->>'max_clients')::integer;

  SELECT COUNT(*) INTO v_current_count
  FROM clients
  WHERE owner_id = NEW.owner_id; -- RLS already scopes, but be explicit

  IF v_current_count >= v_max THEN
    RAISE EXCEPTION 'Client limit reached: maximum % clients for your plan.', v_max
      USING ERRCODE = 'P0429';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_client_limit_trigger ON public.clients;
CREATE TRIGGER enforce_client_limit_trigger
  BEFORE INSERT ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_client_limit();

-- 5. Fix membership cap to be tier-aware
-- Non-BUSINESS orgs: max 1 member (the owner). BUSINESS: use billing_plans.max_members.
CREATE OR REPLACE FUNCTION public.enforce_membership_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_member_count integer;
  v_max_members integer;
  v_plan_code text;
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

  -- Get plan code from billing state
  SELECT bs.plan_code INTO v_plan_code
  FROM billing_subscription_state bs
  WHERE bs.organization_id = NEW.organization_id;

  -- Get max_members from billing_plans, default to 1 for non-business
  IF v_plan_code IS NOT NULL THEN
    SELECT bp.max_members INTO v_max_members
    FROM billing_plans bp
    WHERE bp.code = v_plan_code;
  END IF;

  -- Fallback: check subscription_plans for legacy
  IF v_max_members IS NULL THEN
    SELECT CASE 
      WHEN sp.name IN ('business', 'unlimited', 'enterprise') THEN 5
      ELSE 1
    END INTO v_max_members
    FROM subscriptions s
    JOIN subscription_plans sp ON s.plan_id = sp.id
    WHERE s.organization_id = NEW.organization_id;
  END IF;

  -- Ultimate fallback: 1 member (owner only) during trial
  v_max_members := COALESCE(v_max_members, 1);

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

-- Trigger already exists, just replacing the function
