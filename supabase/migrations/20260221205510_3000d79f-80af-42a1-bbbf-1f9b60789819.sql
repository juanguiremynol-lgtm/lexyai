
-- =================================================================
-- HARDEN: Gate platform-admin entitlement bypass behind dedicated
-- platform_admins table (not general roles) and log audit event
-- when bypass is triggered. Prevents silent entitlement escalation.
-- =================================================================

-- 1. Update get_effective_limits: Priority 3 bypass now:
--    a) Uses platform_admins table explicitly (already does)
--    b) Logs an immutable audit_logs entry when bypass fires
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
  v_admin_user_id uuid;
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

  -- ── Priority 3: Platform admin bypass (DEDICATED platform_admins table) ──
  -- This is NOT based on general roles; it requires an explicit row in
  -- platform_admins. An immutable audit event is logged every time this
  -- bypass fires to prevent silent entitlement escalation.
  IF NOT v_found THEN
    SELECT pa.user_id INTO v_admin_user_id
    FROM platform_admins pa
    JOIN organization_memberships om ON om.user_id = pa.user_id
    WHERE om.organization_id = p_org_id
    LIMIT 1;

    IF v_admin_user_id IS NOT NULL THEN
      SELECT * INTO v_limits FROM plan_limits WHERE tier = 'ENTERPRISE'::plan_tier;
      v_found := true;

      -- ── AUDIT: Log platform-admin entitlement bypass ──
      INSERT INTO audit_logs (
        organization_id, actor_user_id, actor_type, action,
        entity_type, entity_id, metadata
      ) VALUES (
        p_org_id,
        v_admin_user_id,
        'platform_admin',
        'ENTITLEMENT_BYPASS',
        'organization',
        NULL,
        jsonb_build_object(
          'reason', 'No billing or subscription record found; platform_admin bypass applied',
          'resolved_tier', 'ENTERPRISE',
          'org_id', p_org_id::text
        )
      );
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

-- 2. Remove redundant is_platform_admin() bypass from enforce_membership_cap
--    It should delegate entirely to get_effective_limits() like the other triggers.
CREATE OR REPLACE FUNCTION public.enforce_membership_cap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_member_count integer;
  v_max_members integer;
  v_limits jsonb;
BEGIN
  -- Single source of truth: get_effective_limits handles all tier resolution
  -- including platform-admin bypass with audit logging.
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
$function$;
