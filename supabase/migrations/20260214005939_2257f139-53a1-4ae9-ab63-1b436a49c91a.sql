
-- Gemini call tracking table
CREATE TABLE public.gemini_call_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  caller_type TEXT NOT NULL CHECK (caller_type IN ('USER', 'ORG_ADMIN', 'SUPER_ADMIN', 'SYSTEM')),
  caller_user_id UUID,
  organization_id UUID REFERENCES public.organizations(id),
  function_name TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT 'google/gemini-2.5-flash',
  tokens_used INTEGER,
  duration_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'OK' CHECK (status IN ('OK', 'ERROR', 'RATE_LIMITED'))
);

-- Indexes for efficient querying
CREATE INDEX idx_gemini_call_log_created_at ON public.gemini_call_log(created_at DESC);
CREATE INDEX idx_gemini_call_log_caller_type ON public.gemini_call_log(caller_type);
CREATE INDEX idx_gemini_call_log_org ON public.gemini_call_log(organization_id);
CREATE INDEX idx_gemini_call_log_function ON public.gemini_call_log(function_name);

-- RLS - only platform admins can read
ALTER TABLE public.gemini_call_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins can read all gemini logs"
  ON public.gemini_call_log FOR SELECT
  USING (public.is_platform_admin());

CREATE POLICY "Service role can insert gemini logs"
  ON public.gemini_call_log FOR INSERT
  WITH CHECK (true);

-- Add Gemini governance columns to platform_settings
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS gemini_master_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS gemini_user_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS gemini_org_admin_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS gemini_super_admin_enabled BOOLEAN NOT NULL DEFAULT true;
