
CREATE TABLE public.whatsapp_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 text NOT NULL UNIQUE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  display_name text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','blocked')),
  verification_code_hash text,
  verification_expires_at timestamptz,
  verified_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_whatsapp_identities_org ON public.whatsapp_identities(organization_id);
CREATE INDEX idx_whatsapp_identities_user ON public.whatsapp_identities(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_identities TO authenticated;
GRANT ALL ON public.whatsapp_identities TO service_role;
ALTER TABLE public.whatsapp_identities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wa_id_user_select" ON public.whatsapp_identities FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "wa_id_user_update" ON public.whatsapp_identities FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "wa_id_admin_all" ON public.whatsapp_identities FOR ALL TO authenticated
  USING (public.is_platform_admin() OR (organization_id IS NOT NULL AND public.is_org_admin(organization_id)))
  WITH CHECK (public.is_platform_admin() OR (organization_id IS NOT NULL AND public.is_org_admin(organization_id)));

CREATE TABLE public.whatsapp_link_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_phone_e164 text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_whatsapp_link_codes_user ON public.whatsapp_link_codes(user_id);
GRANT SELECT, INSERT, UPDATE ON public.whatsapp_link_codes TO authenticated;
GRANT ALL ON public.whatsapp_link_codes TO service_role;
ALTER TABLE public.whatsapp_link_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wa_link_own" ON public.whatsapp_link_codes FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.whatsapp_verification_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 text NOT NULL,
  email text,
  code_hash text,
  attempts int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_whatsapp_verify_phone ON public.whatsapp_verification_attempts(phone_e164);
GRANT SELECT ON public.whatsapp_verification_attempts TO authenticated;
GRANT ALL ON public.whatsapp_verification_attempts TO service_role;
ALTER TABLE public.whatsapp_verification_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wa_verify_admin" ON public.whatsapp_verification_attempts FOR SELECT TO authenticated USING (public.is_platform_admin());

CREATE TABLE public.whatsapp_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 text NOT NULL UNIQUE,
  identity_id uuid REFERENCES public.whatsapp_identities(id) ON DELETE SET NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'bot_active' CHECK (status IN ('bot_active','needs_human','human_active','closed')),
  current_flow text,
  selected_work_item_id uuid REFERENCES public.work_items(id) ON DELETE SET NULL,
  opted_out boolean NOT NULL DEFAULT false,
  last_inbound_at timestamptz,
  last_message_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_wa_conv_org ON public.whatsapp_conversations(organization_id);
CREATE INDEX idx_wa_conv_status ON public.whatsapp_conversations(status);
GRANT SELECT, INSERT, UPDATE ON public.whatsapp_conversations TO authenticated;
GRANT ALL ON public.whatsapp_conversations TO service_role;
ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wa_conv_admin_select" ON public.whatsapp_conversations FOR SELECT TO authenticated
  USING (public.is_platform_admin() OR (organization_id IS NOT NULL AND public.is_org_admin(organization_id)));
CREATE POLICY "wa_conv_admin_update" ON public.whatsapp_conversations FOR UPDATE TO authenticated
  USING (public.is_platform_admin() OR (organization_id IS NOT NULL AND public.is_org_admin(organization_id)));

CREATE TABLE public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  wa_message_id text UNIQUE,
  direction text NOT NULL CHECK (direction IN ('in','out')),
  body text,
  message_type text NOT NULL DEFAULT 'text',
  tool_calls_summary jsonb,
  status text NOT NULL DEFAULT 'received',
  error text,
  correlation_id uuid,
  sent_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_wa_msg_conv ON public.whatsapp_messages(conversation_id, created_at);
GRANT SELECT, INSERT ON public.whatsapp_messages TO authenticated;
GRANT ALL ON public.whatsapp_messages TO service_role;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wa_msg_admin_select" ON public.whatsapp_messages FOR SELECT TO authenticated
  USING (public.is_platform_admin() OR EXISTS (
    SELECT 1 FROM public.whatsapp_conversations c
    WHERE c.id = conversation_id AND c.organization_id IS NOT NULL
      AND public.is_org_admin(c.organization_id)
  ));

CREATE TABLE public.whatsapp_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 text NOT NULL,
  name text,
  firm text,
  city text,
  interest_summary text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','converted','discarded')),
  conversation_id uuid REFERENCES public.whatsapp_conversations(id) ON DELETE SET NULL,
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_wa_leads_status ON public.whatsapp_leads(status, created_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.whatsapp_leads TO authenticated;
GRANT ALL ON public.whatsapp_leads TO service_role;
ALTER TABLE public.whatsapp_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wa_leads_platform" ON public.whatsapp_leads FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

CREATE TABLE public.whatsapp_bot_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true UNIQUE,
  bot_enabled boolean NOT NULL DEFAULT true,
  business_hours jsonb NOT NULL DEFAULT '{"timezone":"America/Bogota","weekdays":[1,2,3,4,5],"start":"08:00","end":"18:00"}'::jsonb,
  admin_notification_email text,
  admin_whatsapp_numbers text[] NOT NULL DEFAULT ARRAY[]::text[],
  rate_limit_max int NOT NULL DEFAULT 20,
  rate_limit_window_minutes int NOT NULL DEFAULT 5,
  refresh_cooldown_minutes int NOT NULL DEFAULT 30,
  services_knowledge_base text NOT NULL DEFAULT 'Andrómeda Legal es una plataforma que monitorea automáticamente procesos judiciales colombianos (CGP, CPACA, laboral, penal, tutelas) y organiza actuaciones, estados y publicaciones procesales para abogados.',
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.whatsapp_bot_settings (singleton) VALUES (true);
GRANT SELECT ON public.whatsapp_bot_settings TO authenticated;
GRANT ALL ON public.whatsapp_bot_settings TO service_role;
ALTER TABLE public.whatsapp_bot_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wa_settings_read" ON public.whatsapp_bot_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "wa_settings_update" ON public.whatsapp_bot_settings FOR UPDATE TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

CREATE TABLE public.whatsapp_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 text,
  user_id uuid,
  organization_id uuid,
  tool_name text NOT NULL,
  work_item_id uuid,
  correlation_id uuid,
  input jsonb,
  result_summary text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_wa_audit_created ON public.whatsapp_audit_log(created_at DESC);
CREATE INDEX idx_wa_audit_org ON public.whatsapp_audit_log(organization_id, created_at DESC);
GRANT SELECT ON public.whatsapp_audit_log TO authenticated;
GRANT ALL ON public.whatsapp_audit_log TO service_role;
ALTER TABLE public.whatsapp_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wa_audit_admin" ON public.whatsapp_audit_log FOR SELECT TO authenticated
  USING (public.is_platform_admin() OR (organization_id IS NOT NULL AND public.is_org_admin(organization_id)));

CREATE TRIGGER trg_wa_identities_updated BEFORE UPDATE ON public.whatsapp_identities
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_wa_verify_updated BEFORE UPDATE ON public.whatsapp_verification_attempts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_wa_conv_updated BEFORE UPDATE ON public.whatsapp_conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_wa_leads_updated BEFORE UPDATE ON public.whatsapp_leads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_wa_settings_updated BEFORE UPDATE ON public.whatsapp_bot_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
