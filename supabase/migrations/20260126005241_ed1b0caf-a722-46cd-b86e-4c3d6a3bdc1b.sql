-- ============================================================================
-- BILLING SYSTEM: Plans, Price Points, and Subscription State
-- Real production pricing (COP, IVA included)
-- ============================================================================

-- 1) billing_plans: Master plan definitions
CREATE TABLE IF NOT EXISTS public.billing_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  display_name text NOT NULL,
  is_enterprise boolean NOT NULL DEFAULT false,
  max_members int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2) billing_price_points: Canonical pricing (COP, IVA included)
CREATE TABLE IF NOT EXISTS public.billing_price_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.billing_plans(id) ON DELETE CASCADE,
  currency text NOT NULL DEFAULT 'COP',
  price_cop_incl_iva int NOT NULL,
  billing_cycle_months int NOT NULL CHECK (billing_cycle_months IN (1, 24)),
  price_type text NOT NULL CHECK (price_type IN ('INTRO', 'REGULAR')),
  valid_from timestamptz NOT NULL,
  valid_to timestamptz NULL,
  promo_requires_commit_24m boolean NOT NULL DEFAULT false,
  price_lock_months int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3) billing_subscription_state: Per-org billing state (independent of core subscriptions)
CREATE TABLE IF NOT EXISTS public.billing_subscription_state (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_code text NOT NULL,
  billing_cycle_months int NOT NULL DEFAULT 1,
  currency text NOT NULL DEFAULT 'COP',
  current_price_cop_incl_iva int NOT NULL DEFAULT 0,
  intro_offer_applied boolean NOT NULL DEFAULT false,
  price_lock_end_at timestamptz NULL,
  trial_end_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 4) Add billing_cycle_months and price fields to billing_checkout_sessions
ALTER TABLE public.billing_checkout_sessions 
  ADD COLUMN IF NOT EXISTS billing_cycle_months int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS price_point_id uuid NULL REFERENCES public.billing_price_points(id),
  ADD COLUMN IF NOT EXISTS amount_cop_incl_iva int NULL;

-- 5) Add amount_cop_incl_iva to billing_invoices
ALTER TABLE public.billing_invoices
  ADD COLUMN IF NOT EXISTS amount_cop_incl_iva int NULL;

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_billing_price_points_plan_cycle_type 
  ON public.billing_price_points (plan_id, billing_cycle_months, price_type);

CREATE INDEX IF NOT EXISTS idx_billing_price_points_valid_from 
  ON public.billing_price_points (valid_from);

CREATE INDEX IF NOT EXISTS idx_billing_subscription_state_plan_code 
  ON public.billing_subscription_state (plan_code);

CREATE INDEX IF NOT EXISTS idx_billing_checkout_sessions_org_status_created 
  ON public.billing_checkout_sessions (organization_id, status, created_at DESC);

-- ============================================================================
-- TRIGGERS: updated_at for billing_subscription_state
-- ============================================================================

CREATE OR REPLACE FUNCTION public.billing_subscription_state_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_billing_subscription_state_updated_at ON public.billing_subscription_state;
CREATE TRIGGER trigger_billing_subscription_state_updated_at
  BEFORE UPDATE ON public.billing_subscription_state
  FOR EACH ROW
  EXECUTE FUNCTION public.billing_subscription_state_updated_at();

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

ALTER TABLE public.billing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_price_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_subscription_state ENABLE ROW LEVEL SECURITY;

-- billing_plans: Public read (pricing page)
DROP POLICY IF EXISTS "Anyone can read billing plans" ON public.billing_plans;
CREATE POLICY "Anyone can read billing plans" 
  ON public.billing_plans FOR SELECT 
  USING (true);

-- billing_price_points: Public read (pricing page)
DROP POLICY IF EXISTS "Anyone can read billing price points" ON public.billing_price_points;
CREATE POLICY "Anyone can read billing price points" 
  ON public.billing_price_points FOR SELECT 
  USING (true);

-- billing_subscription_state: Org members can read their own
DROP POLICY IF EXISTS "Org members can read their billing state" ON public.billing_subscription_state;
CREATE POLICY "Org members can read their billing state" 
  ON public.billing_subscription_state FOR SELECT 
  USING (public.is_org_member(organization_id));

-- billing_subscription_state: Platform admins can read all
DROP POLICY IF EXISTS "Platform admins can read all billing states" ON public.billing_subscription_state;
CREATE POLICY "Platform admins can read all billing states" 
  ON public.billing_subscription_state FOR SELECT 
  USING (public.is_platform_admin());

-- ============================================================================
-- SEED DATA: billing_plans
-- ============================================================================

INSERT INTO public.billing_plans (code, display_name, is_enterprise, max_members)
VALUES 
  ('BASIC', 'Básico', false, 1),
  ('PRO', 'Profesional', false, 1),
  ('ENTERPRISE', 'Empresa', true, 25)
ON CONFLICT (code) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  is_enterprise = EXCLUDED.is_enterprise,
  max_members = EXCLUDED.max_members;

-- ============================================================================
-- SEED DATA: billing_price_points (Real COP prices, IVA included)
-- ============================================================================

-- Get plan IDs for seeding
DO $$
DECLARE
  v_basic_id uuid;
  v_pro_id uuid;
  v_enterprise_id uuid;
  v_launch_date timestamptz := '2026-02-01T00:00:00-05:00'::timestamptz;
  v_promo_end timestamptz := '2026-07-31T23:59:59-05:00'::timestamptz;
BEGIN
  SELECT id INTO v_basic_id FROM public.billing_plans WHERE code = 'BASIC';
  SELECT id INTO v_pro_id FROM public.billing_plans WHERE code = 'PRO';
  SELECT id INTO v_enterprise_id FROM public.billing_plans WHERE code = 'ENTERPRISE';

  -- REGULAR prices (monthly, valid from launch, no end)
  INSERT INTO public.billing_price_points 
    (plan_id, currency, price_cop_incl_iva, billing_cycle_months, price_type, valid_from, valid_to, promo_requires_commit_24m, price_lock_months)
  VALUES
    (v_basic_id, 'COP', 70000, 1, 'REGULAR', v_launch_date, NULL, false, 0),
    (v_pro_id, 'COP', 120000, 1, 'REGULAR', v_launch_date, NULL, false, 0),
    (v_enterprise_id, 'COP', 220000, 1, 'REGULAR', v_launch_date, NULL, false, 0)
  ON CONFLICT DO NOTHING;

  -- INTRO prices (24-month commitment, valid only during promo window)
  INSERT INTO public.billing_price_points 
    (plan_id, currency, price_cop_incl_iva, billing_cycle_months, price_type, valid_from, valid_to, promo_requires_commit_24m, price_lock_months)
  VALUES
    (v_basic_id, 'COP', 30000, 24, 'INTRO', v_launch_date, v_promo_end, true, 24),
    (v_pro_id, 'COP', 50000, 24, 'INTRO', v_launch_date, v_promo_end, true, 24),
    (v_enterprise_id, 'COP', 90000, 24, 'INTRO', v_launch_date, v_promo_end, true, 24)
  ON CONFLICT DO NOTHING;
END $$;
