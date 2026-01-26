-- Billing System Tables Only (mrr_pricing_config and plan_limits already exist)

-- =============================================================================
-- BILLING CUSTOMERS TABLE (one per organization)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.billing_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'mock',
  provider_customer_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.billing_customers ENABLE ROW LEVEL SECURITY;

-- Index for organization lookups
CREATE INDEX IF NOT EXISTS idx_billing_customers_org ON public.billing_customers(organization_id);

-- RLS Policies for billing_customers
DROP POLICY IF EXISTS "Org admins can view own billing customer" ON public.billing_customers;
CREATE POLICY "Org admins can view own billing customer"
  ON public.billing_customers FOR SELECT
  USING (
    public.is_org_admin(organization_id) OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS "Service role can manage billing customers" ON public.billing_customers;
CREATE POLICY "Service role can manage billing customers"
  ON public.billing_customers FOR ALL
  USING (auth.role() = 'service_role');

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_billing_customers_updated_at ON public.billing_customers;
CREATE TRIGGER update_billing_customers_updated_at
  BEFORE UPDATE ON public.billing_customers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================================
-- BILLING CHECKOUT SESSIONS TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.billing_checkout_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'mock',
  tier TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'COMPLETED', 'CANCELED', 'EXPIRED')),
  provider_session_id TEXT,
  checkout_url TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Enable RLS
ALTER TABLE public.billing_checkout_sessions ENABLE ROW LEVEL SECURITY;

-- Indexes for checkout sessions
CREATE INDEX IF NOT EXISTS idx_billing_checkout_sessions_org ON public.billing_checkout_sessions(organization_id);
CREATE INDEX IF NOT EXISTS idx_billing_checkout_sessions_org_status ON public.billing_checkout_sessions(organization_id, status, created_at DESC);

-- RLS Policies for billing_checkout_sessions
DROP POLICY IF EXISTS "Org admins can view own checkout sessions" ON public.billing_checkout_sessions;
CREATE POLICY "Org admins can view own checkout sessions"
  ON public.billing_checkout_sessions FOR SELECT
  USING (
    public.is_org_admin(organization_id) OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS "Org admins can create checkout sessions" ON public.billing_checkout_sessions;
CREATE POLICY "Org admins can create checkout sessions"
  ON public.billing_checkout_sessions FOR INSERT
  WITH CHECK (
    public.is_org_admin(organization_id)
  );

DROP POLICY IF EXISTS "Org admins can update own checkout sessions" ON public.billing_checkout_sessions;
CREATE POLICY "Org admins can update own checkout sessions"
  ON public.billing_checkout_sessions FOR UPDATE
  USING (
    public.is_org_admin(organization_id) OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS "Service role can manage checkout sessions" ON public.billing_checkout_sessions;
CREATE POLICY "Service role can manage checkout sessions"
  ON public.billing_checkout_sessions FOR ALL
  USING (auth.role() = 'service_role');

-- =============================================================================
-- BILLING INVOICES TABLE (placeholder for future invoice tracking)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.billing_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'mock',
  provider_invoice_id TEXT,
  amount_usd NUMERIC,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('DRAFT', 'OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE')),
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  hosted_invoice_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Enable RLS
ALTER TABLE public.billing_invoices ENABLE ROW LEVEL SECURITY;

-- Indexes for invoices
CREATE INDEX IF NOT EXISTS idx_billing_invoices_org ON public.billing_invoices(organization_id);
CREATE INDEX IF NOT EXISTS idx_billing_invoices_org_created ON public.billing_invoices(organization_id, created_at DESC);

-- RLS Policies for billing_invoices
DROP POLICY IF EXISTS "Org admins can view own invoices" ON public.billing_invoices;
CREATE POLICY "Org admins can view own invoices"
  ON public.billing_invoices FOR SELECT
  USING (
    public.is_org_admin(organization_id) OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS "Service role can manage invoices" ON public.billing_invoices;
CREATE POLICY "Service role can manage invoices"
  ON public.billing_invoices FOR ALL
  USING (auth.role() = 'service_role');

-- =============================================================================
-- ADD features column to plan_limits if not exists
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'plan_limits' AND column_name = 'features'
  ) THEN
    ALTER TABLE public.plan_limits ADD COLUMN features JSONB NOT NULL DEFAULT '[]'::jsonb;
  END IF;
END $$;

-- Update plan limits with features descriptions
UPDATE public.plan_limits SET features = '["Dashboard básico", "Gestión de procesos", "Alertas por correo", "Soporte por correo"]'::jsonb WHERE tier = 'FREE_TRIAL';
UPDATE public.plan_limits SET features = '["Todo en Prueba", "Importación de Excel", "Historial de auditoría", "Soporte prioritario"]'::jsonb WHERE tier = 'BASIC';
UPDATE public.plan_limits SET features = '["Todo en Básico", "Integraciones avanzadas", "API de acceso", "Reportes personalizados"]'::jsonb WHERE tier = 'PRO';
UPDATE public.plan_limits SET features = '["Todo en Pro", "Sin límites de uso", "Onboarding personalizado", "Gerente de cuenta dedicado"]'::jsonb WHERE tier = 'ENTERPRISE';

-- =============================================================================
-- ADD display_name and description to mrr_pricing_config if not exists
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'mrr_pricing_config' AND column_name = 'display_name'
  ) THEN
    ALTER TABLE public.mrr_pricing_config ADD COLUMN display_name TEXT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'mrr_pricing_config' AND column_name = 'description'
  ) THEN
    ALTER TABLE public.mrr_pricing_config ADD COLUMN description TEXT;
  END IF;
END $$;

-- Update pricing config with display names
UPDATE public.mrr_pricing_config SET display_name = 'Prueba Gratuita', description = '90 días de acceso completo sin costo' WHERE tier = 'FREE_TRIAL';
UPDATE public.mrr_pricing_config SET display_name = 'Básico', description = 'Ideal para profesionales independientes' WHERE tier = 'BASIC';
UPDATE public.mrr_pricing_config SET display_name = 'Profesional', description = 'Para firmas pequeñas y medianas' WHERE tier = 'PRO';
UPDATE public.mrr_pricing_config SET display_name = 'Empresarial', description = 'Para grandes firmas con necesidades avanzadas' WHERE tier = 'ENTERPRISE';

-- =============================================================================
-- Ensure RLS is enabled on pricing tables for public read
-- =============================================================================
ALTER TABLE public.mrr_pricing_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_limits ENABLE ROW LEVEL SECURITY;

-- Public can read pricing and limits
DROP POLICY IF EXISTS "Anyone can read pricing config" ON public.mrr_pricing_config;
CREATE POLICY "Anyone can read pricing config"
  ON public.mrr_pricing_config FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Anyone can read plan limits" ON public.plan_limits;
CREATE POLICY "Anyone can read plan limits"
  ON public.plan_limits FOR SELECT
  USING (true);