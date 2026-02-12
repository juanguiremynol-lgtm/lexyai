
-- ============================================================
-- Atenia AI Autonomy Policy (platform singleton)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.atenia_ai_autonomy_policy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  is_enabled boolean DEFAULT false,
  allowed_actions text[] DEFAULT ARRAY[
    'RETRY_ENQUEUE',
    'MARK_STUCK',
    'SUSPEND_MONITORING',
    'DAILY_CONTINUATION',
    'TRIGGER_CORRECTIVE_SYNC',
    'SPLIT_HEAVY_SYNC'
  ],
  require_confirmation_actions text[] DEFAULT ARRAY[
    'DEMOTE_PROVIDER_ROUTE',
    'REACTIVATE_MONITORING_BATCH',
    'ESCALATE_TO_LLM'
  ],
  budgets jsonb DEFAULT '{
    "RETRY_ENQUEUE": { "max_per_hour": 10, "max_per_day": 30 },
    "MARK_STUCK": { "max_per_hour": 20, "max_per_day": 50 },
    "SUSPEND_MONITORING": { "max_per_hour": 5, "max_per_day": 15 },
    "DAILY_CONTINUATION": { "max_per_hour": 3, "max_per_day": 6 },
    "TRIGGER_CORRECTIVE_SYNC": { "max_per_hour": 5, "max_per_day": 15 },
    "DEMOTE_PROVIDER_ROUTE": { "max_per_hour": 2, "max_per_day": 4 },
    "SPLIT_HEAVY_SYNC": { "max_per_hour": 5, "max_per_day": 10 },
    "REACTIVATE_MONITORING_BATCH": { "max_per_hour": 1, "max_per_day": 3 },
    "ESCALATE_TO_LLM": { "max_per_hour": 2, "max_per_day": 5 }
  }'::jsonb,
  cooldowns jsonb DEFAULT '{
    "RETRY_ENQUEUE": 30,
    "MARK_STUCK": 60,
    "SUSPEND_MONITORING": 1440,
    "DAILY_CONTINUATION": 15,
    "TRIGGER_CORRECTIVE_SYNC": 60,
    "DEMOTE_PROVIDER_ROUTE": 120,
    "SPLIT_HEAVY_SYNC": 60,
    "REACTIVATE_MONITORING_BATCH": 1440,
    "ESCALATE_TO_LLM": 120
  }'::jsonb,
  notify_on_critical boolean DEFAULT true,
  notification_email text NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_autonomy_policy_singleton
  ON public.atenia_ai_autonomy_policy ((true));

INSERT INTO public.atenia_ai_autonomy_policy (is_enabled)
SELECT false
WHERE NOT EXISTS (SELECT 1 FROM public.atenia_ai_autonomy_policy);

ALTER TABLE public.atenia_ai_autonomy_policy ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read autonomy policy"
  ON public.atenia_ai_autonomy_policy FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Platform admins can manage autonomy policy"
  ON public.atenia_ai_autonomy_policy FOR ALL
  TO authenticated USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- ============================================================
-- Provider Route Mitigations
-- ============================================================
CREATE TABLE IF NOT EXISTS public.provider_route_mitigations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  mitigation_type text NOT NULL CHECK (mitigation_type IN ('DEMOTE_TO_FALLBACK', 'REDUCE_CONCURRENCY', 'INCREASE_TIMEOUT', 'DISABLE_TEMPORARILY')),
  scope text DEFAULT 'ALL',
  severity text DEFAULT 'WARNING' CHECK (severity IN ('WARNING', 'CRITICAL')),
  reason text NOT NULL,
  applied_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL,
  expired boolean DEFAULT false,
  created_by_action_id uuid NULL,
  organization_id uuid NULL REFERENCES public.organizations(id)
);

CREATE INDEX IF NOT EXISTS idx_mitigations_active
  ON public.provider_route_mitigations (provider, expired) WHERE expired = false;

ALTER TABLE public.provider_route_mitigations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read mitigations"
  ON public.provider_route_mitigations FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Service role manages mitigations"
  ON public.provider_route_mitigations FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- Work Item Scrape Jobs (CPNU deferred polling)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.work_item_scrape_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'CPNU',
  job_id text NOT NULL,
  radicado text NOT NULL,
  created_at timestamptz DEFAULT now(),
  next_poll_at timestamptz NOT NULL,
  poll_attempts int DEFAULT 0,
  max_poll_attempts int DEFAULT 6,
  status text DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUCCEEDED', 'EXHAUSTED', 'CANCELLED')),
  last_poll_result jsonb DEFAULT '{}'::jsonb,
  resolved_by_action_id uuid NULL
);

CREATE INDEX IF NOT EXISTS idx_scrape_jobs_pending
  ON public.work_item_scrape_jobs (next_poll_at) WHERE status = 'PENDING';

ALTER TABLE public.work_item_scrape_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read scrape jobs for their org"
  ON public.work_item_scrape_jobs FOR SELECT
  TO authenticated USING (organization_id = public.get_user_org_id());

CREATE POLICY "Service role manages scrape jobs"
  ON public.work_item_scrape_jobs FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- Convergence columns on work_items (idempotent)
-- ============================================================
ALTER TABLE public.work_items ADD COLUMN IF NOT EXISTS consecutive_not_found int DEFAULT 0;
ALTER TABLE public.work_items ADD COLUMN IF NOT EXISTS last_successful_sync_at timestamptz NULL;
ALTER TABLE public.work_items ADD COLUMN IF NOT EXISTS last_attempted_sync_at timestamptz NULL;
ALTER TABLE public.work_items ADD COLUMN IF NOT EXISTS last_error_code text NULL;
ALTER TABLE public.work_items ADD COLUMN IF NOT EXISTS last_error_meta jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.work_items ADD COLUMN IF NOT EXISTS monitoring_suspended_at timestamptz NULL;
ALTER TABLE public.work_items ADD COLUMN IF NOT EXISTS monitoring_suspended_reason text NULL;

-- ============================================================
-- Additional columns on atenia_ai_actions (idempotent)
-- ============================================================
ALTER TABLE public.atenia_ai_actions ADD COLUMN IF NOT EXISTS scope text DEFAULT 'ORG';
ALTER TABLE public.atenia_ai_actions ADD COLUMN IF NOT EXISTS provider text NULL;
ALTER TABLE public.atenia_ai_actions ADD COLUMN IF NOT EXISTS workflow_type text NULL;
ALTER TABLE public.atenia_ai_actions ADD COLUMN IF NOT EXISTS input_snapshot jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.atenia_ai_actions ADD COLUMN IF NOT EXISTS status text DEFAULT 'EXECUTED';
ALTER TABLE public.atenia_ai_actions ADD COLUMN IF NOT EXISTS reversible boolean DEFAULT true;
ALTER TABLE public.atenia_ai_actions ADD COLUMN IF NOT EXISTS revert_action_id uuid NULL;

CREATE INDEX IF NOT EXISTS idx_ai_actions_type_status
  ON public.atenia_ai_actions (action_type, status);
CREATE INDEX IF NOT EXISTS idx_ai_actions_target
  ON public.atenia_ai_actions (work_item_id, action_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_actions_planned
  ON public.atenia_ai_actions (status) WHERE status = 'PLANNED';

-- ============================================================
-- Continuation columns on auto_sync_daily_ledger (idempotent)
-- ============================================================
ALTER TABLE public.auto_sync_daily_ledger ADD COLUMN IF NOT EXISTS is_continuation boolean DEFAULT false;
ALTER TABLE public.auto_sync_daily_ledger ADD COLUMN IF NOT EXISTS continuation_of uuid NULL;
