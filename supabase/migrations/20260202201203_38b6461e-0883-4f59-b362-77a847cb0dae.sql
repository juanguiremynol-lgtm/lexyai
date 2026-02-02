-- =============================================================================
-- Daily Welcome Message Controls: Kill Switch + Per-User Once-Per-Day Tracking
-- =============================================================================

-- 1. Add global kill switch to platform_settings
ALTER TABLE public.platform_settings 
ADD COLUMN IF NOT EXISTS daily_welcome_enabled BOOLEAN NOT NULL DEFAULT false;

-- NOTE: Default is FALSE (kill switch is OFF) for safer testing as requested

COMMENT ON COLUMN public.platform_settings.daily_welcome_enabled IS 
'Global kill switch for AI daily welcome messages. When false, Gemini is never called for welcome messages.';

-- 2. Add per-user tracking for last welcome message date
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS last_welcome_date DATE;

COMMENT ON COLUMN public.profiles.last_welcome_date IS 
'Date (in America/Bogota timezone) when the user last received an AI welcome message. Used to enforce once-per-day rule.';

-- 3. Create atomic function to check and update welcome date
-- This prevents race conditions when multiple login/session-init happen concurrently
CREATE OR REPLACE FUNCTION public.try_claim_daily_welcome(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today DATE;
  v_current_date DATE;
  v_result JSONB;
BEGIN
  -- Get today in America/Bogota timezone
  v_today := (NOW() AT TIME ZONE 'America/Bogota')::DATE;
  
  -- Lock the profile row and get current last_welcome_date
  SELECT last_welcome_date INTO v_current_date
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;
  
  -- If user doesn't exist, return error
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason', 'USER_NOT_FOUND',
      'today', v_today
    );
  END IF;
  
  -- If already sent today, reject
  IF v_current_date IS NOT NULL AND v_current_date = v_today THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason', 'ALREADY_SENT_TODAY',
      'last_welcome_date', v_current_date,
      'today', v_today
    );
  END IF;
  
  -- Claim: Update the date atomically
  UPDATE public.profiles
  SET last_welcome_date = v_today
  WHERE id = p_user_id;
  
  RETURN jsonb_build_object(
    'claimed', true,
    'reason', 'CLAIMED',
    'previous_date', v_current_date,
    'today', v_today
  );
END;
$$;

-- 4. Create table for welcome message audit log (optional but requested)
CREATE TABLE IF NOT EXISTS public.daily_welcome_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL, -- 'GENERATED', 'SUPPRESSED_ALREADY_SENT', 'SUPPRESSED_KILL_SWITCH', 'SUPPRESSED_NON_BUSINESS_DAY'
  event_date DATE NOT NULL, -- The date (America/Bogota) this event corresponds to
  ai_model_used TEXT, -- e.g. 'google/gemini-3-flash-preview' or null if suppressed
  activity_count INTEGER, -- Total estados + actuaciones at time of generation
  latency_ms INTEGER, -- AI generation time
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for querying by user and date
CREATE INDEX IF NOT EXISTS idx_daily_welcome_log_user_date 
ON public.daily_welcome_log(user_id, event_date DESC);

-- Index for analytics queries
CREATE INDEX IF NOT EXISTS idx_daily_welcome_log_event_type 
ON public.daily_welcome_log(event_type, created_at DESC);

-- Enable RLS
ALTER TABLE public.daily_welcome_log ENABLE ROW LEVEL SECURITY;

-- Platform admins can view all logs
CREATE POLICY "Platform admins can view all welcome logs"
ON public.daily_welcome_log
FOR SELECT
TO authenticated
USING (public.is_platform_admin());

-- Service role can insert (edge functions)
-- Note: No policy needed for service_role as it bypasses RLS

COMMENT ON TABLE public.daily_welcome_log IS 
'Audit trail for daily welcome message generation/suppression events. Used for observability and cost tracking.';