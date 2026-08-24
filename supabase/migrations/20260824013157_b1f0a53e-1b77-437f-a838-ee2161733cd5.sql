-- ============ Authority identity registry ============
CREATE TABLE public.authorities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  canonical_name text NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}',
  nit text,
  authority_kind text NOT NULL DEFAULT 'ENTIDAD_PUBLICA',
  is_system boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.authority_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id uuid NOT NULL REFERENCES public.authorities(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  domain text NOT NULL,
  verification_status text NOT NULL DEFAULT 'OBSERVED'
    CHECK (verification_status IN ('OBSERVED','VERIFIED','REJECTED')),
  verification_source text
    CHECK (verification_source IN ('CONFIRMED_LINK','USER_ACTION','OFFICIAL_SOURCE')),
  verified_at timestamptz,
  observed_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (authority_id, domain)
);

CREATE TABLE public.authority_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id uuid NOT NULL REFERENCES public.authorities(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  address_role text NOT NULL DEFAULT 'SENDING'
    CHECK (address_role IN ('SENDING','NOTIFICATION','CONTACT')),
  verification_status text NOT NULL DEFAULT 'OBSERVED'
    CHECK (verification_status IN ('OBSERVED','VERIFIED','REJECTED')),
  verification_source text
    CHECK (verification_source IN ('CONFIRMED_LINK','USER_ACTION','OFFICIAL_SOURCE')),
  observed_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (authority_id, email)
);

CREATE TABLE public.authority_domain_blocklist (
  domain text PRIMARY KEY,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.email_matching_thresholds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  workflow_type text NOT NULL,
  auto_link_floor numeric NOT NULL DEFAULT 0.90,
  suggest_floor numeric NOT NULL DEFAULT 0.35,
  ambiguity_margin numeric NOT NULL DEFAULT 0.10,
  weak_only_ceiling numeric NOT NULL DEFAULT 0.45,
  strong_only_ceiling numeric NOT NULL DEFAULT 0.85,
  requires_deterministic_for_auto_link boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, workflow_type)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.authorities TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.authority_domains TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.authority_addresses TO authenticated;
GRANT SELECT ON public.authority_domain_blocklist TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_matching_thresholds TO authenticated;
GRANT ALL ON public.authorities TO service_role;
GRANT ALL ON public.authority_domains TO service_role;
GRANT ALL ON public.authority_addresses TO service_role;
GRANT ALL ON public.authority_domain_blocklist TO service_role;
GRANT ALL ON public.email_matching_thresholds TO service_role;

ALTER TABLE public.authorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.authority_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.authority_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.authority_domain_blocklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_matching_thresholds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authorities_read" ON public.authorities FOR SELECT TO authenticated
  USING (organization_id IS NULL OR organization_id = public.get_user_organization_id());
CREATE POLICY "authorities_write_own_org" ON public.authorities FOR ALL TO authenticated
  USING (organization_id IS NOT NULL AND organization_id = public.get_user_organization_id())
  WITH CHECK (organization_id IS NOT NULL AND organization_id = public.get_user_organization_id());
CREATE POLICY "authorities_platform_admin" ON public.authorities FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

CREATE POLICY "authority_domains_read" ON public.authority_domains FOR SELECT TO authenticated
  USING (organization_id IS NULL OR organization_id = public.get_user_organization_id());
CREATE POLICY "authority_domains_write_own_org" ON public.authority_domains FOR ALL TO authenticated
  USING (organization_id IS NOT NULL AND organization_id = public.get_user_organization_id())
  WITH CHECK (organization_id IS NOT NULL AND organization_id = public.get_user_organization_id());
CREATE POLICY "authority_domains_platform_admin" ON public.authority_domains FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

CREATE POLICY "authority_addresses_read" ON public.authority_addresses FOR SELECT TO authenticated
  USING (organization_id IS NULL OR organization_id = public.get_user_organization_id());
CREATE POLICY "authority_addresses_write_own_org" ON public.authority_addresses FOR ALL TO authenticated
  USING (organization_id IS NOT NULL AND organization_id = public.get_user_organization_id())
  WITH CHECK (organization_id IS NOT NULL AND organization_id = public.get_user_organization_id());
CREATE POLICY "authority_addresses_platform_admin" ON public.authority_addresses FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

CREATE POLICY "blocklist_read" ON public.authority_domain_blocklist FOR SELECT TO authenticated USING (true);
CREATE POLICY "blocklist_platform_admin" ON public.authority_domain_blocklist FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

CREATE POLICY "thresholds_read" ON public.email_matching_thresholds FOR SELECT TO authenticated
  USING (organization_id IS NULL OR organization_id = public.get_user_organization_id());
CREATE POLICY "thresholds_write_own_org" ON public.email_matching_thresholds FOR ALL TO authenticated
  USING (organization_id IS NOT NULL AND organization_id = public.get_user_organization_id())
  WITH CHECK (organization_id IS NOT NULL AND organization_id = public.get_user_organization_id());
CREATE POLICY "thresholds_platform_admin" ON public.email_matching_thresholds FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

CREATE TRIGGER trg_authorities_updated_at BEFORE UPDATE ON public.authorities
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_authority_domains_updated_at BEFORE UPDATE ON public.authority_domains
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_authority_addresses_updated_at BEFORE UPDATE ON public.authority_addresses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_email_matching_thresholds_updated_at BEFORE UPDATE ON public.email_matching_thresholds
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Public / government-wide domains can never confer strong-signal status.
INSERT INTO public.authority_domain_blocklist (domain, reason) VALUES
  ('gmail.com','Dominio público'),
  ('hotmail.com','Dominio público'),
  ('outlook.com','Dominio público'),
  ('yahoo.com','Dominio público'),
  ('yahoo.es','Dominio público'),
  ('live.com','Dominio público'),
  ('icloud.com','Dominio público'),
  ('gov.co','Dominio gubernamental genérico'),
  ('edu.co','Dominio académico genérico'),
  ('com.co','Sufijo genérico')
ON CONFLICT DO NOTHING;

-- Per-workflow defaults (system rows).
INSERT INTO public.email_matching_thresholds
  (organization_id, workflow_type, auto_link_floor, suggest_floor, ambiguity_margin, weak_only_ceiling, strong_only_ceiling, requires_deterministic_for_auto_link)
VALUES
  (NULL,'PETICION',      0.90, 0.35, 0.10, 0.45, 0.85, true),
  (NULL,'GOV_PROCEDURE', 0.90, 0.35, 0.10, 0.45, 0.85, true),
  (NULL,'DEFAULT',       0.90, 0.35, 0.10, 0.45, 0.85, true);

-- ============ Link table extension (additive) ============
ALTER TABLE public.work_item_email_links
  ADD COLUMN IF NOT EXISTS signal_class text,
  ADD COLUMN IF NOT EXISTS candidate_rank integer,
  ADD COLUMN IF NOT EXISTS confidence_ceiling numeric,
  ADD COLUMN IF NOT EXISTS conflict_flag boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS match_outcome text;