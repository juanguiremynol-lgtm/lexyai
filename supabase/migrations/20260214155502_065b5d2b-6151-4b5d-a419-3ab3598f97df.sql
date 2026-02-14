
-- ============================================================
-- Support Access Grants: User-authorized temporary support access
-- Max 30 minutes, requires explicit user consent via Atenia AI
-- ============================================================

CREATE TABLE public.support_access_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The user granting access
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- The platform admin receiving access
  granted_to_admin_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Access details
  access_type TEXT NOT NULL DEFAULT 'REDACTED' CHECK (access_type IN ('REDACTED', 'DIRECT_VIEW')),
  scope TEXT NOT NULL DEFAULT 'SUPPORT' CHECK (scope IN ('SUPPORT', 'DEBUGGING')),
  -- Redaction level: what the admin can see
  redaction_level TEXT NOT NULL DEFAULT 'HIGH' CHECK (redaction_level IN ('HIGH', 'MEDIUM', 'LOW')),
  -- Reason/context
  reason TEXT,
  conversation_id UUID REFERENCES public.atenia_ai_conversations(id),
  -- Time bounds: max 30 minutes
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 minutes'),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES auth.users(id),
  -- Status
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXPIRED', 'REVOKED')),
  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enforce max 30-minute window via trigger (not CHECK, since it's time-based)
CREATE OR REPLACE FUNCTION public.enforce_support_grant_max_duration()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  -- Max duration: 30 minutes
  IF NEW.expires_at > NEW.granted_at + INTERVAL '30 minutes' THEN
    NEW.expires_at := NEW.granted_at + INTERVAL '30 minutes';
  END IF;
  -- Minimum duration: 5 minutes
  IF NEW.expires_at < NEW.granted_at + INTERVAL '5 minutes' THEN
    NEW.expires_at := NEW.granted_at + INTERVAL '5 minutes';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_support_grant_duration
BEFORE INSERT OR UPDATE ON public.support_access_grants
FOR EACH ROW
EXECUTE FUNCTION public.enforce_support_grant_max_duration();

-- Auto-expire grants
CREATE OR REPLACE FUNCTION public.auto_expire_support_grants()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  -- On any read/update, check if grant has expired
  IF NEW.status = 'ACTIVE' AND NEW.expires_at < now() THEN
    NEW.status := 'EXPIRED';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER auto_expire_support_grant
BEFORE UPDATE ON public.support_access_grants
FOR EACH ROW
EXECUTE FUNCTION public.auto_expire_support_grants();

-- RLS
ALTER TABLE public.support_access_grants ENABLE ROW LEVEL SECURITY;

-- Users can see and manage their own grants
CREATE POLICY "Users can view own support grants"
ON public.support_access_grants FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Users can insert grants for themselves (granting access)
CREATE POLICY "Users can create own support grants"
ON public.support_access_grants FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Users can revoke their own grants
CREATE POLICY "Users can revoke own support grants"
ON public.support_access_grants FOR UPDATE
TO authenticated
USING (user_id = auth.uid());

-- Platform admins can see grants given TO them (not all grants)
CREATE POLICY "Admins can see grants given to them"
ON public.support_access_grants FOR SELECT
TO authenticated
USING (granted_to_admin_id = auth.uid() AND public.is_platform_admin());

-- Index for fast lookups
CREATE INDEX idx_support_grants_user ON public.support_access_grants(user_id, status);
CREATE INDEX idx_support_grants_admin ON public.support_access_grants(granted_to_admin_id, status);
CREATE INDEX idx_support_grants_expires ON public.support_access_grants(expires_at) WHERE status = 'ACTIVE';

-- Helper function: check if admin has active grant for a user
CREATE OR REPLACE FUNCTION public.has_active_support_grant(p_admin_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.support_access_grants
    WHERE granted_to_admin_id = p_admin_id
      AND user_id = p_user_id
      AND status = 'ACTIVE'
      AND expires_at > now()
  );
$$;

-- Helper: check if admin has active grant for an org (any member granted)
CREATE OR REPLACE FUNCTION public.has_active_org_support_grant(p_admin_id UUID, p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.support_access_grants
    WHERE granted_to_admin_id = p_admin_id
      AND organization_id = p_org_id
      AND status = 'ACTIVE'
      AND expires_at > now()
  );
$$;
