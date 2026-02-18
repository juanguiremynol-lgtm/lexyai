
-- Table to store platform admin alert email preferences
CREATE TABLE public.platform_admin_alert_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  primary_alert_email TEXT NOT NULL DEFAULT 'gr@lexetlit.com',
  secondary_alert_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE public.platform_admin_alert_config ENABLE ROW LEVEL SECURITY;

-- Only platform admins can read/write their own config
CREATE POLICY "Platform admins can view own alert config"
ON public.platform_admin_alert_config
FOR SELECT
USING (
  auth.uid() = user_id
  AND EXISTS (SELECT 1 FROM public.platform_admins WHERE platform_admins.user_id = auth.uid())
);

CREATE POLICY "Platform admins can insert own alert config"
ON public.platform_admin_alert_config
FOR INSERT
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (SELECT 1 FROM public.platform_admins WHERE platform_admins.user_id = auth.uid())
);

CREATE POLICY "Platform admins can update own alert config"
ON public.platform_admin_alert_config
FOR UPDATE
USING (
  auth.uid() = user_id
  AND EXISTS (SELECT 1 FROM public.platform_admins WHERE platform_admins.user_id = auth.uid())
);

-- Trigger for updated_at
CREATE TRIGGER update_platform_admin_alert_config_updated_at
BEFORE UPDATE ON public.platform_admin_alert_config
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
