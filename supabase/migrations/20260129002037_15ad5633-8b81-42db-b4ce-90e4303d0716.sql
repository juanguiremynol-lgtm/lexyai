-- Add last_synced_at column to work_items table for tracking sync status
ALTER TABLE work_items 
ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

-- Add index for efficient querying of sync-eligible items
CREATE INDEX IF NOT EXISTS idx_work_items_sync_eligible 
ON work_items(organization_id, workflow_type, stage, last_synced_at)
WHERE monitoring_enabled = true AND radicado IS NOT NULL;

-- Add comment
COMMENT ON COLUMN work_items.last_synced_at IS 
  'Timestamp of last successful sync from external APIs (CPNU, SAMAI, Publicaciones)';