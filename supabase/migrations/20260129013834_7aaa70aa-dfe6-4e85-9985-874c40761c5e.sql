-- Auto-Sync Governance Tables
-- Per-user login sync tracking + Per-org daily sync ledger

-- =====================================================
-- Table 1: auto_sync_login_runs - Per-user login sync cap
-- =====================================================
CREATE TABLE public.auto_sync_login_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  run_date DATE NOT NULL, -- America/Bogota date
  run_count INT NOT NULL DEFAULT 0,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, organization_id, run_date)
);

-- Enable RLS
ALTER TABLE public.auto_sync_login_runs ENABLE ROW LEVEL SECURITY;

-- Policies: Users can read their own, service role can manage all
CREATE POLICY "Users can view own login sync runs"
  ON public.auto_sync_login_runs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage login sync runs"
  ON public.auto_sync_login_runs FOR ALL
  USING (true);

-- Index for fast lookup
CREATE INDEX idx_auto_sync_login_runs_lookup 
  ON public.auto_sync_login_runs(user_id, organization_id, run_date);

-- =====================================================
-- Table 2: auto_sync_daily_ledger - Per-org daily sync tracking
-- =====================================================
CREATE TYPE public.daily_sync_status AS ENUM (
  'PENDING',
  'RUNNING', 
  'SUCCESS',
  'PARTIAL',
  'FAILED'
);

CREATE TABLE public.auto_sync_daily_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  run_date DATE NOT NULL, -- America/Bogota date
  scheduled_for TIMESTAMPTZ NOT NULL, -- Expected run time (e.g., 07:00 COT)
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  status public.daily_sync_status NOT NULL DEFAULT 'PENDING',
  run_id TEXT, -- Correlation ID for logs
  items_targeted INT DEFAULT 0,
  items_succeeded INT DEFAULT 0,
  items_failed INT DEFAULT 0,
  retry_count INT DEFAULT 0,
  last_error TEXT,
  last_heartbeat_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, run_date)
);

-- Enable RLS
ALTER TABLE public.auto_sync_daily_ledger ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Org members can view their daily sync ledger"
  ON public.auto_sync_daily_ledger FOR SELECT
  USING (public.is_org_member(organization_id));

CREATE POLICY "Platform admins can view all ledger entries"
  ON public.auto_sync_daily_ledger FOR SELECT
  USING (public.is_platform_admin());

CREATE POLICY "Service role can manage daily ledger"
  ON public.auto_sync_daily_ledger FOR ALL
  USING (true);

-- Indexes for ledger queries
CREATE INDEX idx_auto_sync_daily_ledger_lookup 
  ON public.auto_sync_daily_ledger(organization_id, run_date);
CREATE INDEX idx_auto_sync_daily_ledger_status 
  ON public.auto_sync_daily_ledger(status, run_date);
CREATE INDEX idx_auto_sync_daily_ledger_retry 
  ON public.auto_sync_daily_ledger(status, retry_count, run_date) 
  WHERE status IN ('FAILED', 'PARTIAL');

-- =====================================================
-- Function: check_and_increment_login_sync
-- Atomic check + increment for login sync cap
-- Returns: { allowed: boolean, count: number, limit: number }
-- =====================================================
CREATE OR REPLACE FUNCTION public.check_and_increment_login_sync(
  p_user_id UUID,
  p_organization_id UUID,
  p_max_per_day INT DEFAULT 3
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today DATE;
  v_current_count INT;
  v_result JSONB;
BEGIN
  -- Get today in America/Bogota timezone
  v_today := (now() AT TIME ZONE 'America/Bogota')::DATE;
  
  -- Try to insert or update atomically
  INSERT INTO public.auto_sync_login_runs (user_id, organization_id, run_date, run_count, last_run_at)
  VALUES (p_user_id, p_organization_id, v_today, 0, NULL)
  ON CONFLICT (user_id, organization_id, run_date) DO NOTHING;
  
  -- Lock and get current count
  SELECT run_count INTO v_current_count
  FROM public.auto_sync_login_runs
  WHERE user_id = p_user_id 
    AND organization_id = p_organization_id 
    AND run_date = v_today
  FOR UPDATE;
  
  -- Check if limit reached
  IF v_current_count >= p_max_per_day THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'count', v_current_count,
      'limit', p_max_per_day,
      'message', 'Login sync limit reached for today'
    );
  END IF;
  
  -- Increment count
  UPDATE public.auto_sync_login_runs
  SET run_count = run_count + 1,
      last_run_at = now(),
      updated_at = now()
  WHERE user_id = p_user_id 
    AND organization_id = p_organization_id 
    AND run_date = v_today
  RETURNING run_count INTO v_current_count;
  
  RETURN jsonb_build_object(
    'allowed', true,
    'count', v_current_count,
    'limit', p_max_per_day,
    'remaining', p_max_per_day - v_current_count
  );
END;
$$;

-- =====================================================
-- Function: get_login_sync_status
-- Read-only check of current login sync count
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_login_sync_status(
  p_user_id UUID,
  p_organization_id UUID,
  p_max_per_day INT DEFAULT 3
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today DATE;
  v_current_count INT;
BEGIN
  v_today := (now() AT TIME ZONE 'America/Bogota')::DATE;
  
  SELECT COALESCE(run_count, 0) INTO v_current_count
  FROM public.auto_sync_login_runs
  WHERE user_id = p_user_id 
    AND organization_id = p_organization_id 
    AND run_date = v_today;
  
  IF v_current_count IS NULL THEN
    v_current_count := 0;
  END IF;
  
  RETURN jsonb_build_object(
    'count', v_current_count,
    'limit', p_max_per_day,
    'remaining', p_max_per_day - v_current_count,
    'can_sync', v_current_count < p_max_per_day
  );
END;
$$;

-- =====================================================
-- Function: acquire_daily_sync_lock
-- Idempotent per-org/day lock acquisition for daily sync
-- Returns: { acquired: boolean, ledger_id: uuid, status: text }
-- =====================================================
CREATE OR REPLACE FUNCTION public.acquire_daily_sync_lock(
  p_organization_id UUID,
  p_run_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today DATE;
  v_scheduled_for TIMESTAMPTZ;
  v_ledger_id UUID;
  v_current_status public.daily_sync_status;
BEGIN
  -- Get today in America/Bogota timezone
  v_today := (now() AT TIME ZONE 'America/Bogota')::DATE;
  -- 07:00 COT = 12:00 UTC
  v_scheduled_for := (v_today || ' 07:00:00')::TIMESTAMP AT TIME ZONE 'America/Bogota';
  
  -- Try to create ledger entry if not exists
  INSERT INTO public.auto_sync_daily_ledger (
    organization_id, run_date, scheduled_for, status, run_id
  )
  VALUES (
    p_organization_id, v_today, v_scheduled_for, 'PENDING', p_run_id
  )
  ON CONFLICT (organization_id, run_date) DO NOTHING;
  
  -- Lock and check current status
  SELECT id, status INTO v_ledger_id, v_current_status
  FROM public.auto_sync_daily_ledger
  WHERE organization_id = p_organization_id AND run_date = v_today
  FOR UPDATE;
  
  -- If already SUCCESS, don't run again
  IF v_current_status = 'SUCCESS' THEN
    RETURN jsonb_build_object(
      'acquired', false,
      'ledger_id', v_ledger_id,
      'status', v_current_status::TEXT,
      'reason', 'Already completed successfully today'
    );
  END IF;
  
  -- If RUNNING, check for stale lock (> 5 minutes without heartbeat)
  IF v_current_status = 'RUNNING' THEN
    IF EXISTS (
      SELECT 1 FROM public.auto_sync_daily_ledger
      WHERE id = v_ledger_id 
        AND last_heartbeat_at > now() - INTERVAL '5 minutes'
    ) THEN
      RETURN jsonb_build_object(
        'acquired', false,
        'ledger_id', v_ledger_id,
        'status', v_current_status::TEXT,
        'reason', 'Another run is in progress'
      );
    END IF;
    -- Stale lock, can take over
  END IF;
  
  -- Acquire lock by setting to RUNNING
  UPDATE public.auto_sync_daily_ledger
  SET status = 'RUNNING',
      started_at = COALESCE(started_at, now()),
      run_id = COALESCE(p_run_id, run_id, gen_random_uuid()::TEXT),
      last_heartbeat_at = now(),
      retry_count = retry_count + CASE WHEN v_current_status IN ('FAILED', 'PARTIAL') THEN 1 ELSE 0 END,
      updated_at = now()
  WHERE id = v_ledger_id
  RETURNING id, run_id INTO v_ledger_id;
  
  RETURN jsonb_build_object(
    'acquired', true,
    'ledger_id', v_ledger_id,
    'status', 'RUNNING',
    'previous_status', v_current_status::TEXT
  );
END;
$$;

-- =====================================================
-- Function: update_daily_sync_ledger
-- Update ledger with progress/completion
-- =====================================================
CREATE OR REPLACE FUNCTION public.update_daily_sync_ledger(
  p_ledger_id UUID,
  p_status public.daily_sync_status,
  p_items_targeted INT DEFAULT NULL,
  p_items_succeeded INT DEFAULT NULL,
  p_items_failed INT DEFAULT NULL,
  p_error TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.auto_sync_daily_ledger
  SET status = p_status,
      completed_at = CASE WHEN p_status IN ('SUCCESS', 'PARTIAL', 'FAILED') THEN now() ELSE completed_at END,
      items_targeted = COALESCE(p_items_targeted, items_targeted),
      items_succeeded = COALESCE(p_items_succeeded, items_succeeded),
      items_failed = COALESCE(p_items_failed, items_failed),
      last_error = COALESCE(p_error, last_error),
      last_heartbeat_at = now(),
      metadata = CASE WHEN p_metadata IS NOT NULL THEN metadata || p_metadata ELSE metadata END,
      updated_at = now()
  WHERE id = p_ledger_id;
END;
$$;

-- =====================================================
-- Function: get_pending_daily_syncs
-- Get orgs that need retry (for fallback job)
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_pending_daily_syncs(
  p_max_retries INT DEFAULT 5,
  p_cutoff_hour INT DEFAULT 20  -- 20:00 COT = 8 PM
)
RETURNS TABLE (
  organization_id UUID,
  ledger_id UUID,
  status public.daily_sync_status,
  retry_count INT,
  last_error TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today DATE;
  v_cutoff_time TIMESTAMPTZ;
BEGIN
  v_today := (now() AT TIME ZONE 'America/Bogota')::DATE;
  v_cutoff_time := (v_today || ' ' || p_cutoff_hour || ':00:00')::TIMESTAMP AT TIME ZONE 'America/Bogota';
  
  -- Only return pending syncs if before cutoff
  IF now() >= v_cutoff_time THEN
    RETURN;
  END IF;
  
  RETURN QUERY
  SELECT 
    l.organization_id,
    l.id AS ledger_id,
    l.status,
    l.retry_count,
    l.last_error
  FROM public.auto_sync_daily_ledger l
  WHERE l.run_date = v_today
    AND l.status IN ('PENDING', 'FAILED', 'PARTIAL')
    AND l.retry_count < p_max_retries
  ORDER BY l.retry_count ASC, l.updated_at ASC;
END;
$$;