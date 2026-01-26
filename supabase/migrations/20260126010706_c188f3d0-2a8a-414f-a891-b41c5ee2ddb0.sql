-- ============================================================================
-- Platform Vouchers Schema for COURTESY vouchers
-- ============================================================================

-- 1) Create platform_vouchers table
CREATE TABLE IF NOT EXISTS public.platform_vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_type text NOT NULL CHECK (voucher_type IN ('COURTESY')),
  code text UNIQUE NOT NULL,
  token_hash text UNIQUE NOT NULL,
  recipient_email text NOT NULL,
  plan_code text NOT NULL CHECK (plan_code IN ('ENTERPRISE')),
  duration_days int NOT NULL DEFAULT 365,
  amount_cop_incl_iva int NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'COP',
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REDEEMED','REVOKED','EXPIRED')),
  expires_at timestamptz NULL,
  redeemed_at timestamptz NULL,
  redeemed_by_user_id uuid NULL REFERENCES auth.users(id),
  redeemed_for_org_id uuid NULL REFERENCES public.organizations(id),
  note text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id)
);

-- Indexes for platform_vouchers
CREATE INDEX IF NOT EXISTS idx_platform_vouchers_status ON public.platform_vouchers(status);
CREATE INDEX IF NOT EXISTS idx_platform_vouchers_recipient_email ON public.platform_vouchers(recipient_email);
CREATE INDEX IF NOT EXISTS idx_platform_vouchers_created_at ON public.platform_vouchers(created_at DESC);

-- 2) Create platform_voucher_events table (immutable audit trail)
CREATE TABLE IF NOT EXISTS public.platform_voucher_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id uuid NOT NULL REFERENCES public.platform_vouchers(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('CREATED','REDEEM_ATTEMPT','REDEEMED','REVOKED','EXPIRED')),
  actor_user_id uuid NULL,
  actor_email text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for voucher events
CREATE INDEX IF NOT EXISTS idx_platform_voucher_events_voucher_created 
  ON public.platform_voucher_events(voucher_id, created_at DESC);

-- 3) Add comped columns to billing_subscription_state
ALTER TABLE public.billing_subscription_state 
  ADD COLUMN IF NOT EXISTS comped_until_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS comped_reason text NULL,
  ADD COLUMN IF NOT EXISTS comped_voucher_id uuid NULL REFERENCES public.platform_vouchers(id);

-- ============================================================================
-- RLS Policies
-- ============================================================================

ALTER TABLE public.platform_vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_voucher_events ENABLE ROW LEVEL SECURITY;

-- Platform admin can manage vouchers
CREATE POLICY "Platform admins can manage vouchers"
  ON public.platform_vouchers
  FOR ALL
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- Platform admin can manage voucher events
CREATE POLICY "Platform admins can manage voucher events"
  ON public.platform_voucher_events
  FOR ALL
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- ============================================================================
-- RPC: platform_create_courtesy_voucher
-- ============================================================================

CREATE OR REPLACE FUNCTION public.platform_create_courtesy_voucher(
  p_recipient_email text,
  p_note text DEFAULT NULL,
  p_expires_days int DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_raw_token text;
  v_token_hash text;
  v_code text;
  v_voucher_id uuid;
  v_expires_at timestamptz;
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_i int;
BEGIN
  -- Check platform admin
  v_user_id := auth.uid();
  IF v_user_id IS NULL OR NOT public.is_platform_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not authorized', 'code', 'UNAUTHORIZED');
  END IF;

  -- Validate input
  IF p_recipient_email IS NULL OR p_recipient_email = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Recipient email is required', 'code', 'INVALID_INPUT');
  END IF;

  IF p_expires_days < 1 OR p_expires_days > 180 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Expiry days must be between 1 and 180', 'code', 'INVALID_INPUT');
  END IF;

  -- Generate cryptographically random token (32 bytes = 64 hex chars)
  v_raw_token := encode(gen_random_bytes(32), 'hex');
  
  -- Hash the token for storage
  v_token_hash := encode(sha256(v_raw_token::bytea), 'hex');
  
  -- Generate human-friendly code: CORTESIA-XXXXXX
  v_code := 'CORTESIA-';
  FOR v_i IN 1..6 LOOP
    v_code := v_code || substr(v_chars, floor(random() * length(v_chars) + 1)::int, 1);
  END LOOP;
  
  -- Calculate expiry
  v_expires_at := now() + (p_expires_days || ' days')::interval;

  -- Insert voucher
  INSERT INTO public.platform_vouchers (
    voucher_type,
    code,
    token_hash,
    recipient_email,
    plan_code,
    duration_days,
    amount_cop_incl_iva,
    currency,
    status,
    expires_at,
    note,
    created_by_user_id
  ) VALUES (
    'COURTESY',
    v_code,
    v_token_hash,
    lower(trim(p_recipient_email)),
    'ENTERPRISE',
    365,
    0,
    'COP',
    'ACTIVE',
    v_expires_at,
    p_note,
    v_user_id
  )
  RETURNING id INTO v_voucher_id;

  -- Record creation event
  INSERT INTO public.platform_voucher_events (
    voucher_id,
    event_type,
    actor_user_id,
    actor_email,
    metadata
  ) VALUES (
    v_voucher_id,
    'CREATED',
    v_user_id,
    (SELECT email FROM auth.users WHERE id = v_user_id),
    jsonb_build_object(
      'recipient_email', lower(trim(p_recipient_email)),
      'expires_days', p_expires_days,
      'note', p_note
    )
  );

  -- Return success with raw token (shown only once)
  RETURN jsonb_build_object(
    'ok', true,
    'voucher_id', v_voucher_id,
    'code', v_code,
    'recipient_email', lower(trim(p_recipient_email)),
    'status', 'ACTIVE',
    'expires_at', v_expires_at,
    'raw_token', v_raw_token
  );
END;
$$;

-- ============================================================================
-- RPC: platform_redeem_voucher
-- ============================================================================

CREATE OR REPLACE FUNCTION public.platform_redeem_voucher(
  p_raw_token text,
  p_target_org_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_user_email text;
  v_token_hash text;
  v_voucher record;
  v_org_id uuid;
  v_comped_until timestamptz;
  v_enterprise_plan_id uuid;
BEGIN
  -- Check authenticated
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Authentication required', 'code', 'UNAUTHORIZED');
  END IF;

  -- Get user email
  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;

  -- Hash incoming token
  v_token_hash := encode(sha256(p_raw_token::bytea), 'hex');

  -- Find voucher
  SELECT * INTO v_voucher
  FROM public.platform_vouchers
  WHERE token_hash = v_token_hash;

  IF v_voucher IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Voucher not found', 'code', 'NOT_FOUND');
  END IF;

  -- Record attempt
  INSERT INTO public.platform_voucher_events (
    voucher_id, event_type, actor_user_id, actor_email, metadata
  ) VALUES (
    v_voucher.id, 'REDEEM_ATTEMPT', v_user_id, v_user_email,
    jsonb_build_object('target_org_id', p_target_org_id)
  );

  -- Check status
  IF v_voucher.status != 'ACTIVE' THEN
    RETURN jsonb_build_object(
      'ok', false, 
      'error', 'Voucher is ' || v_voucher.status, 
      'code', 'INVALID_STATUS'
    );
  END IF;

  -- Check expiry
  IF v_voucher.expires_at IS NOT NULL AND v_voucher.expires_at < now() THEN
    -- Mark as expired
    UPDATE public.platform_vouchers SET status = 'EXPIRED' WHERE id = v_voucher.id;
    INSERT INTO public.platform_voucher_events (voucher_id, event_type, actor_user_id, metadata)
    VALUES (v_voucher.id, 'EXPIRED', v_user_id, '{}'::jsonb);
    
    RETURN jsonb_build_object('ok', false, 'error', 'Voucher has expired', 'code', 'EXPIRED');
  END IF;

  -- Determine target org
  IF p_target_org_id IS NOT NULL THEN
    -- Verify user is member of the org
    IF NOT EXISTS (
      SELECT 1 FROM public.organization_memberships
      WHERE organization_id = p_target_org_id AND user_id = v_user_id
    ) THEN
      RETURN jsonb_build_object(
        'ok', false, 
        'error', 'You are not a member of the specified organization', 
        'code', 'NOT_MEMBER'
      );
    END IF;
    v_org_id := p_target_org_id;
  ELSE
    -- Use user's primary org from profile
    SELECT organization_id INTO v_org_id
    FROM public.profiles WHERE id = v_user_id;
    
    -- If no org, create one
    IF v_org_id IS NULL THEN
      INSERT INTO public.organizations (name, metadata)
      VALUES (
        'Organización de ' || split_part(v_user_email, '@', 1),
        jsonb_build_object('account_type', 'FIRM', 'upgraded_via_voucher', true)
      )
      RETURNING id INTO v_org_id;
      
      -- Update profile
      UPDATE public.profiles SET organization_id = v_org_id WHERE id = v_user_id;
      
      -- Create membership
      INSERT INTO public.organization_memberships (organization_id, user_id, role)
      VALUES (v_org_id, v_user_id, 'OWNER')
      ON CONFLICT (organization_id, user_id) DO NOTHING;
    END IF;
  END IF;

  -- Ensure org account_type is FIRM for enterprise
  UPDATE public.organizations
  SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('account_type', 'FIRM')
  WHERE id = v_org_id;

  -- Calculate comped period
  v_comped_until := now() + (v_voucher.duration_days || ' days')::interval;

  -- Upsert billing_subscription_state
  INSERT INTO public.billing_subscription_state (
    organization_id,
    plan_code,
    billing_cycle_months,
    currency,
    current_price_cop_incl_iva,
    intro_offer_applied,
    price_lock_end_at,
    comped_until_at,
    comped_reason,
    comped_voucher_id
  ) VALUES (
    v_org_id,
    'ENTERPRISE',
    1,
    'COP',
    0,
    false,
    NULL,
    v_comped_until,
    'COURTESY_VOUCHER',
    v_voucher.id
  )
  ON CONFLICT (organization_id) DO UPDATE SET
    plan_code = 'ENTERPRISE',
    billing_cycle_months = 1,
    currency = 'COP',
    current_price_cop_incl_iva = 0,
    intro_offer_applied = false,
    price_lock_end_at = NULL,
    comped_until_at = v_comped_until,
    comped_reason = 'COURTESY_VOUCHER',
    comped_voucher_id = v_voucher.id,
    updated_at = now();

  -- Get enterprise plan id
  SELECT id INTO v_enterprise_plan_id
  FROM public.subscription_plans
  WHERE name IN ('enterprise', 'unlimited')
  LIMIT 1;

  -- Update core subscriptions table
  UPDATE public.subscriptions
  SET 
    plan_id = COALESCE(v_enterprise_plan_id, plan_id),
    status = 'active',
    current_period_end = v_comped_until,
    trial_ends_at = NULL,
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('comped', true, 'voucher_id', v_voucher.id::text)
  WHERE organization_id = v_org_id;

  -- If no subscription exists, create one
  IF NOT FOUND THEN
    INSERT INTO public.subscriptions (
      organization_id,
      plan_id,
      status,
      current_period_end,
      metadata
    ) VALUES (
      v_org_id,
      v_enterprise_plan_id,
      'active',
      v_comped_until,
      jsonb_build_object('comped', true, 'voucher_id', v_voucher.id::text)
    );
  END IF;

  -- Mark voucher as redeemed
  UPDATE public.platform_vouchers
  SET 
    status = 'REDEEMED',
    redeemed_at = now(),
    redeemed_by_user_id = v_user_id,
    redeemed_for_org_id = v_org_id
  WHERE id = v_voucher.id;

  -- Record redemption event
  INSERT INTO public.platform_voucher_events (
    voucher_id, event_type, actor_user_id, actor_email, metadata
  ) VALUES (
    v_voucher.id, 'REDEEMED', v_user_id, v_user_email,
    jsonb_build_object('org_id', v_org_id, 'comped_until', v_comped_until)
  );

  -- Write audit log
  INSERT INTO public.audit_logs (
    organization_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata
  ) VALUES (
    v_org_id, v_user_id, 'USER', 'VOUCHER_REDEEMED', 'subscription', v_voucher.id,
    jsonb_build_object(
      'voucher_code', v_voucher.code,
      'plan_code', 'ENTERPRISE',
      'comped_until', v_comped_until,
      'duration_days', v_voucher.duration_days
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'org_id', v_org_id,
    'plan_code', 'ENTERPRISE',
    'comped_until_at', v_comped_until
  );
END;
$$;

-- ============================================================================
-- RPC: platform_revoke_voucher
-- ============================================================================

CREATE OR REPLACE FUNCTION public.platform_revoke_voucher(
  p_voucher_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_voucher record;
BEGIN
  -- Check platform admin
  v_user_id := auth.uid();
  IF v_user_id IS NULL OR NOT public.is_platform_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not authorized', 'code', 'UNAUTHORIZED');
  END IF;

  -- Find voucher
  SELECT * INTO v_voucher FROM public.platform_vouchers WHERE id = p_voucher_id;
  
  IF v_voucher IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Voucher not found', 'code', 'NOT_FOUND');
  END IF;

  IF v_voucher.status != 'ACTIVE' THEN
    RETURN jsonb_build_object(
      'ok', false, 
      'error', 'Can only revoke ACTIVE vouchers', 
      'code', 'INVALID_STATUS'
    );
  END IF;

  -- Revoke
  UPDATE public.platform_vouchers
  SET status = 'REVOKED'
  WHERE id = p_voucher_id;

  -- Record event
  INSERT INTO public.platform_voucher_events (
    voucher_id, event_type, actor_user_id, metadata
  ) VALUES (
    p_voucher_id, 'REVOKED', v_user_id,
    jsonb_build_object('reason', p_reason)
  );

  RETURN jsonb_build_object('ok', true, 'voucher_id', p_voucher_id);
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.platform_create_courtesy_voucher TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_redeem_voucher TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_revoke_voucher TO authenticated;