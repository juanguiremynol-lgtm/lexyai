
-- Table to track org admin grants for member support tab access
CREATE TABLE public.member_support_grants (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by UUID NOT NULL REFERENCES auth.users(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES auth.users(id),
  UNIQUE (organization_id, user_id)
);

-- Enable RLS
ALTER TABLE public.member_support_grants ENABLE ROW LEVEL SECURITY;

-- Org admins can manage grants for their org
CREATE POLICY "Org admins can manage support grants"
ON public.member_support_grants
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.organization_memberships om
    WHERE om.organization_id = member_support_grants.organization_id
      AND om.user_id = auth.uid()
      AND om.role IN ('OWNER', 'ADMIN')
  )
);

-- Members can read their own grant
CREATE POLICY "Members can read own support grant"
ON public.member_support_grants
FOR SELECT
USING (user_id = auth.uid());

-- Platform admins can read all
CREATE POLICY "Platform admins can read all support grants"
ON public.member_support_grants
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE user_id = auth.uid()
  )
);
