
-- ============================================================
-- SYSTEM EMAIL INFRASTRUCTURE — Setup Wizard Tables
-- ============================================================

-- 1) Extend system_email_settings with outbound_provider and inbound_mode
ALTER TABLE public.system_email_settings
  ADD COLUMN IF NOT EXISTS outbound_provider text NOT NULL DEFAULT 'resend',
  ADD COLUMN IF NOT EXISTS inbound_mode text NOT NULL DEFAULT 'none';

-- Add check constraint for inbound_mode
DO $$ BEGIN
  ALTER TABLE public.system_email_settings
    ADD CONSTRAINT system_email_settings_inbound_mode_check
    CHECK (inbound_mode IN ('none', 'resend_inbound', 'hostinger_imap'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2) system_email_setup_state — wizard progress tracking
CREATE TABLE IF NOT EXISTS public.system_email_setup_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  step_resend_key_ok boolean NOT NULL DEFAULT false,
  step_from_identity_ok boolean NOT NULL DEFAULT false,
  step_test_send_ok boolean NOT NULL DEFAULT false,
  step_inbound_selected boolean NOT NULL DEFAULT false,
  step_inbound_ok boolean NOT NULL DEFAULT false,
  last_error_code text,
  last_error_message text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.system_email_setup_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins manage setup state"
  ON public.system_email_setup_state FOR ALL
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- Insert singleton row
INSERT INTO public.system_email_setup_state (id)
VALUES ('00000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- 3) system_email_messages — unified message store
CREATE TABLE IF NOT EXISTS public.system_email_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direction text NOT NULL CHECK (direction IN ('outbound', 'inbound', 'draft')),
  folder text NOT NULL DEFAULT 'SENT' CHECK (folder IN ('INBOX', 'SENT', 'DRAFTS', 'TRASH')),
  provider text NOT NULL DEFAULT 'resend',
  provider_message_id text,
  provider_status text NOT NULL DEFAULT 'queued',
  from_raw text NOT NULL,
  to_raw jsonb NOT NULL DEFAULT '[]'::jsonb,
  cc_raw jsonb NOT NULL DEFAULT '[]'::jsonb,
  bcc_raw jsonb NOT NULL DEFAULT '[]'::jsonb,
  subject text,
  snippet text,
  text_body text,
  html_body text,
  sent_at timestamptz,
  received_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.system_email_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins manage email messages"
  ON public.system_email_messages FOR ALL
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- Index for folder queries
CREATE INDEX IF NOT EXISTS idx_system_email_messages_folder
  ON public.system_email_messages (folder, created_at DESC);

-- 4) system_email_events — webhook idempotency
CREATE TABLE IF NOT EXISTS public.system_email_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.system_email_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins read email events"
  ON public.system_email_events FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

-- Service role inserts from webhooks
CREATE POLICY "Service role inserts email events"
  ON public.system_email_events FOR INSERT
  TO service_role
  WITH CHECK (true);

-- 5) system_email_mailbox — IMAP credentials (Hostinger)
CREATE TABLE IF NOT EXISTS public.system_email_mailbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  imap_host text NOT NULL DEFAULT 'imap.hostinger.com',
  imap_port integer NOT NULL DEFAULT 993,
  imap_tls boolean NOT NULL DEFAULT true,
  username text NOT NULL DEFAULT 'info@andromeda.legal',
  password_secret_id uuid,
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.system_email_mailbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins manage mailbox"
  ON public.system_email_mailbox FOR ALL
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- Updated_at trigger for setup_state
CREATE OR REPLACE FUNCTION public.update_system_email_setup_state_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_system_email_setup_state_updated_at
  BEFORE UPDATE ON public.system_email_setup_state
  FOR EACH ROW EXECUTE FUNCTION public.update_system_email_setup_state_updated_at();

-- Updated_at trigger for messages
CREATE OR REPLACE FUNCTION public.update_system_email_messages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_system_email_messages_updated_at
  BEFORE UPDATE ON public.system_email_messages
  FOR EACH ROW EXECUTE FUNCTION public.update_system_email_messages_updated_at();
