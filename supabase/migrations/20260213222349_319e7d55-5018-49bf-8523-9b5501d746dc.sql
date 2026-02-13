
-- 1. Heartbeat dedup index (critical for performance)
CREATE INDEX IF NOT EXISTS idx_actions_heartbeat_latest
  ON atenia_ai_actions (organization_id, action_type, created_at DESC)
  WHERE action_type = 'heartbeat_observe';

-- 2. Planned actions index (already exists from earlier check, adding for safety)
CREATE INDEX IF NOT EXISTS idx_ai_actions_planned_created
  ON atenia_ai_actions (status, created_at DESC)
  WHERE status = 'PLANNED';

-- 3. Open conversations index for Operations Log
CREATE INDEX IF NOT EXISTS idx_conversations_org_open
  ON atenia_ai_conversations (organization_id, status, last_activity_at DESC)
  WHERE status = 'OPEN';
