
-- Fix: Cast text to plan_tier enum in get_effective_limits
CREATE OR REPLACE FUNCTION public.get_effective_limits(p_org_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_plan_code text;
  v_tier_text text;
  v_limits record;
  v_sub_max_clients integer;
  v_sub_max_work_items integer;
  v_found boolean := false;
BEGIN
  -- ── Priority 1: billing_subscription_state (new system) ──
  SELECT plan_code INTO v_plan_code
  FROM billing_subscription_state
  WHERE organization_id = p_org_id;

  IF v_plan_code IS NOT NULL THEN
    v_tier_text := CASE v_plan_code
      WHEN 'BASIC' THEN 'BASIC'
      WHEN 'PRO' THEN 'PRO'
      WHEN 'BUSINESS' THEN 'PRO'
      WHEN 'ENTERPRISE' THEN 'ENTERPRISE'
      WHEN 'UNLIMITED' THEN 'ENTERPRISE'
      ELSE 'FREE_TRIAL'
    END;
    SELECT * INTO v_limits FROM plan_limits
    WHERE tier = v_tier_text::plan_tier;
    v_found := v_limits IS NOT NULL;
  END IF;

  -- ── Priority 2: legacy subscriptions + subscription_plans ──
  IF NOT v_found THEN
    SELECT sp.max_clients, sp.max_filings
    INTO v_sub_max_clients, v_sub_max_work_items
    FROM subscriptions s
    JOIN subscription_plans sp ON s.plan_id = sp.id
    WHERE s.organization_id = p_org_id
      AND s.status IN ('active', 'trialing')
    LIMIT 1;

    IF FOUND THEN
      -- NULL in subscription_plans means UNLIMITED — use ENTERPRISE limits
      IF v_sub_max_clients IS NULL AND v_sub_max_work_items IS NULL THEN
        SELECT * INTO v_limits FROM plan_limits WHERE tier = 'ENTERPRISE'::plan_tier;
      ELSE
        SELECT * INTO v_limits FROM plan_limits WHERE tier = 'FREE_TRIAL'::plan_tier;
        IF v_sub_max_clients IS NOT NULL THEN
          v_limits.max_clients := v_sub_max_clients;
        END IF;
        IF v_sub_max_work_items IS NOT NULL THEN
          v_limits.max_work_items := v_sub_max_work_items;
        END IF;
      END IF;
      v_found := true;
    END IF;
  END IF;

  -- ── Priority 3: Platform admin bypass — always ENTERPRISE ──
  IF NOT v_found THEN
    IF EXISTS (
      SELECT 1 FROM platform_admins pa
      JOIN organization_memberships om ON om.user_id = pa.user_id
      WHERE om.organization_id = p_org_id
    ) THEN
      SELECT * INTO v_limits FROM plan_limits WHERE tier = 'ENTERPRISE'::plan_tier;
      v_found := true;
    END IF;
  END IF;

  -- ── Ultimate fallback: FREE_TRIAL ──
  IF NOT v_found THEN
    SELECT * INTO v_limits FROM plan_limits WHERE tier = 'FREE_TRIAL'::plan_tier;
  END IF;

  RETURN jsonb_build_object(
    'max_work_items', COALESCE(v_limits.max_work_items, 50),
    'max_clients', COALESCE(v_limits.max_clients, 25),
    'max_members', COALESCE(v_limits.max_members, 2),
    'max_monitored_items', COALESCE(v_limits.max_work_items, 50),
    'sync_requests_per_hour', COALESCE(v_limits.sync_requests_per_hour, 3),
    'sync_requests_per_day', COALESCE(v_limits.sync_requests_per_day, 10)
  );
END;
$function$;
