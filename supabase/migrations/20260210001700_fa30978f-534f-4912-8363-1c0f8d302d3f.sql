
-- Add fields needed by B1 autonomous sync engine to atenia_ai_config
ALTER TABLE public.atenia_ai_config
  ADD COLUMN IF NOT EXISTS paused_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auto_sync_cooldown_minutes INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS last_auto_sync_at TIMESTAMPTZ;

-- Index on atenia_ai_actions for efficient lookups
CREATE INDEX IF NOT EXISTS idx_atenia_ai_actions_org_created
  ON public.atenia_ai_actions(organization_id, created_at DESC);
