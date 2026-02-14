
-- Add email provider configuration columns to platform_settings
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS email_provider_type TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS email_provider_configured BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_provider_environment TEXT DEFAULT 'sandbox',
  ADD COLUMN IF NOT EXISTS email_provider_configured_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS email_provider_configured_by UUID DEFAULT NULL;

-- Create table for email provider secrets (like billing_gateway_config for Wompi)
CREATE TABLE IF NOT EXISTS public.email_provider_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key TEXT NOT NULL UNIQUE,
  config_value TEXT NOT NULL,
  is_secret BOOLEAN NOT NULL DEFAULT true,
  environment TEXT NOT NULL DEFAULT 'sandbox',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID DEFAULT NULL
);

ALTER TABLE public.email_provider_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins can view email provider config"
  ON public.email_provider_config FOR SELECT
  USING (public.is_platform_admin());

CREATE POLICY "Platform admins can insert email provider config"
  ON public.email_provider_config FOR INSERT
  WITH CHECK (public.is_platform_admin());

CREATE POLICY "Platform admins can update email provider config"
  ON public.email_provider_config FOR UPDATE
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

CREATE POLICY "Platform admins can delete email provider config"
  ON public.email_provider_config FOR DELETE
  USING (public.is_platform_admin());

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION public.update_email_provider_config_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_email_provider_config_timestamp
  BEFORE UPDATE ON public.email_provider_config
  FOR EACH ROW
  EXECUTE FUNCTION public.update_email_provider_config_updated_at();
