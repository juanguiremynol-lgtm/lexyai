
-- ============================================================================
-- Phase 2: Billing Admin Tables
-- ============================================================================

-- 1) Webhook receipts — immutable log of gateway callbacks
CREATE TABLE IF NOT EXISTS public.billing_webhook_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway TEXT NOT NULL DEFAULT 'wompi',
  gateway_event_id TEXT,
  gateway_transaction_id TEXT,
  event_type TEXT,
  signature_valid BOOLEAN,
  signature_raw TEXT,
  http_status_returned INT,
  latency_ms INT,
  retry_number INT DEFAULT 0,
  outcome TEXT DEFAULT 'PENDING',
  raw_payload JSONB NOT NULL DEFAULT '{}',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Idempotency: unique per gateway event
  CONSTRAINT uq_webhook_receipt_event UNIQUE (gateway, gateway_event_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_receipts_created ON public.billing_webhook_receipts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_receipts_gateway_txn ON public.billing_webhook_receipts (gateway_transaction_id);

ALTER TABLE public.billing_webhook_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins can view webhook receipts"
  ON public.billing_webhook_receipts FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

-- 2) Price schedules — future-effective price changes
CREATE TABLE IF NOT EXISTS public.billing_price_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES public.billing_plans(id),
  new_price_cop_incl_iva INT NOT NULL,
  billing_cycle_months INT NOT NULL DEFAULT 1,
  price_type TEXT NOT NULL DEFAULT 'REGULAR',
  effective_at TIMESTAMPTZ NOT NULL,
  scope TEXT NOT NULL DEFAULT 'NEW_ONLY' CHECK (scope IN ('NEW_ONLY', 'RENEWALS', 'ALL')),
  applied BOOLEAN NOT NULL DEFAULT false,
  applied_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_price_schedules_effective ON public.billing_price_schedules (effective_at) WHERE NOT applied;

ALTER TABLE public.billing_price_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins can manage price schedules"
  ON public.billing_price_schedules FOR ALL
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- 3) Discount codes
CREATE TABLE IF NOT EXISTS public.billing_discount_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('PERCENT', 'FIXED_COP')),
  discount_value INT NOT NULL,
  max_redemptions INT,
  current_redemptions INT NOT NULL DEFAULT 0,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to TIMESTAMPTZ,
  eligible_plans TEXT[] DEFAULT '{}',
  eligible_cycles INT[] DEFAULT '{}',
  target_org_id UUID REFERENCES public.organizations(id),
  target_user_email TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT
);

ALTER TABLE public.billing_discount_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins can manage discount codes"
  ON public.billing_discount_codes FOR ALL
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- 4) Discount redemptions — audit trail
CREATE TABLE IF NOT EXISTS public.billing_discount_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discount_code_id UUID NOT NULL REFERENCES public.billing_discount_codes(id),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  checkout_session_id UUID REFERENCES public.billing_checkout_sessions(id),
  user_id UUID REFERENCES auth.users(id),
  plan_code TEXT NOT NULL,
  billing_cycle_months INT NOT NULL DEFAULT 1,
  original_amount_cop INT NOT NULL,
  discount_amount_cop INT NOT NULL,
  final_amount_cop INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_discount_redemptions_org ON public.billing_discount_redemptions (organization_id);
CREATE INDEX IF NOT EXISTS idx_discount_redemptions_code ON public.billing_discount_redemptions (discount_code_id);

ALTER TABLE public.billing_discount_redemptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins can view redemptions"
  ON public.billing_discount_redemptions FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

CREATE POLICY "Org members can view own redemptions"
  ON public.billing_discount_redemptions FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

-- 5) Extend billing_checkout_sessions with discount fields (if not present)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'billing_checkout_sessions' AND column_name = 'discount_code_id'
  ) THEN
    ALTER TABLE public.billing_checkout_sessions ADD COLUMN discount_code_id UUID REFERENCES public.billing_discount_codes(id);
    ALTER TABLE public.billing_checkout_sessions ADD COLUMN discount_amount_cop INT DEFAULT 0;
  END IF;
END $$;

-- 6) Extend payment_transactions with discount fields (if not present)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payment_transactions' AND column_name = 'discount_code_id'
  ) THEN
    ALTER TABLE public.payment_transactions ADD COLUMN discount_code_id UUID;
    ALTER TABLE public.payment_transactions ADD COLUMN discount_amount_cop INT DEFAULT 0;
  END IF;
END $$;

-- 7) Extend billing_invoices with discount fields (if not present)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'billing_invoices' AND column_name = 'discount_code_id'
  ) THEN
    ALTER TABLE public.billing_invoices ADD COLUMN discount_code_id UUID;
    ALTER TABLE public.billing_invoices ADD COLUMN discount_amount_cop INT DEFAULT 0;
  END IF;
END $$;
