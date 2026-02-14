
-- ══════════════════════════════════════════════════════════════════════
-- Replace ad-hoc CHECK constraints on atenia_ai_observations with ENUMs
-- ══════════════════════════════════════════════════════════════════════

-- Create ENUMs
CREATE TYPE public.observation_kind AS ENUM (
  'GATE_FAILURE', 'PROVIDER_DEGRADED', 'CRON_PARTIAL', 'CRON_FAILED',
  'GHOST_ITEMS', 'CLASSIFICATION_ANOMALY', 'STUCK_CONVERGENCE',
  'SYNC_TIMEOUT', 'DATA_QUALITY', 'HEARTBEAT_OBSERVED', 'HEARTBEAT_SKIPPED',
  'REMEDIATION_ATTEMPTED', 'PROVIDER_RECOVERED',
  'EGRESS_VIOLATION', 'SECURITY_ALERT',
  'PROVIDER_DEGRADED_WIRING', 'EXT_FAILURES', 'GHOST_ITEMS_WIRING'
);

CREATE TYPE public.observation_severity AS ENUM (
  'INFO', 'WARNING', 'CRITICAL'
);

-- Drop existing constraints
ALTER TABLE public.atenia_ai_observations
  DROP CONSTRAINT IF EXISTS atenia_ai_observations_kind_check;
ALTER TABLE public.atenia_ai_observations
  DROP CONSTRAINT IF EXISTS atenia_ai_observations_severity_check;

-- Drop existing defaults before type change
ALTER TABLE public.atenia_ai_observations ALTER COLUMN severity DROP DEFAULT;
ALTER TABLE public.atenia_ai_observations ALTER COLUMN kind DROP DEFAULT;

-- Convert columns to ENUMs
ALTER TABLE public.atenia_ai_observations
  ALTER COLUMN kind TYPE public.observation_kind
  USING kind::public.observation_kind;

ALTER TABLE public.atenia_ai_observations
  ALTER COLUMN severity TYPE public.observation_severity
  USING severity::public.observation_severity;

-- Restore default
ALTER TABLE public.atenia_ai_observations
  ALTER COLUMN severity SET DEFAULT 'INFO'::public.observation_severity;

-- RLS: restrict security observation kinds to platform admins only
DROP POLICY IF EXISTS "Org admin read observations" ON atenia_ai_observations;

CREATE POLICY "Org admin read observations" ON atenia_ai_observations
  FOR SELECT USING (
    organization_id = public.get_user_organization_id()
    AND kind NOT IN ('EGRESS_VIOLATION'::observation_kind, 'SECURITY_ALERT'::observation_kind)
  );

-- Retention index for security observations
CREATE INDEX IF NOT EXISTS idx_observations_security_kind
  ON atenia_ai_observations (kind, created_at DESC)
  WHERE kind IN ('EGRESS_VIOLATION'::observation_kind, 'SECURITY_ALERT'::observation_kind);
