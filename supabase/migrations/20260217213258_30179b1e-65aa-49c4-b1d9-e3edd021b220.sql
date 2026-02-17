
-- ═══════════════════════════════════════════════════════════════
-- Alert Email per Membership + Verification Token System
-- ═══════════════════════════════════════════════════════════════

-- 1. Add alert email columns to organization_memberships
ALTER TABLE public.organization_memberships
  ADD COLUMN IF NOT EXISTS alert_email TEXT,
  ADD COLUMN IF NOT EXISTS alert_email_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pending_alert_email TEXT,
  ADD COLUMN IF NOT EXISTS pending_alert_email_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS pending_alert_email_expires_at TIMESTAMPTZ;

-- 2. Extend email_verification_tokens for membership-level verification
ALTER TABLE public.email_verification_tokens
  ADD COLUMN IF NOT EXISTS subject_type TEXT NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS subject_id UUID,
  ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'generic_email_verification',
  ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ;

-- Drop the unique constraint on user_id if it exists (we need multiple tokens per user for different memberships)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_verification_tokens_user_id_key') THEN
    ALTER TABLE public.email_verification_tokens DROP CONSTRAINT email_verification_tokens_user_id_key;
  END IF;
END $$;

-- Add index for token lookups
CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_hash_purpose
  ON public.email_verification_tokens (token_hash, purpose)
  WHERE used_at IS NULL;

-- Add index for membership alert email lookups
CREATE INDEX IF NOT EXISTS idx_org_memberships_alert_email
  ON public.organization_memberships (organization_id, user_id)
  WHERE alert_email IS NOT NULL;

-- 3. Create a view/function to resolve the effective alert email for a membership
CREATE OR REPLACE FUNCTION public.get_effective_alert_email(
  p_membership_id UUID
)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    -- 1. Verified membership alert email
    CASE WHEN om.alert_email IS NOT NULL AND om.alert_email_verified_at IS NOT NULL
         THEN om.alert_email END,
    -- 2. Profile default_alert_email
    p.default_alert_email,
    -- 3. Profile reminder_email  
    p.reminder_email,
    -- 4. Profile/auth email
    p.email
  )
  FROM organization_memberships om
  JOIN profiles p ON p.id = om.user_id
  WHERE om.id = p_membership_id;
$$;
