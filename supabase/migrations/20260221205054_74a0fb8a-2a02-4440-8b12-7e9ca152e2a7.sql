
-- =================================================================
-- FIX: Super Admin entitlement regression
-- Root cause: get_effective_limits treats NULL max_clients from
-- subscription_plans as "not set" instead of "unlimited", AND
-- billing_subscription_state has no row for the Super Admin org.
-- =================================================================

-- 1. Backfill billing_subscription_state for Super Admin org
INSERT INTO billing_subscription_state (organization_id, plan_code, status, current_period_start, current_period_end)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'ENTERPRISE',
  'ACTIVE',
  now(),
  '2036-02-13T19:30:33.826668+00:00'
)
ON CONFLICT (organization_id) DO UPDATE SET
  plan_code = 'ENTERPRISE',
  status = 'ACTIVE',
  current_period_end = '2036-02-13T19:30:33.826668+00:00';

-- 2. Fix get_effective_limits to handle NULL as "unlimited"
--    NULL from subscription_plans means no limit; it must NOT
--    fall through to FREE_TRIAL defaults.
CREATE OR REPLACE FUNCTION public.get_effective_limits(p_org_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_plan_code text;
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
    SELECT * INTO v_limits FROM plan_limits
    WHERE tier = CASE v_plan_code
      WHEN 'BASIC' THEN 'BASIC'
      WHEN 'PRO' THEN 'PRO'
      WHEN 'BUSINESS' THEN 'PRO'
      WHEN 'ENTERPRISE' THEN 'ENTERPRISE'
      WHEN 'UNLIMITED' THEN 'ENTERPRISE'
      ELSE 'FREE_TRIAL'
    END;
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
      -- Determine tier from subscription_plans name
      SELECT * INTO v_limits FROM plan_limits WHERE tier = 'FREE_TRIAL';
      -- NULL in subscription_plans means UNLIMITED — use ENTERPRISE limits
      IF v_sub_max_clients IS NULL AND v_sub_max_work_items IS NULL THEN
        SELECT * INTO v_limits FROM plan_limits WHERE tier = 'ENTERPRISE';
      ELSE
        -- Override with subscription_plans values where set
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
    -- Check if org owner is a platform admin
    IF EXISTS (
      SELECT 1 FROM platform_admins pa
      JOIN organization_memberships om ON om.user_id = pa.user_id
      WHERE om.organization_id = p_org_id
    ) THEN
      SELECT * INTO v_limits FROM plan_limits WHERE tier = 'ENTERPRISE';
      v_found := true;
    END IF;
  END IF;

  -- ── Ultimate fallback: FREE_TRIAL ──
  IF NOT v_found THEN
    SELECT * INTO v_limits FROM plan_limits WHERE tier = 'FREE_TRIAL';
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
