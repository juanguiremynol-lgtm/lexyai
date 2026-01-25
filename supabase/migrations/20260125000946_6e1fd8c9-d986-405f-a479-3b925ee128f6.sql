-- ============================================================
-- AUDIT LOGS TABLE (IMMUTABLE, ORG-SCOPED)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_type text NOT NULL DEFAULT 'USER' CHECK (actor_type IN ('USER', 'SYSTEM')),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_created ON public.audit_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON public.audit_logs(entity_type, entity_id);

-- Enable RLS
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- RLS: Only org members can read their org's audit logs
CREATE POLICY "Org members can view audit logs"
  ON public.audit_logs FOR SELECT
  USING (is_org_member(organization_id));

-- RLS: Allow authenticated users to insert audit logs for their org
CREATE POLICY "Users can insert audit logs for their org"
  ON public.audit_logs FOR INSERT
  WITH CHECK (
    organization_id = get_user_organization_id() AND
    (actor_user_id IS NULL OR actor_user_id = auth.uid())
  );

-- RLS: No updates or deletes allowed (immutable audit)
-- (No UPDATE or DELETE policies = denied by default)

-- ============================================================
-- ORGANIZATION INVITES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.organization_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('ADMIN', 'MEMBER')),
  invited_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Unique pending invite per org+email
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_invites_unique_pending 
  ON public.organization_invites(organization_id, lower(email)) 
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_org_invites_token ON public.organization_invites(token_hash);
CREATE INDEX IF NOT EXISTS idx_org_invites_org ON public.organization_invites(organization_id, status);

-- Enable RLS
ALTER TABLE public.organization_invites ENABLE ROW LEVEL SECURITY;

-- RLS: Admins can view invites for their org
CREATE POLICY "Admins can view org invites"
  ON public.organization_invites FOR SELECT
  USING (is_org_admin(organization_id));

-- RLS: Admins can create invites for their org
CREATE POLICY "Admins can create invites"
  ON public.organization_invites FOR INSERT
  WITH CHECK (
    organization_id = get_user_organization_id() AND
    is_org_admin(organization_id) AND
    invited_by = auth.uid()
  );

-- RLS: Admins can update invites (revoke)
CREATE POLICY "Admins can update invites"
  ON public.organization_invites FOR UPDATE
  USING (is_org_admin(organization_id));

-- ============================================================
-- EMAIL SUPPRESSIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.email_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('BOUNCE', 'COMPLAINT', 'MANUAL')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, email)
);

CREATE INDEX IF NOT EXISTS idx_email_suppressions_lookup ON public.email_suppressions(organization_id, lower(email));

-- Enable RLS
ALTER TABLE public.email_suppressions ENABLE ROW LEVEL SECURITY;

-- RLS: Org admins can view suppressions
CREATE POLICY "Admins can view email suppressions"
  ON public.email_suppressions FOR SELECT
  USING (is_org_admin(organization_id));

-- RLS: Service role or admins can manage suppressions
CREATE POLICY "Admins can manage email suppressions"
  ON public.email_suppressions FOR ALL
  USING (is_org_admin(organization_id));

-- ============================================================
-- EMAIL OUTBOX - ADD RETRY/BACKOFF FIELDS
-- ============================================================
-- Add new columns if they don't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'email_outbox' AND column_name = 'attempts') THEN
    ALTER TABLE public.email_outbox ADD COLUMN attempts integer NOT NULL DEFAULT 0;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'email_outbox' AND column_name = 'next_attempt_at') THEN
    ALTER TABLE public.email_outbox ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'email_outbox' AND column_name = 'last_attempt_at') THEN
    ALTER TABLE public.email_outbox ADD COLUMN last_attempt_at timestamptz;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'email_outbox' AND column_name = 'provider_message_id') THEN
    ALTER TABLE public.email_outbox ADD COLUMN provider_message_id text;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'email_outbox' AND column_name = 'suppressed_reason') THEN
    ALTER TABLE public.email_outbox ADD COLUMN suppressed_reason text;
  END IF;
END $$;

-- Add SUPPRESSED and SENDING to status check if not already there
ALTER TABLE public.email_outbox DROP CONSTRAINT IF EXISTS email_outbox_status_check;
ALTER TABLE public.email_outbox ADD CONSTRAINT email_outbox_status_check 
  CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'FAILED', 'SUPPRESSED'));

-- Create index for outbox processing
CREATE INDEX IF NOT EXISTS idx_email_outbox_processing 
  ON public.email_outbox(status, next_attempt_at) 
  WHERE status IN ('PENDING', 'FAILED');

-- ============================================================
-- ADD deleted_at/deleted_by COLUMNS TO OTHER TABLES IF MISSING
-- ============================================================
DO $$ 
BEGIN
  -- clients table
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'clients' AND column_name = 'deleted_at') THEN
    ALTER TABLE public.clients ADD COLUMN deleted_at timestamptz;
    ALTER TABLE public.clients ADD COLUMN deleted_by uuid;
  END IF;
  
  -- hearings table
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'hearings' AND column_name = 'deleted_at') THEN
    ALTER TABLE public.hearings ADD COLUMN deleted_at timestamptz;
    ALTER TABLE public.hearings ADD COLUMN deleted_by uuid;
  END IF;
  
  -- tasks table
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'deleted_at') THEN
    ALTER TABLE public.tasks ADD COLUMN deleted_at timestamptz;
    ALTER TABLE public.tasks ADD COLUMN deleted_by uuid;
  END IF;
  
  -- alerts table
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'alerts' AND column_name = 'deleted_at') THEN
    ALTER TABLE public.alerts ADD COLUMN deleted_at timestamptz;
    ALTER TABLE public.alerts ADD COLUMN deleted_by uuid;
  END IF;
END $$;

-- ============================================================
-- UPDATE RLS FOR EMAIL_OUTBOX TO ALLOW SERVICE ROLE UPDATES
-- ============================================================
DROP POLICY IF EXISTS "Service role can update email_outbox" ON public.email_outbox;
CREATE POLICY "Service role can update email_outbox"
  ON public.email_outbox FOR UPDATE
  USING (true);

DROP POLICY IF EXISTS "Org members can view their email_outbox" ON public.email_outbox;
CREATE POLICY "Org members can view their email_outbox"
  ON public.email_outbox FOR SELECT
  USING (is_org_member(organization_id));