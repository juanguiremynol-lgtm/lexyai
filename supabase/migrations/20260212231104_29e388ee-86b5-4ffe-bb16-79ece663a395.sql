
-- Operations Log: conversations, messages, observations, exports + additive column on actions

-- 1A. atenia_ai_conversations
CREATE TABLE IF NOT EXISTS atenia_ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'ORG' CHECK (scope IN ('PLATFORM', 'ORG')),
  organization_id uuid NULL,
  created_by_user_id uuid NULL,
  channel text NOT NULL DEFAULT 'SYSTEM'
    CHECK (channel IN ('USER_CHAT', 'ADMIN_PANEL', 'SYSTEM', 'HEARTBEAT', 'DAILY_SYNC', 'USER_REPORT')),
  status text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'RESOLVED', 'MUTED', 'ARCHIVED')),
  severity text DEFAULT 'INFO'
    CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  title text NOT NULL,
  summary text NULL,
  related_work_item_ids uuid[] DEFAULT '{}',
  related_providers text[] DEFAULT '{}',
  related_workflows text[] DEFAULT '{}',
  message_count int DEFAULT 0,
  observation_count int DEFAULT 0,
  action_count int DEFAULT 0,
  last_activity_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  resolved_at timestamptz NULL,
  resolved_by_user_id uuid NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_org_status
  ON atenia_ai_conversations (organization_id, status, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_severity
  ON atenia_ai_conversations (severity, status) WHERE status != 'ARCHIVED';
CREATE INDEX IF NOT EXISTS idx_conversations_channel
  ON atenia_ai_conversations (channel, created_at DESC);

-- 1B. atenia_ai_messages (reusing existing table name - check)
-- Note: there's already atenia_assistant_messages, this is different (operations log)
CREATE TABLE IF NOT EXISTS atenia_ai_op_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES atenia_ai_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'admin', 'gemini')),
  content_text text NOT NULL,
  content_structured jsonb DEFAULT '{}'::jsonb,
  related_work_item_ids uuid[] DEFAULT '{}',
  related_action_ids uuid[] DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  created_by_user_id uuid NULL
);

CREATE INDEX IF NOT EXISTS idx_op_messages_conversation
  ON atenia_ai_op_messages (conversation_id, created_at ASC);

-- 1C. atenia_ai_observations
CREATE TABLE IF NOT EXISTS atenia_ai_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NULL REFERENCES atenia_ai_conversations(id) ON DELETE SET NULL,
  organization_id uuid NULL,
  kind text NOT NULL CHECK (kind IN (
    'GATE_FAILURE', 'PROVIDER_DEGRADED', 'CRON_PARTIAL', 'CRON_FAILED',
    'GHOST_ITEMS', 'CLASSIFICATION_ANOMALY', 'STUCK_CONVERGENCE',
    'EXTERNAL_PROVIDER_ISSUE', 'MITIGATION_APPLIED', 'MITIGATION_EXPIRED',
    'BUDGET_EXHAUSTED', 'SCRAPING_JOB_EXHAUSTED'
  )),
  severity text NOT NULL DEFAULT 'INFO'
    CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  title text NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb,
  links jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_observations_conversation
  ON atenia_ai_observations (conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_observations_kind_severity
  ON atenia_ai_observations (kind, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_observations_org
  ON atenia_ai_observations (organization_id, created_at DESC);

-- 1D. atenia_ai_exports
CREATE TABLE IF NOT EXISTS atenia_ai_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES atenia_ai_conversations(id) ON DELETE CASCADE,
  format text NOT NULL CHECK (format IN ('MARKDOWN', 'JSON')),
  content text NOT NULL,
  token_estimate int DEFAULT 0,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exports_conversation
  ON atenia_ai_exports (conversation_id, created_at DESC);

-- 1E. Additive column on existing atenia_ai_actions
ALTER TABLE atenia_ai_actions ADD COLUMN IF NOT EXISTS conversation_id uuid NULL
  REFERENCES atenia_ai_conversations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ai_actions_conversation
  ON atenia_ai_actions (conversation_id, created_at ASC)
  WHERE conversation_id IS NOT NULL;

-- RLS
ALTER TABLE atenia_ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE atenia_ai_op_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE atenia_ai_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE atenia_ai_exports ENABLE ROW LEVEL SECURITY;

-- Platform admin full access via is_platform_admin() function
CREATE POLICY "Platform admin full access conversations" ON atenia_ai_conversations
  FOR ALL USING (public.is_platform_admin());

CREATE POLICY "Org member read conversations" ON atenia_ai_conversations
  FOR SELECT USING (
    organization_id = public.get_user_organization_id()
    AND public.is_org_admin(organization_id)
  );

CREATE POLICY "Platform admin full access messages" ON atenia_ai_op_messages
  FOR ALL USING (public.is_platform_admin());

CREATE POLICY "Org admin read messages" ON atenia_ai_op_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM atenia_ai_conversations c
      WHERE c.id = conversation_id
        AND c.organization_id = public.get_user_organization_id()
        AND public.is_org_admin(c.organization_id)
    )
  );

CREATE POLICY "Platform admin full access observations" ON atenia_ai_observations
  FOR ALL USING (public.is_platform_admin());

CREATE POLICY "Org admin read observations" ON atenia_ai_observations
  FOR SELECT USING (
    organization_id = public.get_user_organization_id()
    AND public.is_org_admin(organization_id)
  );

CREATE POLICY "Platform admin full access exports" ON atenia_ai_exports
  FOR ALL USING (public.is_platform_admin());
