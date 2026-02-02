-- ============================================================
-- DATA INTEGRITY ARCHITECTURE: Append-Only Sync with Protection
-- ============================================================

-- ============= 1A: SOFT DELETE COLUMNS =============

-- Add soft-delete columns to work_item_acts
ALTER TABLE work_item_acts 
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS archived_reason TEXT DEFAULT NULL;

-- Add soft-delete columns to work_item_publicaciones
ALTER TABLE work_item_publicaciones 
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS archived_reason TEXT DEFAULT NULL;

-- Add canonical columns to work_item_acts
ALTER TABLE work_item_acts 
  ADD COLUMN IF NOT EXISTS is_canonical BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS canonical_at TIMESTAMPTZ DEFAULT NULL;

-- Add canonical columns to work_item_publicaciones
ALTER TABLE work_item_publicaciones 
  ADD COLUMN IF NOT EXISTS is_canonical BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS canonical_at TIMESTAMPTZ DEFAULT NULL;

-- Create indexes for archived queries
CREATE INDEX IF NOT EXISTS idx_work_item_acts_archived ON work_item_acts (is_archived) WHERE is_archived = true;
CREATE INDEX IF NOT EXISTS idx_work_item_publicaciones_archived ON work_item_publicaciones (is_archived) WHERE is_archived = true;

-- ============= 1B: DELETE PREVENTION TRIGGERS =============

-- Prevent DELETE on work_item_acts
CREATE OR REPLACE FUNCTION prevent_delete_work_item_acts()
RETURNS TRIGGER AS $$
BEGIN
  -- Allow deletion only if called from the admin archive function
  IF current_setting('app.allow_delete', true) = 'true' THEN
    RETURN OLD;
  END IF;
  
  RAISE EXCEPTION 'DELETE not allowed on work_item_acts. Use the archive function instead. Record id: %', OLD.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS protect_work_item_acts_delete ON work_item_acts;
CREATE TRIGGER protect_work_item_acts_delete
  BEFORE DELETE ON work_item_acts
  FOR EACH ROW
  EXECUTE FUNCTION prevent_delete_work_item_acts();

-- Prevent DELETE on work_item_publicaciones
CREATE OR REPLACE FUNCTION prevent_delete_work_item_publicaciones()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.allow_delete', true) = 'true' THEN
    RETURN OLD;
  END IF;
  
  RAISE EXCEPTION 'DELETE not allowed on work_item_publicaciones. Use the archive function instead. Record id: %', OLD.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS protect_work_item_publicaciones_delete ON work_item_publicaciones;
CREATE TRIGGER protect_work_item_publicaciones_delete
  BEFORE DELETE ON work_item_publicaciones
  FOR EACH ROW
  EXECUTE FUNCTION prevent_delete_work_item_publicaciones();

-- ============= 1C: UPDATE PROTECTION TRIGGERS =============

-- Protect core fields on work_item_acts
CREATE OR REPLACE FUNCTION protect_core_fields_work_item_acts()
RETURNS TRIGGER AS $$
BEGIN
  -- These fields are immutable once set
  IF OLD.hash_fingerprint IS NOT NULL AND NEW.hash_fingerprint != OLD.hash_fingerprint THEN
    RAISE EXCEPTION 'Cannot change hash_fingerprint on work_item_acts. Record id: %', OLD.id;
  END IF;
  
  IF OLD.act_date IS NOT NULL AND NEW.act_date IS DISTINCT FROM OLD.act_date THEN
    RAISE EXCEPTION 'Cannot change act_date on work_item_acts. Record id: %', OLD.id;
  END IF;
  
  IF OLD.description IS NOT NULL AND NEW.description IS DISTINCT FROM OLD.description THEN
    RAISE EXCEPTION 'Cannot change description on work_item_acts. Record id: %', OLD.id;
  END IF;
  
  -- Allow updates to: raw_data, updated_at, source, is_archived, is_canonical, despacho (for enrichment)
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS protect_core_fields_acts ON work_item_acts;
CREATE TRIGGER protect_core_fields_acts
  BEFORE UPDATE ON work_item_acts
  FOR EACH ROW
  EXECUTE FUNCTION protect_core_fields_work_item_acts();

-- Protect core fields on work_item_publicaciones
CREATE OR REPLACE FUNCTION protect_core_fields_work_item_publicaciones()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.hash_fingerprint IS NOT NULL AND NEW.hash_fingerprint != OLD.hash_fingerprint THEN
    RAISE EXCEPTION 'Cannot change hash_fingerprint on work_item_publicaciones. Record id: %', OLD.id;
  END IF;
  
  IF OLD.title IS NOT NULL AND NEW.title IS DISTINCT FROM OLD.title THEN
    RAISE EXCEPTION 'Cannot change title on work_item_publicaciones. Record id: %', OLD.id;
  END IF;
  
  -- Allow updates to: fecha_fijacion (can be enriched later), pdf_url, raw_data, is_archived, is_canonical
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS protect_core_fields_publicaciones ON work_item_publicaciones;
CREATE TRIGGER protect_core_fields_publicaciones
  BEFORE UPDATE ON work_item_publicaciones
  FOR EACH ROW
  EXECUTE FUNCTION protect_core_fields_work_item_publicaciones();

-- ============= 1D: ADMIN ARCHIVE FUNCTION =============

CREATE OR REPLACE FUNCTION admin_archive_record(
  p_table TEXT,
  p_record_id UUID,
  p_reason TEXT DEFAULT 'Manual archive by admin'
)
RETURNS VOID AS $$
BEGIN
  IF p_table = 'work_item_acts' THEN
    UPDATE work_item_acts 
    SET is_archived = true, archived_at = NOW(), archived_reason = p_reason
    WHERE id = p_record_id;
  ELSIF p_table = 'work_item_publicaciones' THEN
    UPDATE work_item_publicaciones 
    SET is_archived = true, archived_at = NOW(), archived_reason = p_reason
    WHERE id = p_record_id;
  ELSE
    RAISE EXCEPTION 'Unknown table: %', p_table;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============= 2: SYNC AUDIT LOG TABLE =============

CREATE TABLE IF NOT EXISTS sync_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- What was synced
  work_item_id UUID NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  organization_id UUID,
  radicado TEXT,
  workflow_type TEXT,
  sync_type TEXT NOT NULL CHECK (sync_type IN ('actuaciones', 'publicaciones', 'both')),
  
  -- Counts BEFORE this sync
  acts_count_before INTEGER NOT NULL DEFAULT 0,
  publicaciones_count_before INTEGER NOT NULL DEFAULT 0,
  
  -- Counts AFTER this sync
  acts_count_after INTEGER NOT NULL DEFAULT 0,
  publicaciones_count_after INTEGER NOT NULL DEFAULT 0,
  
  -- What happened
  acts_inserted INTEGER NOT NULL DEFAULT 0,
  acts_skipped INTEGER NOT NULL DEFAULT 0,
  publicaciones_inserted INTEGER NOT NULL DEFAULT 0,
  publicaciones_skipped INTEGER NOT NULL DEFAULT 0,
  
  -- Provider info
  provider_used TEXT,
  provider_latency_ms INTEGER,
  
  -- Status
  status TEXT NOT NULL CHECK (status IN ('success', 'partial', 'error', 'anomaly')),
  error_message TEXT,
  
  -- Anomaly detection
  count_decreased BOOLEAN DEFAULT false,
  anomaly_details TEXT,
  
  -- Metadata
  triggered_by TEXT CHECK (triggered_by IN ('login_sync', 'daily_cron', 'manual', 'debug_console')),
  edge_function TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for sync_audit_log
CREATE INDEX IF NOT EXISTS idx_sync_audit_log_work_item ON sync_audit_log(work_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_audit_log_anomalies ON sync_audit_log(count_decreased) WHERE count_decreased = true;
CREATE INDEX IF NOT EXISTS idx_sync_audit_log_org ON sync_audit_log(organization_id, created_at DESC);

-- Enable RLS
ALTER TABLE sync_audit_log ENABLE ROW LEVEL SECURITY;

-- Policy: org members can view their own audit logs
DROP POLICY IF EXISTS "Users can view their org sync audit logs" ON sync_audit_log;
CREATE POLICY "Users can view their org sync audit logs" ON sync_audit_log
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships 
      WHERE user_id = auth.uid()
    )
    OR public.is_platform_admin()
  );

-- Policy: service role can insert
DROP POLICY IF EXISTS "Service role can insert sync audit logs" ON sync_audit_log;
CREATE POLICY "Service role can insert sync audit logs" ON sync_audit_log
  FOR INSERT
  WITH CHECK (true);

-- ============= 3: MARK EXISTING DATA AS CANONICAL =============

-- Mark all existing records as canonical
UPDATE work_item_acts 
SET is_canonical = true, canonical_at = NOW() 
WHERE is_canonical = false OR is_canonical IS NULL;

UPDATE work_item_publicaciones 
SET is_canonical = true, canonical_at = NOW() 
WHERE is_canonical = false OR is_canonical IS NULL;