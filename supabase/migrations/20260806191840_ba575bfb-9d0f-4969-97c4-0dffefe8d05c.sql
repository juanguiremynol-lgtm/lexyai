ALTER TABLE public.user_email_connections
  ADD COLUMN IF NOT EXISTS failure_code TEXT,
  ADD COLUMN IF NOT EXISTS failure_detail TEXT,
  ADD COLUMN IF NOT EXISTS admin_consent_url TEXT,
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_refresh_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pkce_verifier_cipher BYTEA,
  ADD COLUMN IF NOT EXISTS pkce_verifier_nonce BYTEA,
  ADD COLUMN IF NOT EXISTS pending_scopes TEXT[];

COMMENT ON COLUMN public.user_email_connections.failure_code IS
  'Classified Microsoft failure: ADMIN_CONSENT_REQUIRED | CONDITIONAL_ACCESS | MFA_REQUIRED | CONSENT_REVOKED | PASSWORD_CHANGED | TOKEN_EXPIRED | USER_DECLINED | UNKNOWN';

-- One connection per user PER ORGANISATION (was: one per user platform-wide).
ALTER TABLE public.user_email_connections
  DROP CONSTRAINT IF EXISTS user_email_connections_unique_provider;

CREATE UNIQUE INDEX IF NOT EXISTS user_email_connections_user_org_provider_uq
  ON public.user_email_connections (user_id, organization_id, provider)
  NULLS NOT DISTINCT;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_email_connections TO authenticated;
GRANT ALL ON public.user_email_connections TO service_role;
