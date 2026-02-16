
-- ================================================
-- Deliverable B: Waitlist signups table
-- ================================================
CREATE TABLE public.waitlist_signups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  email TEXT NOT NULL,
  source_route TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  referrer TEXT,
  ip_hash TEXT,
  CONSTRAINT waitlist_signups_email_unique UNIQUE (email)
);

ALTER TABLE public.waitlist_signups ENABLE ROW LEVEL SECURITY;

-- Anon can insert (signup for waitlist)
CREATE POLICY "Anyone can join waitlist"
  ON public.waitlist_signups FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Only platform admins can read
CREATE POLICY "Platform admins can read waitlist"
  ON public.waitlist_signups FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.platform_admins
      WHERE user_id = auth.uid()
    )
  );

-- ================================================
-- Deliverable D: Auth provider settings
-- ================================================
CREATE TABLE public.auth_provider_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  required_secret_keys TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'disabled',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.auth_provider_settings ENABLE ROW LEVEL SECURITY;

-- Only platform admins can manage
CREATE POLICY "Platform admins manage auth providers"
  ON public.auth_provider_settings FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.platform_admins
      WHERE user_id = auth.uid()
    )
  );

-- Seed default providers
INSERT INTO public.auth_provider_settings (provider_key, display_name, enabled, required_secret_keys, status)
VALUES
  ('google', 'Google OAuth', true, '{}', 'configured'),
  ('email', 'Email / Contraseña', false, '{}', 'disabled'),
  ('facebook', 'Facebook', false, '{FACEBOOK_APP_ID,FACEBOOK_APP_SECRET}', 'disabled'),
  ('apple', 'Apple', false, '{APPLE_CLIENT_ID,APPLE_KEY_ID,APPLE_TEAM_ID}', 'disabled');

-- Trigger for updated_at
CREATE TRIGGER update_auth_provider_settings_updated_at
  BEFORE UPDATE ON public.auth_provider_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
