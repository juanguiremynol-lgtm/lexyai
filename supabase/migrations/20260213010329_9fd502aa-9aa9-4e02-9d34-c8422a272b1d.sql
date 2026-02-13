
-- Platform gateway configuration (encrypted secrets stored server-side, never exposed to frontend)
CREATE TABLE public.platform_gateway_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  gateway TEXT NOT NULL DEFAULT 'wompi',
  config_key TEXT NOT NULL,
  config_value TEXT NOT NULL,
  is_secret BOOLEAN NOT NULL DEFAULT false,
  environment TEXT NOT NULL DEFAULT 'sandbox',
  updated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(gateway, config_key, environment)
);

ALTER TABLE public.platform_gateway_config ENABLE ROW LEVEL SECURITY;

-- Only platform admins can read/write
CREATE POLICY "Platform admins manage gateway config"
  ON public.platform_gateway_config
  FOR ALL
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- Dunning escalation rules table
CREATE TABLE public.dunning_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  attempt_number INT NOT NULL,
  delay_hours INT NOT NULL DEFAULT 72,
  action_type TEXT NOT NULL DEFAULT 'RETRY_PAYMENT',
  notify_email BOOLEAN NOT NULL DEFAULT true,
  notify_in_app BOOLEAN NOT NULL DEFAULT true,
  escalation_action TEXT, -- e.g. 'SUSPEND', 'CANCEL'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.dunning_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins manage dunning rules"
  ON public.dunning_rules
  FOR ALL
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- Insert default dunning ladder
INSERT INTO public.dunning_rules (attempt_number, delay_hours, action_type, notify_email, escalation_action) VALUES
  (1, 24, 'RETRY_PAYMENT', true, NULL),
  (2, 72, 'RETRY_PAYMENT', true, NULL),
  (3, 168, 'RETRY_PAYMENT', true, 'SUSPEND'),
  (4, 336, 'FINAL_NOTICE', true, 'CANCEL');

-- Trigger for updated_at on platform_gateway_config
CREATE TRIGGER set_gateway_config_updated_at
  BEFORE UPDATE ON public.platform_gateway_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
