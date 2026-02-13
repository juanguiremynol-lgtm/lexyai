
-- ============================================================
-- CAPABILITY 1: Data Freshness SLAs
-- ============================================================

-- Add freshness tracking columns to work_items
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS freshness_tier text DEFAULT 'STANDARD';
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS freshness_sla_hours int DEFAULT 24;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS last_successful_sync_at timestamptz NULL;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS last_sync_attempt_at timestamptz NULL;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS sync_failure_streak int DEFAULT 0;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS freshness_violation_at timestamptz NULL;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS freshness_violation_notified boolean DEFAULT false;

-- Add constraint via trigger (not CHECK) for freshness_tier
CREATE OR REPLACE FUNCTION validate_freshness_tier() RETURNS trigger AS $$
BEGIN
  IF NEW.freshness_tier NOT IN ('CRITICAL', 'HIGH', 'STANDARD', 'LOW') THEN
    RAISE EXCEPTION 'Invalid freshness_tier: %', NEW.freshness_tier;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_validate_freshness_tier ON work_items;
CREATE TRIGGER trg_validate_freshness_tier BEFORE INSERT OR UPDATE OF freshness_tier ON work_items
  FOR EACH ROW EXECUTE FUNCTION validate_freshness_tier();

CREATE INDEX IF NOT EXISTS idx_work_items_freshness_violation
  ON work_items (organization_id, freshness_violation_at)
  WHERE freshness_violation_at IS NOT NULL AND monitoring_enabled = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_work_items_sync_priority
  ON work_items (organization_id, freshness_tier, last_successful_sync_at NULLS FIRST)
  WHERE monitoring_enabled = true AND deleted_at IS NULL;

-- Helper function for tier priority ordering
CREATE OR REPLACE FUNCTION freshness_tier_priority(tier text) RETURNS int AS $$
BEGIN
  RETURN CASE tier
    WHEN 'CRITICAL' THEN 1
    WHEN 'HIGH' THEN 2
    WHEN 'STANDARD' THEN 3
    WHEN 'LOW' THEN 4
    ELSE 3
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE SET search_path = public;

-- ============================================================
-- CAPABILITY 5: User Data Alerts
-- ============================================================

CREATE TABLE IF NOT EXISTS user_data_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid NOT NULL,
  work_item_id uuid NOT NULL REFERENCES work_items(id),
  alert_type text NOT NULL,
  message text NOT NULL,
  severity text NOT NULL DEFAULT 'INFO',
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  dismissed_at timestamptz NULL
);

ALTER TABLE user_data_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own data alerts" ON user_data_alerts
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own data alerts" ON user_data_alerts
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage all data alerts" ON user_data_alerts
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_user_data_alerts_unread
  ON user_data_alerts (user_id, is_read, created_at DESC)
  WHERE is_read = false;

CREATE INDEX IF NOT EXISTS idx_user_data_alerts_work_item
  ON user_data_alerts (work_item_id, alert_type);

-- ============================================================
-- CAPABILITY 6: Admin Daily Digests
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_daily_digests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  digest_date date NOT NULL UNIQUE,
  content_markdown text NOT NULL,
  summary_data jsonb DEFAULT '{}'::jsonb,
  platform_health text DEFAULT 'HEALTHY',
  total_orgs int DEFAULT 0,
  total_items_monitored int DEFAULT 0,
  freshness_sla_rate numeric(5,2) DEFAULT 0,
  critical_violations int DEFAULT 0,
  actions_executed_24h int DEFAULT 0,
  generated_at timestamptz DEFAULT now()
);

ALTER TABLE admin_daily_digests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins can view digests" ON admin_daily_digests
  FOR SELECT USING (public.is_platform_admin());

CREATE POLICY "Service role can manage digests" ON admin_daily_digests
  FOR ALL USING (true) WITH CHECK (true);
