
-- ============================================================================
-- 1. Add version identifier + unique constraint to billing_price_points
-- ============================================================================
ALTER TABLE public.billing_price_points
  ADD COLUMN IF NOT EXISTS version_number serial,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- Prevent overlapping effective windows for same plan+cycle+type
CREATE UNIQUE INDEX IF NOT EXISTS ux_price_points_active_unique
  ON public.billing_price_points (plan_id, billing_cycle_months, price_type)
  WHERE is_active = true AND valid_to IS NULL;

-- ============================================================================
-- 2. Enhance billing_price_schedules with missing columns
-- ============================================================================
ALTER TABLE public.billing_price_schedules
  ADD COLUMN IF NOT EXISTS billing_cycle_months integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS price_type text NOT NULL DEFAULT 'REGULAR',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'SCHEDULED',
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS applied_by uuid,
  ADD COLUMN IF NOT EXISTS reason text;

-- Add check constraint for status
ALTER TABLE public.billing_price_schedules
  DROP CONSTRAINT IF EXISTS ck_schedule_status;
ALTER TABLE public.billing_price_schedules
  ADD CONSTRAINT ck_schedule_status CHECK (status IN ('SCHEDULED', 'APPLIED', 'CANCELLED'));

-- ============================================================================
-- 3. Add pricing_fingerprint / amount_breakdown to checkout sessions
-- ============================================================================
ALTER TABLE public.billing_checkout_sessions
  ADD COLUMN IF NOT EXISTS amount_breakdown jsonb DEFAULT '{}'::jsonb;

-- ============================================================================
-- 4. Add missing columns to billing_invoices for price versioning
-- ============================================================================
ALTER TABLE public.billing_invoices
  ADD COLUMN IF NOT EXISTS price_point_id uuid REFERENCES public.billing_price_points(id),
  ADD COLUMN IF NOT EXISTS discount_code_id uuid REFERENCES public.billing_discount_codes(id),
  ADD COLUMN IF NOT EXISTS discount_amount_cop integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amount_cop_incl_iva integer;

-- ============================================================================
-- 5. Add ip_hash to billing_discount_redemptions for abuse analysis
-- ============================================================================
ALTER TABLE public.billing_discount_redemptions
  ADD COLUMN IF NOT EXISTS ip_hash text;

-- ============================================================================
-- 6. Add price_point_id to payment_transactions for historical reference
-- ============================================================================
ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS price_point_id uuid,
  ADD COLUMN IF NOT EXISTS amount_breakdown jsonb DEFAULT '{}'::jsonb;

-- ============================================================================
-- 7. Index for subscription_events queries
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_subscription_events_org_type
  ON public.subscription_events (organization_id, event_type, created_at DESC);

-- ============================================================================
-- 8. Index for payment_transactions idempotency
-- ============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_txn_gateway_idempotent
  ON public.payment_transactions (gateway, gateway_transaction_id)
  WHERE gateway_transaction_id IS NOT NULL;
