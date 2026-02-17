
-- System email settings for super admin customization
CREATE TABLE public.system_email_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_email text NOT NULL DEFAULT 'info@andromeda.legal',
  from_name text NOT NULL DEFAULT 'ATENIA',
  reply_to text NULL,
  provider text NOT NULL DEFAULT 'resend',
  is_enabled boolean NOT NULL DEFAULT false,
  alert_subject_template text NOT NULL DEFAULT '{{alert_type}} — {{entity_name}}',
  alert_html_header text NULL,
  alert_html_footer text NULL,
  alert_logo_url text NULL,
  alert_accent_color text NOT NULL DEFAULT '#6366f1',
  alert_cta_text text NOT NULL DEFAULT 'Ver en Andromeda',
  alert_cta_url text NOT NULL DEFAULT 'https://lexyai.lovable.app',
  dns_spf_verified boolean NOT NULL DEFAULT false,
  dns_dkim_verified boolean NOT NULL DEFAULT false,
  dns_dmarc_verified boolean NOT NULL DEFAULT false,
  domain_verified_at timestamptz NULL,
  last_test_sent_at timestamptz NULL,
  last_test_result text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_system_email_settings_singleton ON public.system_email_settings ((true));

ALTER TABLE public.system_email_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins can read email settings"
  ON public.system_email_settings FOR SELECT
  USING (public.is_platform_admin());

CREATE POLICY "Platform admins can insert email settings"
  ON public.system_email_settings FOR INSERT
  WITH CHECK (public.is_platform_admin());

CREATE POLICY "Platform admins can update email settings"
  ON public.system_email_settings FOR UPDATE
  USING (public.is_platform_admin());

CREATE TRIGGER update_system_email_settings_updated_at
  BEFORE UPDATE ON public.system_email_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.system_email_settings (from_email, from_name, provider, is_enabled)
VALUES ('info@andromeda.legal', 'ATENIA', 'resend', false);
