-- Platform Console v2: Trial Vouchers, Plan Limits, SaaS Metrics Infrastructure
-- ============================================================================

-- 1. Trial Vouchers Table
-- ============================================================================
CREATE TABLE public.trial_vouchers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  extension_days INTEGER NOT NULL CHECK (extension_days > 0 AND extension_days <= 365),
  expires_at TIMESTAMPTZ,
  usage_limit INTEGER NOT NULL DEFAULT 1,
  usage_count INTEGER NOT NULL DEFAULT 0,
  restricted_org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  notes TEXT
);

-- Enable RLS
ALTER TABLE public.trial_vouchers ENABLE ROW LEVEL SECURITY;

-- Only platform admins can manage vouchers
CREATE POLICY "Platform admins can manage vouchers" ON public.trial_vouchers
  FOR ALL USING (public.is_platform_admin());

-- Org users can view vouchers for their org (for redemption flow)
CREATE POLICY "Org users can view unrestricted or own-org vouchers" ON public.trial_vouchers
  FOR SELECT USING (
    restricted_org_id IS NULL 
    OR restricted_org_id = public.get_user_org_id()
    OR public.is_platform_admin()
  );

-- 2. Voucher Redemptions Table (track who redeemed what)
-- ============================================================================
CREATE TABLE public.voucher_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id UUID NOT NULL REFERENCES public.trial_vouchers(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  redeemed_by UUID NOT NULL,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  extension_applied_days INTEGER NOT NULL,
  UNIQUE(voucher_id, organization_id)
);

-- Enable RLS
ALTER TABLE public.voucher_redemptions ENABLE ROW LEVEL SECURITY;

-- Platform admins can see all, org members can see their own
CREATE POLICY "View redemptions policy" ON public.voucher_redemptions
  FOR SELECT USING (
    public.is_org_member(organization_id)
    OR public.is_platform_admin()
  );

-- Org admins can redeem (insert)
CREATE POLICY "Org admins can redeem vouchers" ON public.voucher_redemptions
  FOR INSERT WITH CHECK (
    public.is_org_admin(organization_id)
  );

-- 3. Plan Tiers and Limits
-- ============================================================================
CREATE TYPE public.plan_tier AS ENUM ('FREE_TRIAL', 'BASIC', 'PRO', 'ENTERPRISE');

-- Add tier to subscriptions if not exists
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS tier public.plan_tier DEFAULT 'FREE_TRIAL';

-- Plan limits configuration table
CREATE TABLE public.plan_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier public.plan_tier NOT NULL UNIQUE,
  max_work_items INTEGER DEFAULT 100,
  max_clients INTEGER DEFAULT 50,
  max_members INTEGER DEFAULT 3,
  email_sends_per_hour INTEGER DEFAULT 10,
  email_sends_per_day INTEGER DEFAULT 50,
  sync_requests_per_hour INTEGER DEFAULT 5,
  sync_requests_per_day INTEGER DEFAULT 20,
  file_uploads_per_day INTEGER DEFAULT 10,
  storage_mb INTEGER DEFAULT 500,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.plan_limits ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read plan limits
CREATE POLICY "Users can view plan limits" ON public.plan_limits
  FOR SELECT TO authenticated USING (true);

-- Only platform admins can modify
CREATE POLICY "Platform admins can manage plan limits" ON public.plan_limits
  FOR ALL USING (public.is_platform_admin());

-- Insert default limits
INSERT INTO public.plan_limits (tier, max_work_items, max_clients, max_members, email_sends_per_hour, email_sends_per_day, sync_requests_per_hour, sync_requests_per_day, file_uploads_per_day, storage_mb)
VALUES 
  ('FREE_TRIAL', 50, 25, 2, 5, 20, 3, 10, 5, 200),
  ('BASIC', 200, 100, 5, 20, 100, 10, 50, 20, 1000),
  ('PRO', 1000, 500, 20, 50, 500, 30, 200, 100, 5000),
  ('ENTERPRISE', 10000, 5000, 100, 200, 2000, 100, 1000, 500, 50000)
ON CONFLICT (tier) DO NOTHING;

-- 4. Organization plan overrides (for custom limits)
-- ============================================================================
CREATE TABLE public.organization_plan_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  max_work_items INTEGER,
  max_clients INTEGER,
  max_members INTEGER,
  email_sends_per_hour INTEGER,
  email_sends_per_day INTEGER,
  sync_requests_per_hour INTEGER,
  sync_requests_per_day INTEGER,
  file_uploads_per_day INTEGER,
  storage_mb INTEGER,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.organization_plan_overrides ENABLE ROW LEVEL SECURITY;

-- Org members can read their own overrides
CREATE POLICY "Org members can view their overrides" ON public.organization_plan_overrides
  FOR SELECT USING (public.is_org_member(organization_id));

-- Platform admins can manage
CREATE POLICY "Platform admins can manage overrides" ON public.organization_plan_overrides
  FOR ALL USING (public.is_platform_admin());

-- 5. Estimated MRR Config (for SaaS metrics)
-- ============================================================================
CREATE TABLE public.mrr_pricing_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier public.plan_tier NOT NULL UNIQUE,
  monthly_price_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.mrr_pricing_config ENABLE ROW LEVEL SECURITY;

-- Platform admins can manage
CREATE POLICY "Platform admins can manage MRR config" ON public.mrr_pricing_config
  FOR ALL USING (public.is_platform_admin());

-- Insert default pricing
INSERT INTO public.mrr_pricing_config (tier, monthly_price_usd)
VALUES 
  ('FREE_TRIAL', 0),
  ('BASIC', 49.00),
  ('PRO', 149.00),
  ('ENTERPRISE', 499.00)
ON CONFLICT (tier) DO NOTHING;

-- 6. Platform admin access to subscriptions UPDATE (for tier changes)
-- ============================================================================
DROP POLICY IF EXISTS "Platform admins can update subscriptions" ON public.subscriptions;
CREATE POLICY "Platform admins can update subscriptions" ON public.subscriptions
  FOR UPDATE USING (public.is_platform_admin());

-- 7. Add indexes for performance
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_trial_vouchers_code ON public.trial_vouchers(code);
CREATE INDEX IF NOT EXISTS idx_trial_vouchers_expires ON public.trial_vouchers(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_voucher_redemptions_org ON public.voucher_redemptions(organization_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_tier ON public.subscriptions(tier);

-- 8. Trigger for updated_at on new tables
-- ============================================================================
CREATE TRIGGER update_plan_limits_updated_at
  BEFORE UPDATE ON public.plan_limits
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_org_plan_overrides_updated_at
  BEFORE UPDATE ON public.organization_plan_overrides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_mrr_pricing_config_updated_at
  BEFORE UPDATE ON public.mrr_pricing_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();