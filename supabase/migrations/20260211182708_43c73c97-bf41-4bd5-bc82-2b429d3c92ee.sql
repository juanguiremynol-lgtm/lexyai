
-- Table for wizard sessions (enforces wizard-only provider configuration)
CREATE TABLE IF NOT EXISTS public.provider_wizard_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '2 hours'),
  mode TEXT NOT NULL CHECK (mode IN ('PLATFORM', 'ORG')),
  organization_id UUID REFERENCES public.organizations(id),
  created_by UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED', 'EXPIRED'))
);

ALTER TABLE public.provider_wizard_sessions ENABLE ROW LEVEL SECURITY;

-- Only service_role can write wizard sessions (edge functions)
CREATE POLICY "service_role_full_access_wizard_sessions"
  ON public.provider_wizard_sessions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Platform admins can read all
CREATE POLICY "platform_admins_read_wizard_sessions"
  ON public.provider_wizard_sessions
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

-- Org members can read their org sessions
CREATE POLICY "org_members_read_own_wizard_sessions"
  ON public.provider_wizard_sessions
  FOR SELECT
  TO authenticated
  USING (organization_id IS NOT NULL AND public.is_org_member(organization_id));
