-- =============================================
-- Platform Email Governance Controls
-- =============================================

-- 1) Platform Settings table for global controls (singleton pattern)
CREATE TABLE IF NOT EXISTS public.platform_settings (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  email_paused_at TIMESTAMPTZ,
  email_paused_by UUID,
  email_pause_reason TEXT,
  max_emails_per_org_per_hour INTEGER DEFAULT 500,
  max_emails_per_org_per_day INTEGER DEFAULT 5000,
  max_global_emails_per_minute INTEGER DEFAULT 100,
  max_retry_attempts INTEGER DEFAULT 5,
  spike_detection_enabled BOOLEAN DEFAULT true,
  spike_threshold_multiplier NUMERIC(3,1) DEFAULT 2.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Insert default singleton row if not exists
INSERT INTO public.platform_settings (id)
VALUES ('singleton')
ON CONFLICT (id) DO NOTHING;

-- Enable RLS (platform admin only)
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

-- Only platform admins can view/update settings
CREATE POLICY "Platform admins can view settings"
  ON public.platform_settings FOR SELECT
  USING (public.is_platform_admin());

CREATE POLICY "Platform admins can update settings"
  ON public.platform_settings FOR UPDATE
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- 2) Add email suspension columns to organizations (if not exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' 
    AND table_name = 'organizations' 
    AND column_name = 'email_suspended'
  ) THEN
    ALTER TABLE public.organizations 
    ADD COLUMN email_suspended BOOLEAN NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' 
    AND table_name = 'organizations' 
    AND column_name = 'email_suspend_reason'
  ) THEN
    ALTER TABLE public.organizations 
    ADD COLUMN email_suspend_reason TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' 
    AND table_name = 'organizations' 
    AND column_name = 'email_suspended_at'
  ) THEN
    ALTER TABLE public.organizations 
    ADD COLUMN email_suspended_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' 
    AND table_name = 'organizations' 
    AND column_name = 'email_suspended_by'
  ) THEN
    ALTER TABLE public.organizations 
    ADD COLUMN email_suspended_by UUID;
  END IF;
END $$;

-- 3) Platform email actions audit table
CREATE TABLE IF NOT EXISTS public.platform_email_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type TEXT NOT NULL, -- GLOBAL_PAUSE, GLOBAL_RESUME, ORG_SUSPEND, ORG_UNSUSPEND, FORCE_STOP_RETRIES, REQUEUE
  target_org_id UUID REFERENCES public.organizations(id),
  target_email_outbox_id UUID,
  actor_user_id UUID NOT NULL,
  reason TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS for platform email actions
ALTER TABLE public.platform_email_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins can view email actions"
  ON public.platform_email_actions FOR SELECT
  USING (public.is_platform_admin());

CREATE POLICY "Platform admins can insert email actions"
  ON public.platform_email_actions FOR INSERT
  WITH CHECK (public.is_platform_admin());

-- 4) Index for efficient queries on email_outbox
CREATE INDEX IF NOT EXISTS idx_email_outbox_status_org 
  ON public.email_outbox(organization_id, status);

CREATE INDEX IF NOT EXISTS idx_email_outbox_created_at 
  ON public.email_outbox(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_outbox_failed_permanent 
  ON public.email_outbox(failed_permanent) 
  WHERE failed_permanent = true;

-- 5) Platform admin can read all email_outbox entries (add policy if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'email_outbox' 
    AND policyname = 'Platform admins can view all emails'
  ) THEN
    CREATE POLICY "Platform admins can view all emails"
      ON public.email_outbox FOR SELECT
      USING (public.is_platform_admin());
  END IF;
END $$;

-- Platform admin can update email_outbox (for force stop retries)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'email_outbox' 
    AND policyname = 'Platform admins can update emails'
  ) THEN
    CREATE POLICY "Platform admins can update emails"
      ON public.email_outbox FOR UPDATE
      USING (public.is_platform_admin())
      WITH CHECK (public.is_platform_admin());
  END IF;
END $$;

-- 6) Update trigger for platform_settings
CREATE OR REPLACE FUNCTION public.update_platform_settings_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_platform_settings_timestamp ON public.platform_settings;
CREATE TRIGGER update_platform_settings_timestamp
  BEFORE UPDATE ON public.platform_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_platform_settings_updated_at();