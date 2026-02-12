
-- ============================================================================
-- Subscription Events (Immutable Audit Trail)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.subscription_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'CREATED', 'TRIAL_STARTED', 'TRIAL_ENDING_SOON', 'TRIAL_EXPIRED',
    'PAYMENT_RECEIVED', 'PAYMENT_VERIFIED', 'PAYMENT_FAILED', 'PAYMENT_REJECTED',
    'PLAN_ACTIVATED', 'PLAN_UPGRADED', 'PLAN_DOWNGRADED',
    'RENEWAL_SCHEDULED', 'RENEWAL_ATTEMPTED', 'RENEWAL_SUCCESS', 'RENEWAL_FAILED',
    'GRACE_PERIOD_STARTED', 'GRACE_PERIOD_EXPIRED',
    'SUSPENSION_APPLIED', 'SUSPENSION_LIFTED',
    'CANCELLATION_REQUESTED', 'CANCELLATION_SCHEDULED', 'CANCELLATION_EFFECTIVE',
    'CANCELLATION_REVERSED',
    'REFUND_REQUESTED', 'REFUND_PROCESSED',
    'DUNNING_ATTEMPT', 'DUNNING_EXHAUSTED',
    'CHARGEBACK_RECEIVED', 'CHARGEBACK_RESOLVED',
    'FRAUD_DETECTED', 'FRAUD_CLEARED',
    'ADMIN_OVERRIDE', 'ATENIA_AI_ACTION',
    'CHECKOUT_STARTED', 'CHECKOUT_COMPLETED'
  )),
  description text NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb,
  triggered_by text NOT NULL DEFAULT 'SYSTEM'
    CHECK (triggered_by IN ('SYSTEM', 'USER', 'ATENIA_AI', 'GATEWAY_WEBHOOK', 'ADMIN')),
  triggered_by_user_id uuid NULL,
  triggered_by_action_id uuid NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sub_events_org
  ON public.subscription_events (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sub_events_type
  ON public.subscription_events (event_type, created_at DESC);

ALTER TABLE public.subscription_events ENABLE ROW LEVEL SECURITY;

-- Platform admins can read all events
CREATE POLICY "Platform admins can read subscription events"
  ON public.subscription_events FOR SELECT
  USING (public.is_platform_admin());

-- Org members can read their own events
CREATE POLICY "Org members can read own subscription events"
  ON public.subscription_events FOR SELECT
  USING (public.is_org_member(organization_id));

-- Only service role can insert (edge functions)
CREATE POLICY "Service role can insert subscription events"
  ON public.subscription_events FOR INSERT
  WITH CHECK (true);

-- ============================================================================
-- Payment Transactions
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  checkout_session_id uuid REFERENCES public.billing_checkout_sessions(id),
  plan_code text NOT NULL,
  amount_cop int NOT NULL,
  currency text NOT NULL DEFAULT 'COP',
  billing_cycle_months int NOT NULL DEFAULT 1,
  transaction_type text NOT NULL DEFAULT 'SUBSCRIPTION'
    CHECK (transaction_type IN ('SUBSCRIPTION', 'RENEWAL', 'UPGRADE', 'DOWNGRADE_CREDIT', 'REFUND')),
  gateway text NOT NULL DEFAULT 'mock',
  gateway_transaction_id text NULL,
  gateway_reference text NULL,
  gateway_response jsonb DEFAULT '{}'::jsonb,
  gateway_status text NULL,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN (
      'PENDING', 'PROCESSING', 'VERIFIED', 'ACTIVATED', 'FAILED', 'REJECTED', 'REFUNDED', 'DISPUTED'
    )),
  verification_checks jsonb DEFAULT '{}'::jsonb,
  verified_at timestamptz NULL,
  verified_by_action_id uuid NULL,
  ip_address text NULL,
  initiated_by_user_id uuid NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_txn_org ON public.payment_transactions (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_txn_gateway ON public.payment_transactions (gateway, gateway_transaction_id);
CREATE INDEX IF NOT EXISTS idx_txn_status ON public.payment_transactions (status) WHERE status IN ('PENDING', 'PROCESSING');

ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins can read all transactions"
  ON public.payment_transactions FOR SELECT
  USING (public.is_platform_admin());

CREATE POLICY "Org members can read own transactions"
  ON public.payment_transactions FOR SELECT
  USING (public.is_org_member(organization_id));

CREATE POLICY "Service role can manage transactions"
  ON public.payment_transactions FOR ALL
  WITH CHECK (true);

-- ============================================================================
-- Dunning Schedule (placeholder for Phase 2)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.dunning_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  attempt_number int NOT NULL,
  scheduled_at timestamptz NOT NULL,
  executed_at timestamptz NULL,
  result text NULL CHECK (result IN ('SUCCESS', 'FAILED', 'SKIPPED')),
  gateway_response jsonb DEFAULT '{}'::jsonb,
  action_id uuid NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dunning_pending
  ON public.dunning_schedule (scheduled_at) WHERE executed_at IS NULL;

ALTER TABLE public.dunning_schedule ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins can manage dunning"
  ON public.dunning_schedule FOR ALL
  USING (public.is_platform_admin());

CREATE POLICY "Service role can manage dunning"
  ON public.dunning_schedule FOR ALL
  WITH CHECK (true);

-- ============================================================================
-- Extend billing_subscription_state with lifecycle fields
-- ============================================================================
ALTER TABLE public.billing_subscription_state
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS current_period_start timestamptz NULL,
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz NULL,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS cancellation_reason text NULL,
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS grace_period_end timestamptz NULL,
  ADD COLUMN IF NOT EXISTS next_billing_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS gateway_customer_id text NULL,
  ADD COLUMN IF NOT EXISTS gateway_subscription_id text NULL,
  ADD COLUMN IF NOT EXISTS last_payment_id uuid NULL,
  ADD COLUMN IF NOT EXISTS consecutive_payment_failures int DEFAULT 0;

-- ============================================================================
-- Add subscription lifecycle action types to autonomy policy
-- ============================================================================
UPDATE public.atenia_ai_autonomy_policy
SET allowed_actions = array_cat(
  COALESCE(allowed_actions, ARRAY[]::text[]),
  ARRAY['VERIFY_PAYMENT', 'ACTIVATE_PLAN', 'PROCESS_RENEWAL', 'EXECUTE_DUNNING',
        'ENFORCE_GRACE_PERIOD', 'SUSPEND_SUBSCRIPTION', 'PROCESS_CANCELLATION',
        'EXPIRE_TRIAL', 'DETECT_FRAUD']
)
WHERE NOT ('VERIFY_PAYMENT' = ANY(COALESCE(allowed_actions, ARRAY[]::text[])));

UPDATE public.atenia_ai_autonomy_policy
SET budgets = COALESCE(budgets, '{}'::jsonb) || '{
  "VERIFY_PAYMENT": {"max_per_hour": 50, "max_per_day": 200},
  "ACTIVATE_PLAN": {"max_per_hour": 50, "max_per_day": 200},
  "EXPIRE_TRIAL": {"max_per_hour": 20, "max_per_day": 100}
}'::jsonb;
